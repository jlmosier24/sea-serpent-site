const { getGalleryTable, toGalleryDto, sortNewestFirst, PARTITION_KEY } = require("../shared/galleryTable");
const { getGalleryContainer, photoReadUrl } = require("../shared/galleryContainer");

// Reachable at /api/galleryPublic. Public -- approved photos only, each with
// a read-only link (the photo container itself is private).
module.exports = async function (context, req) {
    try {
        const table = getGalleryTable();
        const container = getGalleryContainer();
        const photos = [];
        for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
            const dto = toGalleryDto(entity);
            if (dto.status === "approved") photos.push({ ...dto, url: await photoReadUrl(container, dto.blobName) });
        }
        context.res = { status: 200, body: sortNewestFirst(photos) };
    } catch (e) {
        context.log.error("Failed to list gallery photos:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
