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
        status: entity.status,
        submittedAt: entity.submittedAt,
        // The day the photo was taken ("YYYY-MM-DD"), read from the photo
        // itself on upload; "" when it had no date (and for older uploads,
        // whose dates were removed in the browser before this was read).
        takenDate: entity.takenDate || "",
        // Pixels, for laying photos out before they load; null for older
        // uploads until galleryPublic has read their size once.
        width: entity.width || null,
        height: entity.height || null
    };
}

function sortNewestFirst(photos) {
    return photos.sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Where a photo goes, from the day it was taken: the meet on that day
// ("July 13 · Curtis Park"), "Practice & other" for any other day, or null
// when it has no date. Worked out whenever photos are listed, so a photo
// lands right even if its meet was added to the schedule after the upload.
function photoTag(takenDate, meets) {
    if (!takenDate) return null;
    const meet = meets.find(m => m.date === takenDate);
    if (!meet) return { key: "other", label: "Practice & other", meetDate: null };
    const [, month, day] = meet.date.split("-").map(Number);
    return { key: meet.id, label: `${MONTHS[month - 1]} ${day} · ${meet.shortName || meet.opponent}`, meetDate: meet.date };
}

// The public order: the newest day first, and within a day the order the
// photos were taken (from each entity's private takenAt; one without it
// follows, by when it came in). A photo with no date goes by the day it
// came in. Takes [{ photo, entity }], returns the photos.
function sortForGallery(items) {
    const day = ({ photo }) => photo.takenDate || (photo.submittedAt || "").slice(0, 10);
    return items.sort((a, b) =>
        day(b).localeCompare(day(a))
        || (a.entity.takenAt ? 0 : 1) - (b.entity.takenAt ? 0 : 1)
        || (a.entity.takenAt || "").localeCompare(b.entity.takenAt || "")
        || (a.photo.submittedAt || "").localeCompare(b.photo.submittedAt || "")
    ).map(item => item.photo);
}

// A pending photo that looks like one already uploaded: the same date and
// time taken, to the second, and the same size. Returns a map of pending
// photo id -> the earlier photo (an approved one if there is one).
function findDuplicates(items) {
    const key = ({ entity }) => (entity.takenAt && entity.width && entity.height ? `${entity.takenAt}|${entity.width}x${entity.height}` : null);
    const byKey = new Map();
    for (const item of items) {
        const k = key(item);
        if (k) byKey.set(k, [...(byKey.get(k) || []), item]);
    }
    const duplicates = new Map();
    for (const group of byKey.values()) {
        if (group.length < 2) continue;
        const rank = item => (item.photo.status === "approved" ? 0 : 1);
        group.sort((a, b) => rank(a) - rank(b) || (a.photo.submittedAt || "").localeCompare(b.photo.submittedAt || ""));
        const [first, ...rest] = group;
        for (const item of rest) if (item.photo.status === "pending") duplicates.set(item.photo.id, first.photo);
    }
    return duplicates;
}

module.exports = { getGalleryTable, toGalleryDto, sortNewestFirst, sortForGallery, findDuplicates, photoTag, PARTITION_KEY };
