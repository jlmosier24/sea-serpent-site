// A photo's own metadata (EXIF), read and removed on the server.
//
// readPhotoDate finds the day a photo was taken, in JPEG and HEIC/HEIF
// files. Only the date is read: the location that phones also record there
// is never looked at, kept, or passed on.
//
// stripJpegMetadata removes every metadata segment from a JPEG before it's
// stored, as a backstop to the browser's own re-encoding (which already
// leaves none).

const TAG_DATE_TIME = 0x0132;           // IFD0: when the file was last changed
const TAG_EXIF_IFD = 0x8769;            // IFD0: where the Exif IFD starts
const TAG_DATE_TIME_ORIGINAL = 0x9003;  // Exif IFD: when the photo was taken
const TAG_DATE_TIME_DIGITIZED = 0x9004; // Exif IFD: when it was saved by the camera
const TYPE_ASCII = 2;
// A HEIC's Exif block is a few KB; anything far bigger isn't one.
const MAX_EXIF_BYTES = 1024 * 1024;

// "YYYY-MM-DD" on the camera's own clock (the local date, which is what a
// meet date is), or null when the photo has no readable date.
function readPhotoDate(buffer) {
    try {
        if (isJpeg(buffer)) return jpegDate(buffer);
        if (isHeif(buffer)) return heifDate(buffer);
    } catch (e) {
        // A damaged or cut-off file just has no readable date.
    }
    return null;
}

/* ---------- JPEG ---------- */

function isJpeg(b) {
    return b.length >= 4 && b[0] === 0xFF && b[1] === 0xD8;
}

// Marker segments before the image data, as { marker, start, end } where
// start..end is the whole segment including its marker. Stops at the first
// scan (0xDA), whose position comes back as `scan`.
function jpegSegments(b) {
    const segments = [];
    let at = 2;
    while (at + 4 <= b.length && b[at] === 0xFF) {
        const marker = b[at + 1];
        if (marker === 0xFF) { at += 1; continue; } // fill byte
        if (marker === 0xDA || marker === 0xD9) return { segments, scan: at };
        const end = at + 2 + b.readUInt16BE(at + 2);
        if (end > b.length) break;
        segments.push({ marker, start: at, end });
        at = end;
    }
    return { segments, scan: -1 };
}

function jpegDate(b) {
    for (const s of jpegSegments(b).segments) {
        if (s.marker === 0xE1 && b.toString("latin1", s.start + 4, s.start + 10) === "Exif\0\0") {
            return tiffDate(b, s.start + 10, s.end);
        }
    }
    return null;
}

// APP0 (JFIF), APP14 (Adobe color handling), and an ICC color profile in APP2
// only say how to draw the image. Every other APPn segment and any comment
// can carry details about the photo (EXIF with GPS, XMP, IPTC), so those go.
function keepsSegment(b, s) {
    if (s.marker === 0xE0 || s.marker === 0xEE) return true;
    if (s.marker === 0xE2) return b.toString("latin1", s.start + 4, s.start + 16) === "ICC_PROFILE\0";
    return !(s.marker >= 0xE1 && s.marker <= 0xEF) && s.marker !== 0xFE;
}

// Where the image ends (just past the end-of-image marker), walking the
// scans and the segments between them. Anything after it -- some phones add
// extra data there -- is dropped.
function jpegEnd(b, at) {
    while (at + 2 <= b.length) {
        if (b[at] !== 0xFF) return b.length;
        const marker = b[at + 1];
        if (marker === 0xD9) return at + 2;
        if (marker === 0xFF) { at += 1; continue; } // fill byte
        if (marker >= 0xD0 && marker <= 0xD7) { at += 2; continue; }
        if (at + 4 > b.length) return b.length;
        at += 2 + b.readUInt16BE(at + 2);
        if (marker === 0xDA) {
            // Compressed image data runs until the next real marker: 0xFF
            // followed by anything but 0x00 (an escaped byte) or a restart marker.
            while (at + 1 < b.length && !(b[at] === 0xFF && b[at + 1] !== 0x00 && !(b[at + 1] >= 0xD0 && b[at + 1] <= 0xD7))) at++;
        }
    }
    return b.length;
}

