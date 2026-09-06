const { getResultsPdfContainer } = require("../shared/resultsPdfContainer");
const { getResultsTable, getRelayResultsTable, toResultEntity, toRelayResultEntity } = require("../shared/resultsTable");

// Reachable at /api/importMeetResultsCommit. Protected by an explicit route
// rule in staticwebapp.config.json (requires the "administrator" role).
// Takes the (admin-reviewed) rows from importMeetResultsPreview, archives
// the original PDF as the source of record, and upserts the rows into
// Results/RelayResults. Row keys are stable per meet+event (see
// shared/resultsTable.js), so re-importing the same meet updates rows
// instead of duplicating them.
module.exports = async function (context, req) {
    const { meetId, dataBase64, individual, relays } = req.body || {};

    if (!meetId) {
        context.res = { status: 400, body: "Missing meetId." };
        return;
    }
    if (!Array.isArray(individual) && !Array.isArray(relays)) {
        context.res = { status: 400, body: "No result rows to save." };
        return;
    }

    try {
        if (dataBase64) {
            const buffer = Buffer.from(dataBase64, "base64");
            const blobName = `${meetId}-${Date.now()}.pdf`;
            await getResultsPdfContainer().getBlockBlobClient(blobName).uploadData(buffer, {
                blobHTTPHeaders: { blobContentType: "application/pdf" }
            });
        }

        const resultsTable = getResultsTable();
        for (const row of individual || []) {
            await resultsTable.upsertEntity(toResultEntity(row, meetId), "Replace");
        }

        const relayTable = getRelayResultsTable();
        for (const row of relays || []) {
            await relayTable.upsertEntity(toRelayResultEntity(row, meetId), "Replace");
        }

        context.res = { status: 200, body: { savedIndividual: (individual || []).length, savedRelays: (relays || []).length } };
    } catch (e) {
        context.log.error("Failed to commit meet results:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
