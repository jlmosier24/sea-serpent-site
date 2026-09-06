const { getResultsPdfContainer } = require("../shared/resultsPdfContainer");
const { getResultsTable, getRelayResultsTable, toResultEntity, toRelayResultEntity } = require("../shared/resultsTable");
const { getMeetsTable, PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");
const { isSpotswoodTeam } = require("../shared/meetResultsParser");

// Reachable at /api/importMeetResultsCommit. Protected by an explicit route
// rule in staticwebapp.config.json (requires the "administrator" role).
// Takes the (admin-reviewed) rows from importMeetResultsPreview -- both
// teams' -- archives the original PDF as the source of record, and upserts
// the rows into Results/RelayResults as-is. Row keys are stable per
// meet+event (see shared/resultsTable.js), so re-importing the same meet
// updates rows instead of duplicating them. Results holding both teams is
// what makes resultsByMeet's complete per-meet view possible; swimmer-stats
// reads (listSwimmerNames, swimmerStats/index.js) filter back down to
// Spotswood themselves, so no filtering happens on the write side here.
module.exports = async function (context, req) {
    const { meetId, dataBase64, individual, relays, teamPoints } = req.body || {};

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

        // teamPoints covers every team seen in the PDF (see
        // meetResultsParser.js), not just the ones whose swimmer-level rows
        // got kept -- that's what makes a final score possible at all.
        // Best-effort: a failure here shouldn't roll back the results above.
        if (teamPoints && typeof teamPoints === "object") {
            try {
                let teamScore = 0, opponentScore = 0;
                for (const [team, points] of Object.entries(teamPoints)) {
                    if (isSpotswoodTeam(team)) teamScore += points;
                    else opponentScore += points;
                }
                const meetsTable = getMeetsTable();
                const meetEntity = await meetsTable.getEntity(MEET_PARTITION_KEY, meetId);
                meetEntity.teamScore = teamScore;
                meetEntity.opponentScore = opponentScore;
                await meetsTable.updateEntity(meetEntity, "Merge");
            } catch (e) {
                context.log.error("Failed to save meet score (non-fatal):", e);
            }
        }

        context.res = { status: 200, body: { savedIndividual: (individual || []).length, savedRelays: (relays || []).length } };
    } catch (e) {
        context.log.error("Failed to commit meet results:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
