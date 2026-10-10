const { BlobServiceClient, BlobSASPermissions } = require("@azure/storage-blob");
const { readJpegSize } = require("./photoDate");

const CONTAINER_NAME = "gallery-photos";

function getGalleryContainer() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    return blobServiceClient.getContainerClient(CONTAINER_NAME);
}

// The container is private -- uploads are anonymous, so a public container
// would let anyone host an image on it before it's approved. Photos are
// shown through read-only links instead, which stay the same all day (so
// browsers can cache them) and expire one to two days later. A downloadName
// makes the link save the photo under that name instead of opening it.
function photoReadUrl(container, blobName, downloadName) {
    const expiresOn = new Date();
    expiresOn.setUTCHours(0, 0, 0, 0);
    expiresOn.setUTCDate(expiresOn.getUTCDate() + 2);
    const options = { permissions: BlobSASPermissions.parse("r"), expiresOn };
    if (downloadName) options.contentDisposition = `attachment; filename="${downloadName}"`;
    return container.getBlobClient(blobName).generateSasUrl(options);
}

// A stored photo's width and height, read from the start of its file (the
// size sits near the top of a JPEG), or null when it can't be read. For
// photos uploaded before sizes were noted.
const SIZE_READ_BYTES = 128 * 1024;

async function readStoredPhotoSize(container, blobName) {
    try {
        return readJpegSize(await container.getBlobClient(blobName).downloadToBuffer(0, SIZE_READ_BYTES));
    } catch (e) {
        return null;
    }
}

module.exports = { getGalleryContainer, photoReadUrl, readStoredPhotoSize };
