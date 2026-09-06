const { getMeetsTable, toMeetDto, sortByDate, PARTITION_KEY } = require("../shared/meetsTable");

// Reachable at /api/meets. Public -- returns non-hidden meets only.
module.exports = async function (context, req) {
    try {
        const table = getMeetsTable();
        const meets = [];
        for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
            const dto = toMeetDto(entity);
            if (!dto.hidden) meets.push(dto);
        }
        context.res = { status: 200, body: sortByDate(meets) };
    } catch (e) {
        context.log.error("Failed to list meets:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
