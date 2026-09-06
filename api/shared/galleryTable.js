const { TableClient } = require("@azure/data-tables");

const PARTITION_KEY = "photo";

function getGalleryTable() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    return TableClient.fromConnectionString(connectionString, "GalleryPhotos");
}

function toGalleryDto(entity) {
    return {
        id: entity.rowKey,
        url: entity.url,
        blobName: entity.blobName,
        caption: entity.caption || "",
        submittedBy: entity.submittedBy || "",
        status: entity.status,
        submittedAt: entity.submittedAt
    };
}

function sortNewestFirst(photos) {
    return photos.sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
}

module.exports = { getGalleryTable, toGalleryDto, sortNewestFirst, PARTITION_KEY };
