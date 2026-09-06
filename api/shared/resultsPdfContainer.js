const { BlobServiceClient } = require("@azure/storage-blob");

const CONTAINER_NAME = "meet-result-pdfs";

function getResultsPdfContainer() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    return blobServiceClient.getContainerClient(CONTAINER_NAME);
}

module.exports = { getResultsPdfContainer };
