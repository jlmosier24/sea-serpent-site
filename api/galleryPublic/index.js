const { getGalleryTable, toGalleryDto, sortNewestFirst, photoTag, PARTITION_KEY } = require("../shared/galleryTable");
const { getGalleryContainer, photoReadUrl } = require("../shared/galleryContainer");
const { getMeetsTable, listMeets } = require("../shared/meetsTable");

// Reachable at /api/galleryPublic. Public -- approved photos only, each with
// a read-only link (the photo container itself is private), a second one
// that downloads the photo instead of opening it, and where it goes (its
// meet, "Practice & other", or nothing when it has no date).
module.exports = async function (context, req) {
    try {
        const table = getGalleryTable();
        const container = getGalleryContainer();
        const meets = await listMeets(getMeetsTable());
        const photos = [];
        for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
            const dto = toGalleryDto(entity);
            if (dto.status !== "approved") continue;
            photos.push({
                ...dto,
                url: await photoReadUrl(container, dto.blobName),
                downloadUrl: await photoReadUrl(container, dto.blobName, `spotswood-sea-serpents-${dto.blobName}`),
                tag: photoTag(dto.takenDate, meets)
            });
        }
        context.res = { status: 200, body: sortNewestFirst(photos) };
    } catch (e) {
        context.log.error("Failed to list gallery photos:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
