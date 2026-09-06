const { getMeetsTable, toMeetDto, sortByDate, PARTITION_KEY } = require("../shared/meetsTable");

// Reachable at /api/manageMeetsList. Protected by an explicit route rule in
// staticwebapp.config.json (requires the "administrator" role) -- returns
// every meet, hidden or not.
module.exports = async function (context, req) {
    try {
        const table = getMeetsTable();
        const meets = [];
        for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
            meets.push(toMeetDto(entity));
        }
        context.res = { status: 200, body: sortByDate(meets) };
    } catch (e) {
        context.log.error("Failed to list meets:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
