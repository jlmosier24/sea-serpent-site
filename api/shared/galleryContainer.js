const { BlobServiceClient } = require("@azure/storage-blob");

const CONTAINER_NAME = "gallery-photos";

function getGalleryContainer() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    return blobServiceClient.getContainerClient(CONTAINER_NAME);
}

module.exports = { getGalleryContainer };
