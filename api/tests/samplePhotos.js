// Tiny made-up photo files for the tests: just enough JPEG and HEIC
// structure around an EXIF block to read a date from (and, for the JPEG, to
// strip). No real image data.

const TYPE_ASCII = 2;
const TYPE_LONG = 4;

// An EXIF block in TIFF layout. ifd0 and exif map tag numbers to ASCII
// strings; gps adds a GPS IFD pointer with a fake value, to show it's dropped.
function tiffBlock({ littleEndian = false, ifd0 = {}, exif = {}, gps = false } = {}) {
    const le = littleEndian;
    const ifd0Tags = Object.entries(ifd0).map(([tag, text]) => ({ tag: Number(tag), type: TYPE_ASCII, text }));
    const exifTags = Object.entries(exif).map(([tag, text]) => ({ tag: Number(tag), type: TYPE_ASCII, text }));
    if (exifTags.length) ifd0Tags.push({ tag: 0x8769, type: TYPE_LONG, pointsTo: "exif" });
    if (gps) ifd0Tags.push({ tag: 0x8825, type: TYPE_LONG, value: 0x47505321 }); // "GPS!"
    ifd0Tags.sort((a, b) => a.tag - b.tag);

    const ifdSize = count => 2 + count * 12 + 4;
    const ifd0At = 8;
    const exifAt = ifd0At + ifdSize(ifd0Tags.length);
    let textAt = exifAt + (exifTags.length ? ifdSize(exifTags.length) : 0);
    const textLength = [...ifd0Tags, ...exifTags].reduce((n, t) => n + (t.text ? t.text.length + 1 : 0), 0);
    const b = Buffer.alloc(textAt + textLength);
    const w16 = (v, at) => (le ? b.writeUInt16LE(v, at) : b.writeUInt16BE(v, at));
    const w32 = (v, at) => (le ? b.writeUInt32LE(v, at) : b.writeUInt32BE(v, at));
    b.write(le ? "II" : "MM", 0, "latin1");
    w16(42, 2);
    w32(ifd0At, 4);

    function writeIfd(at, tags) {
        w16(tags.length, at);
        tags.forEach((t, i) => {
            const e = at + 2 + i * 12;
            w16(t.tag, e);
            w16(t.type, e + 2);
            if (t.text != null) {
                w32(t.text.length + 1, e + 4);
                w32(textAt, e + 8);
                b.write(`${t.text}\0`, textAt, "latin1");
                textAt += t.text.length + 1;
            } else {
                w32(1, e + 4);
                w32(t.pointsTo === "exif" ? exifAt : t.value, e + 8);
            }
        });
        w32(0, at + 2 + tags.length * 12); // no next IFD
    }
    writeIfd(ifd0At, ifd0Tags);
    if (exifTags.length) writeIfd(exifAt, exifTags);
    return b;
}

function segment(marker, payload) {
    const head = Buffer.alloc(4);
    head[0] = 0xFF;
    head[1] = marker;
    head.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([head, payload]);
}

// A JPEG's marker layout around fake image data: JFIF header, the given
// EXIF block, a comment, quantization/frame tables, then two scans (as in a
// progressive JPEG) with a Huffman table between them whose bytes happen to
// look like an end marker. The scan data includes an escaped 0xFF and a
// restart marker. After the real end marker come trailing bytes, like the
// extra data some phones append.
function jpeg({ tiff = null, trailer = "TRAILING-DATA", width = 1, height = 1 } = {}) {
    const huffman = segment(0xC4, Buffer.from([0, 0xFF, 0xD9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const scan = segment(0xDA, Buffer.from([1, 1, 0, 0, 63, 0]));
    return Buffer.concat([
        Buffer.from([0xFF, 0xD8]),
        segment(0xE0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
        ...(tiff ? [segment(0xE1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]))] : []),
        segment(0xFE, Buffer.from("A comment", "latin1")),
        segment(0xDB, Buffer.alloc(65, 1)),
        segment(0xC0, Buffer.from([8, height >> 8, height & 0xFF, width >> 8, width & 0xFF, 1, 1, 0x11, 0])),
        huffman,
        scan,
        Buffer.from([0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56]),
        huffman,
        scan,
        Buffer.from([0x78, 0x9A]),
        Buffer.from([0xFF, 0xD9]),
        Buffer.from(trailer, "latin1")
    ]);
}

function box(type, ...contents) {
    const body = Buffer.concat(contents);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length + 8, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, body]);
}

function fullBoxHeader(version, flags = 0) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE((version << 24) | flags, 0);
    return b;
}

function u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v, 0); return b; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v, 0); return b; }

// A HEIC with an image item and an Exif item, laid out the way iPhones
// write them. ilocVersion 0 or 1 changes iloc's layout; inIdat keeps the
// Exif bytes inside the meta box instead of in 'mdat'.
function heic({ tiff, ilocVersion = 1, inIdat = false, infeVersion = 2 } = {}) {
    const exifItem = tiff ? Buffer.concat([u32(6), Buffer.from("Exif\0\0", "latin1"), tiff]) : null;
    const imageBytes = Buffer.from("IMAGE-DATA-IMAGE-DATA", "latin1");

    const infe = (id, type) => box("infe", fullBoxHeader(infeVersion), infeVersion === 2 ? u16(id) : u32(id), u16(0), Buffer.from(type, "latin1"), Buffer.from("\0", "latin1"));
    const items = [infe(1, "hvc1"), ...(exifItem ? [infe(2, "Exif")] : [])];
    const iinf = box("iinf", fullBoxHeader(0), u16(items.length), ...items);

    // iloc with 4-byte offsets and lengths and no base offset.
    const iloc = locations => box("iloc", fullBoxHeader(ilocVersion), Buffer.from([0x44, 0x00]), u16(locations.length),
        ...locations.map(l => Buffer.concat([u16(l.id), ...(ilocVersion >= 1 ? [u16(l.method)] : []), u16(0), u16(1), u32(l.offset), u32(l.length)])));

    const hdlr = box("hdlr", fullBoxHeader(0), u32(0), Buffer.from("pict", "latin1"), Buffer.alloc(12), Buffer.from("\0", "latin1"));
    const ftyp = box("ftyp", Buffer.from("heic", "latin1"), u32(0), Buffer.from("mif1heic", "latin1"));
    const idat = inIdat && exifItem ? box("idat", exifItem) : null;

    // The meta box's size doesn't depend on the offsets, so build it once to measure.
    const metaWith = locations => box("meta", fullBoxHeader(0), hdlr, iinf, iloc(locations), ...(idat ? [idat] : []));
    const placeholder = [{ id: 1, method: 0, offset: 0, length: 0 }, ...(exifItem ? [{ id: 2, method: 0, offset: 0, length: 0 }] : [])];
    const mdatStart = ftyp.length + metaWith(placeholder).length + 8;
    const locations = [{ id: 1, method: 0, offset: mdatStart, length: imageBytes.length }];
    if (exifItem) locations.push(inIdat ? { id: 2, method: 1, offset: 0, length: exifItem.length } : { id: 2, method: 0, offset: mdatStart + imageBytes.length, length: exifItem.length });
    const mdat = box("mdat", imageBytes, ...(exifItem && !inIdat ? [exifItem] : []));
    return Buffer.concat([ftyp, metaWith(locations), mdat]);
}

const DATE_TAKEN = 0x9003;
const DATE_SAVED = 0x9004;
const DATE_CHANGED = 0x0132;

module.exports = { tiffBlock, jpeg, heic, DATE_TAKEN, DATE_SAVED, DATE_CHANGED };
