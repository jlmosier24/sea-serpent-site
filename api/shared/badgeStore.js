const { TableClient } = require("@azure/data-tables");
const { toResultDto, toRelayResultDto } = require("./resultsTable");
const { listMeets } = require("./meetsTable");
const { isSpotswoodTeam } = require("./meetResultsParser");
const { teamBadges } = require("./badges");
const { forEachInBatches } = require("./batches");

// Every Spotswood swimmer's badges, worked out from all stored results each
// time results are imported or a meet is deleted (a meet can change the
// badges of anyone who swam in it or after it), then saved so the Stats page
// can read one swimmer's without scanning every result.
const PARTITION_KEY = "swimmer";

function getBadgesTable() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    return TableClient.fromConnectionString(connectionString, "SwimmerBadges");
}

// Table keys can't hold some characters (/ \ # ?), so names are encoded.
const rowKeyFor = name => encodeURIComponent(name);

async function recomputeBadges({ resultsTable, relayTable, meetsTable, badgesTable }) {
    const meetDates = new Map((await listMeets(meetsTable)).map(m => [m.id, m.date]));
    const withDate = row => ({ ...row, meetDate: meetDates.get(row.meetId) || "" });
    const swims = [];
    const relays = [];
    for await (const entity of resultsTable.listEntities()) {
        if (isSpotswoodTeam(entity.team)) swims.push(withDate(toResultDto(entity)));
    }
    for await (const entity of relayTable.listEntities()) {
        if (isSpotswoodTeam(entity.team)) relays.push(withDate(toRelayResultDto(entity)));
    }
    const everyone = teamBadges(swims, relays);

    await badgesTable.createTable(); // no-op once it exists
    await forEachInBatches(everyone, e => badgesTable.upsertEntity({
        partitionKey: PARTITION_KEY,
        rowKey: rowKeyFor(e.name),
        name: e.name,
        badgesJson: JSON.stringify(e.badges),
        totalsJson: JSON.stringify(e.totals)
    }, "Replace"));

    // Someone whose only results were in a deleted meet has no badges left.
    const names = new Set(everyone.map(e => e.name));
    const gone = [];
    for await (const entity of badgesTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
        if (!names.has(entity.name)) gone.push(entity.rowKey);
    }
    await forEachInBatches(gone, rowKey => badgesTable.deleteEntity(PARTITION_KEY, rowKey));
    return { swimmers: names.size, removed: gone.length };
}

// One swimmer's saved badges (already in display order) and totals, or none
// before badges have been worked out.
async function readSwimmerBadges(badgesTable, name) {
    try {
        const entity = await badgesTable.getEntity(PARTITION_KEY, rowKeyFor(name));
        return { badges: JSON.parse(entity.badgesJson || "[]"), totals: JSON.parse(entity.totalsJson || "null") };
    } catch (e) {
        if (e.statusCode === 404) return { badges: [], totals: null };
        throw e;
    }
}

module.exports = { getBadgesTable, recomputeBadges, readSwimmerBadges, PARTITION_KEY };
