const { readPhotoDate } = require("../shared/photoDate");
const { photoTag } = require("../shared/galleryTable");
const { getMeetsTable, listMeets } = require("../shared/meetsTable");
const { fromBase64, MAX_ORIGINAL_BYTES } = require("../shared/photoUpload");

// Reachable at /api/galleryPhotoDate. Public, like the upload. As soon as
// photos are picked in the upload dialog, each one's original bytes come
// here so the dialog can show where it will go: the day it was taken, and
// that day's meet. Only the date is read, and nothing is stored.
module.exports = async function (context, req) {
    const original = fromBase64((req.body || {}).originalBase64, MAX_ORIGINAL_BYTES);
    if (!original) {
        context.res = { status: 400, body: "Missing photo data, or it's too large." };
        return;
    }

    try {
        const takenDate = readPhotoDate(original);
        const meets = takenDate ? await listMeets(getMeetsTable()) : [];
        context.res = { status: 200, body: { takenDate: takenDate || "", tag: photoTag(takenDate, meets) } };
    } catch (e) {
        context.log.error("Failed to read a photo's date:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
