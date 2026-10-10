const { getGalleryTable, toGalleryDto, sortNewestFirst, photoTag, PARTITION_KEY } = require("../shared/galleryTable");
const { getGalleryContainer, photoReadUrl, readStoredPhotoSize } = require("../shared/galleryContainer");
const { getMeetsTable, listMeets } = require("../shared/meetsTable");

// Reachable at /api/galleryPublic. Public -- approved photos only, each with
// a read-only link (the photo container itself is private), a second one
// that downloads the photo instead of opening it, and where it goes (its
// meet, "Practice & other", or nothing when it has no date). A photo from
// before sizes were noted on upload has its size read from its file the
// first time it's listed, and saved, so later lists don't read it again.
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
        await Promise.all(photos.filter(p => !p.width || !p.height).map(async (photo) => {
            const size = await readStoredPhotoSize(container, photo.blobName);
            if (!size) return;
            Object.assign(photo, size);
            try {
                await table.updateEntity({ partitionKey: PARTITION_KEY, rowKey: photo.id, ...size }, "Merge");
            } catch (e) {
                context.log.error(`Failed to save photo ${photo.id}'s size:`, e);
            }
        }));
        context.res = { status: 200, body: sortNewestFirst(photos) };
    } catch (e) {
        context.log.error("Failed to list gallery photos:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
