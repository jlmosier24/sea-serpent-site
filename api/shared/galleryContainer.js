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
// browsers can cache them) and expire one to two days later.
function photoReadUrl(container, blobName) {
    const expiresOn = new Date();
    expiresOn.setUTCHours(0, 0, 0, 0);
    expiresOn.setUTCDate(expiresOn.getUTCDate() + 2);
    return container.getBlobClient(blobName).generateSasUrl({ permissions: BlobSASPermissions.parse("r"), expiresOn });
}

module.exports = { getGalleryContainer, photoReadUrl };