// The JPEG without its metadata, or null when it isn't a JPEG this can read
// to the image data (so nothing unchecked gets stored).
function stripJpegMetadata(b) {
    if (!isJpeg(b)) return null;
    try {
        const { segments, scan } = jpegSegments(b);
        if (scan < 0) return null;
        const kept = segments.filter(s => keepsSegment(b, s)).map(s => b.subarray(s.start, s.end));
        return Buffer.concat([b.subarray(0, 2), ...kept, b.subarray(scan, jpegEnd(b, scan))]);
    } catch (e) {
        return null;
    }
}

/* ---------- EXIF (TIFF layout, shared by JPEG and HEIC) ---------- */

function tiffDate(b, base, end) {
    if (base < 0 || base + 8 > end) return null;
    const order = b.toString("latin1", base, base + 2);
    const le = order === "II";
    if (!le && order !== "MM") return null;
    const u16 = at => (le ? b.readUInt16LE(at) : b.readUInt16BE(at));
    const u32 = at => (le ? b.readUInt32LE(at) : b.readUInt32BE(at));
    const fits = (at, length) => at >= base && at + length <= end;

    // One IFD's entries, by tag, each as the offset of its 12-byte entry.
    function entries(ifdOffset) {
        const at = base + ifdOffset;
        const found = new Map();
        if (!fits(at, 2)) return found;
        const count = u16(at);
        for (let i = 0; i < count && fits(at + 2 + i * 12, 12); i++) found.set(u16(at + 2 + i * 12), at + 2 + i * 12);
        return found;
    }
    function text(entry) {
        const count = u32(entry + 4);
        if (u16(entry + 2) !== TYPE_ASCII || count < 10) return null;
        const at = count > 4 ? base + u32(entry + 8) : entry + 8;
        return fits(at, count) ? b.toString("latin1", at, at + count) : null;
    }

    const ifd0 = entries(u32(base + 4));
    let stamp = null;
    if (ifd0.has(TAG_EXIF_IFD)) {
        const exif = entries(u32(ifd0.get(TAG_EXIF_IFD) + 8));
        for (const tag of [TAG_DATE_TIME_ORIGINAL, TAG_DATE_TIME_DIGITIZED]) {
            if (!stamp && exif.has(tag)) stamp = text(exif.get(tag));
        }
    }
    if (!stamp && ifd0.has(TAG_DATE_TIME)) stamp = text(ifd0.get(TAG_DATE_TIME));
    return isoDate(stamp);
}

