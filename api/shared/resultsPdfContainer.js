const { BlobServiceClient } = require("@azure/storage-blob");

const CONTAINER_NAME = "meet-result-pdfs";

function getResultsPdfContainer() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    return blobServiceClient.getContainerClient(CONTAINER_NAME);
}

// Each imported sheet is archived as "<meet id>-<upload time>.pdf".
function sheetBlobName(meetId, now = Date.now()) {
    return `${meetId}-${now}.pdf`;
}

// Matches the whole name, not just the "<meet id>-" prefix -- that alone
// would also match a second meet whose id is this one plus "-2".
function isSheetForMeet(blobName, meetId) {
    return blobName.startsWith(meetId + "-") && /^\d+\.pdf$/.test(blobName.slice(meetId.length + 1));
}

module.exports = { getResultsPdfContainer, sheetBlobName, isSheetForMeet };
