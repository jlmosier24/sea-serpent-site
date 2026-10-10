const { getGalleryContainer } = require("../shared/galleryContainer");
const { getGalleryTable, toGalleryDto, photoTag, PARTITION_KEY } = require("../shared/galleryTable");
const { getMeetsTable, listMeets } = require("../shared/meetsTable");
const { readPhotoDate, stripJpegMetadata, readJpegSize } = require("../shared/photoDate");
const { fromBase64, MAX_ORIGINAL_BYTES, MAX_PHOTO_BYTES } = require("../shared/photoUpload");

function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Reachable at /api/uploadGalleryPhoto. Public, anonymous -- open to anyone,
// no login. Every upload lands as "pending" and is invisible on the public
// gallery (see galleryPublic) until an admin approves it via
// manageGalleryApprove; that approval gate is this endpoint's main defense
// against abuse, on top of the size/type checks below.
//
// The body carries two things: the browser's resized JPEG, which is what's
// stored (with any metadata stripped, and its size noted), and the original photo's bytes, read
// here only for the day it was taken and then dropped.
module.exports = async function (context, req) {
    const body = req.body || {};
    const photo = fromBase64(body.dataBase64, MAX_PHOTO_BYTES);
    if (!photo) {
        context.res = { status: 400, body: `Missing photo, or it's over ${MAX_PHOTO_BYTES / (1024 * 1024)}MB.` };
        return;
    }
    const cleaned = stripJpegMetadata(photo);
    if (!cleaned) {
        context.res = { status: 400, body: "Photo must be a JPEG." };
        return;
    }
    const original = fromBase64(body.originalBase64, MAX_ORIGINAL_BYTES);
    const takenDate = original ? readPhotoDate(original) || "" : "";

    const id = generateId();
    const blobName = `${id}.jpg`;

    try {
        const container = getGalleryContainer();
        const blockBlobClient = container.getBlockBlobClient(blobName);
        await blockBlobClient.uploadData(cleaned, { blobHTTPHeaders: { blobContentType: "image/jpeg" } });

        const entity = {
            partitionKey: PARTITION_KEY,
            rowKey: id,
            url: blockBlobClient.url,
            blobName,
            status: "pending",
            submittedAt: new Date().toISOString(),
            takenDate,
            // Its size, so the Photos layouts can place it before it loads.
            ...readJpegSize(cleaned)
        };
        await getGalleryTable().createEntity(entity);

        const meets = takenDate ? await listMeets(getMeetsTable()) : [];
        context.res = { status: 200, body: { ...toGalleryDto(entity), tag: photoTag(takenDate, meets) } };
    } catch (e) {
        context.log.error("Failed to upload gallery photo:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
