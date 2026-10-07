const { getResultsPdfContainer, sheetBlobName } = require("../shared/resultsPdfContainer");
const {
    getResultsTable, getRelayResultsTable, toResultEntity, toRelayResultEntity,
    listMeetResultEntities, listMeetRelayEntities
} = require("../shared/resultsTable");
const { getMeetsTable, toMeetDto, PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");
const { readResultsSheet } = require("../shared/resultsSheet");
const { meetSummary, teamScore } = require("../shared/stats");
const { forEachInBatches } = require("../shared/batches");
const { getBadgesTable, recomputeBadges } = require("../shared/badgeStore");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
}
function entityKey(entity) {
    return `${entity.partitionKey}\u0000${entity.rowKey}`;
}

// Saves `entities`, then deletes whatever else is stored for the meet. A
// re-import therefore replaces the meet's results without duplicating any,
// and a failure partway through leaves the old results in place.
async function replaceMeetRows(table, entities, existing) {
    await forEachInBatches(entities, entity => table.upsertEntity(entity, "Replace"));
    const keep = new Set(entities.map(entityKey));
    const leftovers = existing.filter(entity => !keep.has(entityKey(entity)));
    await forEachInBatches(leftovers, entity => table.deleteEntity(entity.partitionKey, entity.rowKey));
    return leftovers.length;
}

// Reachable at /api/importMeetResultsCommit. Admin only (route rules in
// staticwebapp.config.json). Body: { meetId, fileName, dataBase64,
// importAnyway }. Reads the PDF again rather than trusting rows from the
// browser, archives it as the source of record, and saves both teams' rows
// (resultsByMeet shows full results; swimmer stats filter to Spotswood when
// they read). The sheet's date must match the meet's unless importAnyway is
// set -- the dialog asks first, and this enforces it.
module.exports = async function (context, req) {
    const { meetId, fileName, dataBase64, importAnyway } = req.body || {};
    if (!meetId) {
        context.res = { status: 400, body: "Missing meetId." };
        return;
    }

    try {
        const meetsTable = getMeetsTable();
        let meetEntity;
        try {
            meetEntity = await meetsTable.getEntity(MEET_PARTITION_KEY, meetId);
        } catch (e) {
            const status = e.statusCode || (e.response && e.response.status);
            if (status === 404) {
                context.res = { status: 404, body: "That meet no longer exists." };
                return;
            }
            throw e;
        }

        let sheet;
        try {
            sheet = await readResultsSheet(dataBase64);
        } catch (e) {
            if (e.status === 400) {
                context.res = { status: 400, body: e.message };
                return;
            }
            throw e;
        }
        const { buffer, parsed } = sheet;
        if (!parsed.individual.length && !parsed.relays.length) {
            context.res = { status: 400, body: "No results were found in that PDF." };
            return;
        }
        if (parsed.sheetDate && parsed.sheetDate !== meetEntity.date && !importAnyway) {
            context.res = { status: 409, body: `This sheet is dated ${fmtDate(parsed.sheetDate)}, but the meet is ${fmtDate(meetEntity.date)}.` };
            return;
        }

        const replaced = toMeetDto(meetEntity).resultsImported;
        await getResultsPdfContainer().getBlockBlobClient(sheetBlobName(meetId)).uploadData(buffer, {
            blobHTTPHeaders: { blobContentType: "application/pdf" }
        });

        const resultsTable = getResultsTable();
        const relayTable = getRelayResultsTable();
        const removed =
            await replaceMeetRows(resultsTable, parsed.individual.map(row => toResultEntity(row, meetId)), await listMeetResultEntities(resultsTable, meetId)) +
            await replaceMeetRows(relayTable, parsed.relays.map(row => toRelayResultEntity(row, meetId)), await listMeetRelayEntities(relayTable, meetId));

        // A score the admin typed in is never replaced by an import. The
        // meet's numbers are saved with it for the home page's results popup.
        const scoreKept = meetEntity.scoreSource === "manual";
        const score = teamScore(parsed);
        const summary = meetSummary(parsed.individual, parsed.relays);
        const update = {
            partitionKey: MEET_PARTITION_KEY,
            rowKey: meetId,
            resultsImported: true,
            lastImportFile: String(fileName || "").slice(0, 200),
            lastImportAt: new Date().toISOString(),
            summaryJson: JSON.stringify(summary)
        };
        if (score && !scoreKept) Object.assign(update, { teamScore: score.us, opponentScore: score.them, scoreSource: "import" });
        await meetsTable.updateEntity(update, "Merge");

        // Badges compare teammates, so everyone's are worked out again. A failure
        // here doesn't undo the import; the next import or delete tries again.
        let badgesUpdated = true;
        try {
            await recomputeBadges({ resultsTable, relayTable, meetsTable, badgesTable: getBadgesTable() });
        } catch (e) {
            badgesUpdated = false;
            context.log.error("Failed to update badges:", e);
        }

        context.res = {
            status: 200,
            body: {
                replaced,
                swims: summary.swims,
                relays: summary.relays,
                swimmers: summary.swimmers,
                removedRows: removed,
                teamScore: scoreKept
                    ? { us: meetEntity.teamScore, them: meetEntity.opponentScore, source: "manual" }
                    : score,
                badgesUpdated
            }
        };
    } catch (e) {
        context.log.error("Failed to import meet results:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
