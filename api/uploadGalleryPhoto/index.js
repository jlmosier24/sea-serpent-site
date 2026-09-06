const { getGalleryContainer } = require("../shared/galleryContainer");
const { getGalleryTable, toGalleryDto, PARTITION_KEY } = require("../shared/galleryTable");

const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_CAPTION_LEN = 300;
const MAX_NAME_LEN = 100;

function extFromContentType(contentType) {
    const map = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
    return map[contentType] || "jpg";
}

function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Reachable at /api/uploadGalleryPhoto. Public, anonymous -- open to anyone,
// no login. Every upload lands as "pending" and is invisible on the public
// gallery (see galleryPublic) until an admin approves it via
// manageGalleryApprove; that approval gate is this endpoint's main defense
// against abuse, on top of the size/type checks below.
module.exports = async function (context, req) {
    const { filename, contentType, dataBase64, caption, submittedBy } = req.body || {};

    if (!contentType || !contentType.startsWith("image/")) {
        context.res = { status: 400, body: "File must be an image." };
        return;
    }
    if (!dataBase64) {
        context.res = { status: 400, body: "Missing image data." };
        return;
    }

    let buffer;
    try {
        buffer = Buffer.from(dataBase64, "base64");
    } catch (e) {
        context.res = { status: 400, body: "Could not decode image data." };
        return;
    }
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
        context.res = { status: 400, body: `Image must be under ${MAX_BYTES / (1024 * 1024)}MB.` };
        return;
    }

    const id = generateId();
    const blobName = `${id}.${extFromContentType(contentType)}`;

    try {
        const container = getGalleryContainer();
        const blockBlobClient = container.getBlockBlobClient(blobName);
        await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: contentType } });

        const table = getGalleryTable();
        const entity = {
            partitionKey: PARTITION_KEY,
            rowKey: id,
            url: blockBlobClient.url,
            blobName,
            caption: (caption || "").toString().trim().slice(0, MAX_CAPTION_LEN),
            submittedBy: (submittedBy || "").toString().trim().slice(0, MAX_NAME_LEN),
            status: "pending",
            submittedAt: new Date().toISOString()
        };
        await table.createEntity(entity);

        context.res = { status: 200, body: toGalleryDto(entity) };
    } catch (e) {
        context.log.error("Failed to upload gallery photo:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
