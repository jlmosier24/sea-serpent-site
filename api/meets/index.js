const { getMeetsTable, toMeetDto, sortByDate, PARTITION_KEY } = require("../shared/meetsTable");

// Reachable at /api/meets. Public -- every meet, minus the admin-only
// details of where its score and results came from.
module.exports = async function (context, req) {
    try {
        const table = getMeetsTable();
        const meets = [];
        for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
            // eslint-disable-next-line no-unused-vars
            const { scoreSource, lastImportFile, lastImportAt, ...meet } = toMeetDto(entity);
            meets.push(meet);
        }
        context.res = { status: 200, body: sortByDate(meets) };
    } catch (e) {
        context.log.error("Failed to list meets:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
