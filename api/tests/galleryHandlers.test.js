// Run from api/: npm test
// The gallery Functions against in-memory tables and blob storage.
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeTable, FakeContainer, call } = require("./fakes");
const { tiffBlock, jpeg, heic, DATE_TAKEN } = require("./samplePhotos");

const store = {};
function resetStore() {
    store.photos = new FakeTable();
    store.meets = new FakeTable();
    store.container = new FakeContainer();
}
resetStore();

// The Functions destructure these getters when they load, so swap them in first.
Object.assign(require("../shared/galleryTable"), { getGalleryTable: () => store.photos });
Object.assign(require("../shared/meetsTable"), { getMeetsTable: () => store.meets });
Object.assign(require("../shared/galleryContainer"), {
    getGalleryContainer: () => store.container,
    photoReadUrl: async (container, blobName, downloadName) => `https://fake.blob.core.windows.net/read/${blobName}${downloadName ? "?download" : ""}`
});
const photoDate = require("../galleryPhotoDate/index.js");
const upload = require("../uploadGalleryPhoto/index.js");
const publicList = require("../galleryPublic/index.js");
const adminList = require("../manageGalleryList/index.js");
const { PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");

const base64 = buffer => buffer.toString("base64");
const original = date => jpeg({ tiff: tiffBlock({ exif: { [DATE_TAKEN]: `${date} 18:42:07` }, gps: true }) });
// What the browser sends to be stored: a resized copy, which has no metadata of its own.
const resized = jpeg({ width: 1200, height: 1600 });

function addMeet(id, date, shortName) {
    store.meets.upsertEntity({ partitionKey: MEET_PARTITION_KEY, rowKey: id, opponent: `${shortName} Seahawks`, shortName, homeAway: "away", date });
}

test("the date check reads the date and says where the photo will go, storing nothing", async () => {
    resetStore();
    addMeet("2026-07-13-curtis-park", "2026-07-13", "Curtis Park");
    const meetDay = await call(photoDate, { body: { originalBase64: base64(original("2026:07:13")) } });
    assert.equal(meetDay.status, 200);
    assert.deepEqual(meetDay.body, { takenDate: "2026-07-13", tag: { key: "2026-07-13-curtis-park", label: "July 13 · Curtis Park", meetDate: "2026-07-13" } });

    const otherDay = await call(photoDate, { body: { originalBase64: base64(heic({ tiff: tiffBlock({ exif: { [DATE_TAKEN]: "2026:07:14 08:00:00" } }) })) } });
    assert.deepEqual(otherDay.body.tag, { key: "other", label: "Practice & other", meetDate: null });

    const noDate = await call(photoDate, { body: { originalBase64: base64(jpeg()) } });
    assert.deepEqual(noDate.body, { takenDate: "", tag: null });

    assert.equal((await call(photoDate, { body: {} })).status, 400);
    assert.equal(store.photos.all().length, 0);
    assert.equal(store.container.blobs.size, 0);
});

test("an upload stores the resized copy, stripped, as pending with the original's date", async () => {
    resetStore();
    addMeet("2026-07-13-curtis-park", "2026-07-13", "Curtis Park");
    // A copy that still carries EXIF (it shouldn't, but the server doesn't count on that).
    const copyWithExif = original("2026:07:13");
    const res = await call(upload, { body: { dataBase64: base64(copyWithExif), originalBase64: base64(original("2026:07:13")) } });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "pending");
    assert.equal(res.body.takenDate, "2026-07-13");
    assert.equal(res.body.tag.label, "July 13 · Curtis Park");

    const [row] = store.photos.all();
    assert.equal(row.status, "pending");
    assert.equal(row.takenDate, "2026-07-13");
    assert.equal(row.blobName.endsWith(".jpg"), true);
    // Its size is noted, for laying it out before it loads.
    assert.deepEqual([row.width, row.height], [1, 1]);
    const stored = store.container.blobs.get(row.blobName);
    assert.equal(stored.includes(Buffer.from("Exif\0\0", "latin1")), false);
    assert.equal(stored.includes(Buffer.from("GPS!", "latin1")), false);
});

test("an upload without the original still goes in, just with no date", async () => {
    resetStore();
    const res = await call(upload, { body: { dataBase64: base64(resized) } });
    assert.equal(res.status, 200);
    assert.equal(res.body.takenDate, "");
    assert.equal(res.body.tag, null);
});

