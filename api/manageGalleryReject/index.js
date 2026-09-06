const { getGalleryTable, PARTITION_KEY } = require("../shared/galleryTable");
const { getGalleryContainer } = require("../shared/galleryContainer");

// Reachable at /api/manageGalleryReject. Protected by an explicit route
// rule in staticwebapp.config.json (requires the "administrator" role).
// Rejecting a submission removes it entirely (blob + row) rather than just
// hiding it -- this is a public, unauthenticated upload endpoint, so reject
// is meant to actually get rid of unwanted content, not archive it.
module.exports = async function (context, req) {
    const { id } = req.body || {};
    if (!id) {
        context.res = { status: 400, body: "Missing photo id." };
        return;
    }
    try {
        const table = getGalleryTable();
        let blobName = id;
        try {
            const entity = await table.getEntity(PARTITION_KEY, id);
            blobName = entity.blobName || id;
        } catch (e) {
            // Not fatal -- falls back to trying the id as the blob name.
        }

        await getGalleryContainer().getBlockBlobClient(blobName).deleteIfExists();
        await table.deleteEntity(PARTITION_KEY, id);

        context.res = { status: 200, body: "Deleted" };
    } catch (e) {
        context.log.error("Failed to reject photo:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
