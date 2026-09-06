const { getGalleryTable, toGalleryDto, sortNewestFirst, PARTITION_KEY } = require("../shared/galleryTable");

// Reachable at /api/manageGalleryList. Protected by an explicit route rule
// in staticwebapp.config.json (requires the "administrator" role) --
// returns photos of every status (pending/approved) for the moderation queue.
module.exports = async function (context, req) {
    try {
        const table = getGalleryTable();
        const photos = [];
        for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
            photos.push(toGalleryDto(entity));
        }
        context.res = { status: 200, body: sortNewestFirst(photos) };
    } catch (e) {
        context.log.error("Failed to list gallery photos:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