test("an upload that isn't a JPEG, or has no photo, is refused and stores nothing", async () => {
    resetStore();
    assert.equal((await call(upload, { body: { dataBase64: base64(Buffer.from("<svg onload=alert(1)>")) } })).status, 400);
    assert.equal((await call(upload, { body: { dataBase64: base64(heic({ tiff: null })) } })).status, 400);
    assert.equal((await call(upload, { body: { originalBase64: base64(original("2026:07:13")) } })).status, 400);
    assert.equal((await call(upload, {})).status, 400);
    assert.equal(store.photos.all().length, 0);
    assert.equal(store.container.blobs.size, 0);
});

test("the public list has approved photos only, each placed by its date against today's meets", async () => {
    resetStore();
    for (const [date, status] of [["2026:07:13", "approved"], ["2026:07:14", "approved"], ["2026:07:13", "pending"]]) {
        await call(upload, { body: { dataBase64: base64(resized), originalBase64: base64(original(date)) } });
        const row = store.photos.all().find(r => r.status === "pending");
        if (status === "approved") await store.photos.updateEntity({ partitionKey: row.partitionKey, rowKey: row.rowKey, status: "approved" }, "Merge");
    }
    // An older upload, from before dates were read.
    await store.photos.createEntity({ partitionKey: "photo", rowKey: "0-old", blobName: "0-old.jpg", status: "approved", submittedAt: "2026-07-01T00:00:00.000Z", caption: "Relay warm-ups" });

    // The Jul 13 meet is added to the schedule after the photos came in.
    addMeet("2026-07-13-curtis-park", "2026-07-13", "Curtis Park");
    const res = await call(publicList, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
    assert.deepEqual(res.body.map(p => p.tag && p.tag.label).sort(), [null, "July 13 · Curtis Park", "Practice & other"].sort());
    assert.equal(res.body.every(p => p.status === "approved" && p.url && p.downloadUrl), true);
    assert.equal(res.body.find(p => p.id === "0-old").caption, "Relay warm-ups");
});

test("the admin list includes pending photos and where each will go", async () => {
    resetStore();
    addMeet("2026-07-13-curtis-park", "2026-07-13", "Curtis Park");
    await call(upload, { body: { dataBase64: base64(resized), originalBase64: base64(original("2026:07:13")) } });
    const res = await call(adminList, {});
    assert.equal(res.status, 200);
    assert.equal(res.body[0].status, "pending");
    assert.equal(res.body[0].tag.label, "July 13 · Curtis Park");
    assert.equal(res.body[0].takenDate, "2026-07-13");
});

test("the public list reads an older photo's size from its file once, and saves it", async () => {
    resetStore();
    // From before sizes were noted: the photo's in storage, its row has no size.
    store.container.blobs.set("0-wide.jpg", jpeg({ width: 1600, height: 1200 }));
    await store.photos.createEntity({ partitionKey: "photo", rowKey: "0-wide", blobName: "0-wide.jpg", status: "approved", submittedAt: "2026-07-01T00:00:00.000Z" });
    // One whose file is missing still lists, just without a size.
    await store.photos.createEntity({ partitionKey: "photo", rowKey: "0-gone", blobName: "0-gone.jpg", status: "approved", submittedAt: "2026-07-02T00:00:00.000Z" });
    await call(upload, { body: { dataBase64: base64(resized) } });
    const fresh = store.photos.all().find(r => r.status === "pending");
    await store.photos.updateEntity({ partitionKey: "photo", rowKey: fresh.rowKey, status: "approved" }, "Merge");

    const res = await call(publicList, {});
    const sizes = Object.fromEntries(res.body.map(p => [p.id, [p.width, p.height]]));
    assert.deepEqual(sizes["0-wide"], [1600, 1200]);
    assert.deepEqual(sizes["0-gone"], [null, null]);
    assert.deepEqual(sizes[fresh.rowKey], [1200, 1600]);
    assert.deepEqual([(await store.photos.getEntity("photo", "0-wide")).width, (await store.photos.getEntity("photo", "0-wide")).height], [1600, 1200]);
});

test("a JPEG's size comes from its frame header, and only the start of the file is needed", () => {
    const { readJpegSize } = require("../shared/photoDate");
    const photo = jpeg({ width: 4032, height: 3024, tiff: tiffBlock({ exif: { [DATE_TAKEN]: "2026:07:13 18:42:07" } }) });
    assert.deepEqual(readJpegSize(photo), { width: 4032, height: 3024 });
    assert.deepEqual(readJpegSize(photo.subarray(0, photo.indexOf(Buffer.from([0xFF, 0xDA])))), { width: 4032, height: 3024 });
    assert.equal(readJpegSize(Buffer.from("not a photo")), null);
});
