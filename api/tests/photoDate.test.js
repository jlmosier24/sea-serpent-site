// Run from api/: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { readPhotoDate, stripJpegMetadata } = require("../shared/photoDate");
const { photoTag } = require("../shared/galleryTable");
const { tiffBlock, jpeg, heic, DATE_TAKEN, DATE_SAVED, DATE_CHANGED } = require("./samplePhotos");

const taken = (date, more = {}) => tiffBlock({ exif: { [DATE_TAKEN]: `${date} 18:42:07` }, gps: true, ...more });

test("a JPEG's date taken, in either byte order", () => {
    assert.equal(readPhotoDate(jpeg({ tiff: taken("2026:07:13") })), "2026-07-13");
    assert.equal(readPhotoDate(jpeg({ tiff: taken("2026:06:24", { littleEndian: true }) })), "2026-06-24");
});

test("without a date taken, the camera's save date, then the file's own date", () => {
    assert.equal(readPhotoDate(jpeg({ tiff: tiffBlock({ exif: { [DATE_SAVED]: "2026:07:01 10:00:00" }, ifd0: { [DATE_CHANGED]: "2026:08:30 09:00:00" } }) })), "2026-07-01");
    assert.equal(readPhotoDate(jpeg({ tiff: tiffBlock({ ifd0: { [DATE_CHANGED]: "2026:07:08 19:30:00" } }) })), "2026-07-08");
});

test("no date: no EXIF, a blank camera clock, or a file that isn't a photo", () => {
    assert.equal(readPhotoDate(jpeg()), null);
    assert.equal(readPhotoDate(jpeg({ tiff: taken("0000:00:00") })), null);
    assert.equal(readPhotoDate(Buffer.from("not a photo at all")), null);
    assert.equal(readPhotoDate(Buffer.alloc(0)), null);
});

test("a cut-off or damaged file just has no date", () => {
    const whole = jpeg({ tiff: taken("2026:07:13") });
    for (let length = 0; length < whole.length; length += 7) assert.doesNotThrow(() => readPhotoDate(whole.subarray(0, length)));
    const damaged = Buffer.from(whole);
    damaged.fill(0xFF, 30, 60);
    assert.doesNotThrow(() => readPhotoDate(damaged));
});

test("a HEIC's date taken, wherever its Exif item is kept", () => {
    assert.equal(readPhotoDate(heic({ tiff: taken("2026:07:13") })), "2026-07-13");
    assert.equal(readPhotoDate(heic({ tiff: taken("2026:07:13"), ilocVersion: 0 })), "2026-07-13");
    assert.equal(readPhotoDate(heic({ tiff: taken("2026:06:17"), inIdat: true })), "2026-06-17");
    assert.equal(readPhotoDate(heic({ tiff: taken("2026:06:10", { littleEndian: true }), infeVersion: 3 })), "2026-06-10");
});

test("a HEIC with no Exif item, or cut off before it, has no date", () => {
    assert.equal(readPhotoDate(heic({ tiff: null })), null);
    const whole = heic({ tiff: taken("2026:07:13") });
    for (let length = 0; length < whole.length; length += 5) assert.doesNotThrow(() => readPhotoDate(whole.subarray(0, length)));
    assert.equal(readPhotoDate(whole.subarray(0, whole.length - 10)), null);
});

test("stripping a JPEG keeps the image and drops its EXIF, comment, and trailing data", () => {
    const original = jpeg({ tiff: taken("2026:07:13"), trailer: "SECRET-TRAILER" });
    const stripped = stripJpegMetadata(original);
    assert.equal(stripped.includes(Buffer.from("Exif\0\0", "latin1")), false);
    assert.equal(stripped.includes(Buffer.from("GPS!", "latin1")), false);
    assert.equal(stripped.includes(Buffer.from("A comment", "latin1")), false);
    assert.equal(stripped.includes(Buffer.from("SECRET-TRAILER", "latin1")), false);
    assert.equal(readPhotoDate(stripped), null);
    // Everything that draws the image is still there, ending at the real end marker
    // (not at the look-alike bytes inside the Huffman table between the scans).
    const imageStart = original.indexOf(Buffer.from([0xFF, 0xDB]));
    const imageEnd = original.lastIndexOf(Buffer.from([0xFF, 0xD9])) + 2;
    assert.deepEqual(stripped.subarray(stripped.indexOf(Buffer.from([0xFF, 0xDB]))), original.subarray(imageStart, imageEnd));
    assert.deepEqual(stripped.subarray(0, 4), original.subarray(0, 4)); // start marker and JFIF header kept
});

test("stripping refuses what isn't a readable JPEG", () => {
    assert.equal(stripJpegMetadata(Buffer.from("<svg onload=alert(1)>")), null);
    assert.equal(stripJpegMetadata(heic({ tiff: taken("2026:07:13") })), null);
    assert.equal(stripJpegMetadata(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00])), null);
});

test("photoTag: the meet on that day, Practice & other for any other day, nothing without a date", () => {
    const meets = [
        { id: "2026-07-13-curtis-park", date: "2026-07-13", shortName: "Curtis Park", opponent: "Curtis Park Seahawks" },
        { id: "2026-06-10-no-short-name", date: "2026-06-10", shortName: "", opponent: "Test Seahawks" }
    ];
    assert.deepEqual(photoTag("2026-07-13", meets), { key: "2026-07-13-curtis-park", label: "Jul 13 · Curtis Park", meetDate: "2026-07-13" });
    assert.equal(photoTag("2026-06-10", meets).label, "Jun 10 · Test Seahawks");
    assert.deepEqual(photoTag("2026-07-14", meets), { key: "other", label: "Practice & other", meetDate: null });
    assert.equal(photoTag("", meets), null);
});
