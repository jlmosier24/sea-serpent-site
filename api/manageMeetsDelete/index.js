const { getMeetsTable, PARTITION_KEY } = require("../shared/meetsTable");
const { getResultsTable, getRelayResultsTable, listMeetResultEntities, listMeetRelayEntities } = require("../shared/resultsTable");
const { getResultsPdfContainer, isSheetForMeet } = require("../shared/resultsPdfContainer");
const { forEachInBatches } = require("../shared/batches");

// Reachable at /api/manageMeetsDelete?id=... Admin only (the /api/manage*
// rule in staticwebapp.config.json). Deleting a meet also deletes its
// imported results and archived result sheets, as the admin page's
// confirmation says.
module.exports = async function (context, req) {
    const id = req.query.id;
    if (!id) {
        context.res = { status: 400, body: "Missing meet id." };
        return;
    }

    try {
        const resultsTable = getResultsTable();
        const results = await listMeetResultEntities(resultsTable, id);
        await forEachInBatches(results, entity => resultsTable.deleteEntity(entity.partitionKey, entity.rowKey));

        const relayTable = getRelayResultsTable();
        const relays = await listMeetRelayEntities(relayTable, id);
        await forEachInBatches(relays, entity => relayTable.deleteEntity(entity.partitionKey, entity.rowKey));

        const container = getResultsPdfContainer();
        const sheets = [];
        for await (const blob of container.listBlobsFlat({ prefix: `${id}-` })) {
            if (isSheetForMeet(blob.name, id)) sheets.push(blob.name);
        }
        await forEachInBatches(sheets, name => container.deleteBlob(name));

        // The meet itself goes last, so if anything above fails it's still
        // listed and can simply be deleted again.
        try {
            await getMeetsTable().deleteEntity(PARTITION_KEY, id);
        } catch (e) {
            const status = e.statusCode || (e.response && e.response.status);
            if (status !== 404) throw e;
        }

        context.res = { status: 200, body: { deletedResults: results.length, deletedRelays: relays.length, deletedSheets: sheets.length } };
    } catch (e) {
        context.log.error("Failed to delete meet:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