// EXIF dates read "2026:07:13 18:42:07". A camera with no clock set writes zeros.
function isoDate(stamp) {
    const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(stamp || "");
    if (!m) return null;
    const [, year, month, day] = m.map(Number);
    if (year < 1990 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
}

/* ---------- HEIC / HEIF ---------- */
// An ISO media file: a tree of boxes. The 'meta' box lists the file's items;
// one of type 'Exif' holds the EXIF block, and 'iloc' says where its bytes are.

function isHeif(b) {
    if (b.length < 16 || b.toString("latin1", 4, 8) !== "ftyp") return false;
    const brands = b.toString("latin1", 8, Math.min(b.length, b.readUInt32BE(0)));
    return /heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(brands);
}

// The boxes laid end to end within start..end, as { type, start, end } where
// start..end is the box's contents (after its header).
function boxes(b, start, end) {
    const found = [];
    let at = start;
    while (at + 8 <= end) {
        let size = b.readUInt32BE(at);
        let header = 8;
        if (size === 1) {
            if (at + 16 > end) break;
            size = Number(b.readBigUInt64BE(at + 8));
            header = 16;
        } else if (size === 0) {
            size = end - at;
        }
        if (size < header || at + size > end) break;
        found.push({ type: b.toString("latin1", at + 4, at + 8), start: at + header, end: at + size });
        at += size;
    }
    return found;
}

// An unsigned number of 0, 4, or 8 bytes (iloc's field sizes).
function readSized(b, at, size) {
    if (size === 0) return 0;
    if (size === 4) return b.readUInt32BE(at);
    if (size === 8) return Number(b.readBigUInt64BE(at));
    throw new Error(`Unexpected field size ${size}`);
}

function exifItemId(b, iinf) {
    const version = b[iinf.start];
    const first = iinf.start + 4 + (version === 0 ? 2 : 4);
    for (const infe of boxes(b, first, iinf.end).filter(box => box.type === "infe")) {
        const infeVersion = b[infe.start];
        if (infeVersion < 2) continue; // older entries can't name an Exif item
        const idSize = infeVersion === 2 ? 2 : 4;
        const id = idSize === 2 ? b.readUInt16BE(infe.start + 4) : b.readUInt32BE(infe.start + 4);
        const typeAt = infe.start + 4 + idSize + 2;
        if (b.toString("latin1", typeAt, typeAt + 4) === "Exif") return id;
    }
    return null;
}

// The item's bytes, joined from its extents: in the file itself (construction
// method 0) or inside the 'idat' box (method 1).
function itemData(b, iloc, idat, itemId) {
    const version = b[iloc.start];
    let at = iloc.start + 4;
    const offsetSize = b[at] >> 4;
    const lengthSize = b[at] & 0x0F;
    const baseOffsetSize = b[at + 1] >> 4;
    const indexSize = version === 1 || version === 2 ? b[at + 1] & 0x0F : 0;
    at += 2;
    const itemCount = version < 2 ? b.readUInt16BE(at) : b.readUInt32BE(at);
    at += version < 2 ? 2 : 4;
    for (let i = 0; i < itemCount; i++) {
        const id = version < 2 ? b.readUInt16BE(at) : b.readUInt32BE(at);
        at += version < 2 ? 2 : 4;
        let method = 0;
        if (version === 1 || version === 2) {
            method = b.readUInt16BE(at) & 0x0F;
            at += 2;
        }
        at += 2; // data_reference_index
        const baseOffset = readSized(b, at, baseOffsetSize);
        at += baseOffsetSize;
        const extentCount = b.readUInt16BE(at);
        at += 2;
        const extents = [];
        for (let e = 0; e < extentCount; e++) {
            at += indexSize;
            const offset = readSized(b, at, offsetSize);
            at += offsetSize;
            const length = readSized(b, at, lengthSize);
            at += lengthSize;
            extents.push({ offset, length });
        }
        if (id !== itemId) continue;
        if (method > 1 || (method === 1 && !idat)) return null;
        const origin = method === 1 ? idat.start : 0;
        const limit = method === 1 ? idat.end : b.length;
        const parts = [];
        let total = 0;
        for (const { offset, length } of extents) {
            const start = origin + baseOffset + offset;
            // A length of 0 means "to the end".
            const stop = length === 0 ? limit : start + length;
            if (start < origin || stop > limit) return null;
            total += stop - start;
            if (total > MAX_EXIF_BYTES) return null;
            parts.push(b.subarray(start, stop));
        }
        return Buffer.concat(parts);
    }
    return null;
}

function heifDate(b) {
    const meta = boxes(b, 0, b.length).find(box => box.type === "meta");
    if (!meta) return null;
    const children = boxes(b, meta.start + 4, meta.end);
    const iinf = children.find(box => box.type === "iinf");
    const iloc = children.find(box => box.type === "iloc");
    if (!iinf || !iloc) return null;
    const id = exifItemId(b, iinf);
    if (id == null) return null;
    const data = itemData(b, iloc, children.find(box => box.type === "idat"), id);
    // The Exif item starts with where its TIFF header begins (usually after "Exif\0\0").
    if (!data || data.length < 4) return null;
    return tiffDate(data, 4 + data.readUInt32BE(0), data.length);
}

module.exports = { readPhotoDate, stripJpegMetadata };
