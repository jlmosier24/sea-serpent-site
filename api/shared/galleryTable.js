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
        submittedAt: entity.submittedAt,
        // The day the photo was taken ("YYYY-MM-DD"), read from the photo
        // itself on upload; "" when it had no date (and for older uploads,
        // whose dates were removed in the browser before this was read).
        takenDate: entity.takenDate || ""
    };
}

function sortNewestFirst(photos) {
    return photos.sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Where a photo goes, from the day it was taken: the meet on that day
// ("Jul 13 · Curtis Park"), "Practice & other" for any other day, or null
// when it has no date. Worked out whenever photos are listed, so a photo
// lands right even if its meet was added to the schedule after the upload.
function photoTag(takenDate, meets) {
    if (!takenDate) return null;
    const meet = meets.find(m => m.date === takenDate);
    if (!meet) return { key: "other", label: "Practice & other", meetDate: null };
    const [, month, day] = meet.date.split("-").map(Number);
    return { key: meet.id, label: `${MONTHS[month - 1]} ${day} · ${meet.shortName || meet.opponent}`, meetDate: meet.date };
}

module.exports = { getGalleryTable, toGalleryDto, sortNewestFirst, photoTag, PARTITION_KEY };
