const { getGalleryTable, toGalleryDto, PARTITION_KEY } = require("../shared/galleryTable");

// Reachable at /api/manageGalleryApprove. Protected by an explicit route
// rule in staticwebapp.config.json (requires the "administrator" role).
module.exports = async function (context, req) {
    const { id } = req.body || {};
    if (!id) {
        context.res = { status: 400, body: "Missing photo id." };
        return;
    }
    try {
        const table = getGalleryTable();
        const entity = await table.getEntity(PARTITION_KEY, id);
        entity.status = "approved";
        await table.updateEntity(entity, "Merge");
        context.res = { status: 200, body: toGalleryDto(entity) };
    } catch (e) {
        context.log.error("Failed to approve photo:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
