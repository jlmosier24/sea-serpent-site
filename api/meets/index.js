const { getMeetsTable, toMeetDto, sortByDate, PARTITION_KEY } = require("../shared/meetsTable");
const { getResultsTable, getRelayResultsTable, toResultDto, toRelayResultDto, listMeetResultEntities, listMeetRelayEntities } = require("../shared/resultsTable");
const { meetFlow } = require("../shared/stats");

// Meets imported before the meet flow chart (2026-10-21) get theirs worked
// out from their stored results the first time they're listed, and saved
// with their numbers, so it's done once. A failure leaves it for next time.
async function addFlow(context, table, meet) {
    try {
        const individual = (await listMeetResultEntities(getResultsTable(), meet.id)).map(toResultDto);
        const relays = (await listMeetRelayEntities(getRelayResultsTable(), meet.id)).map(toRelayResultDto);
        const summary = { ...meet.summary, flow: meetFlow(individual, relays) };
        await table.updateEntity({ partitionKey: PARTITION_KEY, rowKey: meet.id, summaryJson: JSON.stringify(summary) }, "Merge");
        meet.summary = summary;
    } catch (e) {
        context.log.error(`Failed to add the meet flow for ${meet.id}:`, e);
    }
}

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
        for (const meet of meets) {
            if (meet.summary && !("flow" in meet.summary)) await addFlow(context, table, meet);
        }
        context.res = { status: 200, body: sortByDate(meets) };
    } catch (e) {
        context.log.error("Failed to list meets:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
