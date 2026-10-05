const { BlobServiceClient, BlobSASPermissions } = require("@azure/storage-blob");

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

module.exports = { getGalleryContainer, photoReadUrl };
