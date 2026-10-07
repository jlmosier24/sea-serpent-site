// The photo bytes the gallery's upload dialog sends, decoded and size-checked.

// The original photo, sent only so its date can be read: the start of a
// JPEG (where its EXIF is), or a whole HEIC, which can keep it anywhere.
const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
// The browser's resized copy, which is what gets stored.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// A Buffer from base64 text, or null when there's nothing usable.
function fromBase64(text, maxBytes) {
    if (typeof text !== "string" || !text) return null;
    const buffer = Buffer.from(text, "base64");
    return buffer.length > 0 && buffer.length <= maxBytes ? buffer : null;
}

module.exports = { fromBase64, MAX_ORIGINAL_BYTES, MAX_PHOTO_BYTES };
