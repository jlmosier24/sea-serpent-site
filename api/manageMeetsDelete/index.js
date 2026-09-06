const { getMeetsTable, PARTITION_KEY } = require("../shared/meetsTable");

// Reachable at /api/manageMeetsDelete?id=... Protected by an explicit route
// rule in staticwebapp.config.json (requires the "administrator" role).
module.exports = async function (context, req) {
    const id = req.query.id;
    if (!id) {
        context.res = { status: 400, body: "Missing meet id." };
        return;
    }

    try {
        const table = getMeetsTable();
        await table.deleteEntity(PARTITION_KEY, id);
        context.res = { status: 200, body: "Deleted" };
    } catch (e) {
        context.log.error("Failed to delete meet:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
