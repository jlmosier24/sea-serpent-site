const { getMeetsTable, toMeetDto, homePoolFill, PARTITION_KEY } = require("../shared/meetsTable");
const { getSettingsTable, getHomePool } = require("../shared/settingsTable");

// Reachable at /api/manageMeetsFillHomePool. Admin only (the /api/manage*
// rule in staticwebapp.config.json). The "Fill them in" offer after saving
// the home pool: home meets missing a venue name or address get the pool's,
// and nothing already filled in changes (see homePoolFill).
module.exports = async function (context, req) {
    try {
        const pool = await getHomePool(getSettingsTable());
        if (!pool) {
            context.res = { status: 400, body: "Save a home pool first." };
            return;
        }

        const table = getMeetsTable();
        let updated = 0;
        for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
            const fill = homePoolFill(toMeetDto(entity), pool);
            if (!fill) continue;
            await table.updateEntity({ partitionKey: PARTITION_KEY, rowKey: entity.rowKey, ...fill }, "Merge");
            updated++;
        }
        context.res = { status: 200, body: { updated } };
    } catch (e) {
        context.log.error("Failed to fill home meets from the home pool:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
