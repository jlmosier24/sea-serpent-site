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

// The swimmer pickers' list of names is saved in the same table, as one row
// of its own, so listing them doesn't scan every result either. It holds the
// Spotswood swimmers with an individual swim, since a relay-only swimmer has
// no season for the Stats page to show.
const NAMES_PARTITION_KEY = "list";
const NAMES_ROW_KEY = "swimmerNames";

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

    await saveSwimmerNames(badgesTable, swimmerNames(swims)); // also creates the table the first time
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

function swimmerNames(swims) {
    return [...new Set(swims.map(swim => swim.name))].sort((a, b) => a.localeCompare(b));
}

async function saveSwimmerNames(badgesTable, names) {
    await badgesTable.createTable(); // no-op once it exists
    await badgesTable.upsertEntity({ partitionKey: NAMES_PARTITION_KEY, rowKey: NAMES_ROW_KEY, namesJson: JSON.stringify(names) }, "Replace");
}

// The saved list of names, or null before one has been saved.
async function readSwimmerNames(badgesTable) {
    try {
        const entity = await badgesTable.getEntity(NAMES_PARTITION_KEY, NAMES_ROW_KEY);
        return JSON.parse(entity.namesJson || "[]");
    } catch (e) {
        if (e.statusCode === 404) return null;
        throw e;
    }
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

module.exports = { getBadgesTable, recomputeBadges, readSwimmerBadges, saveSwimmerNames, readSwimmerNames, PARTITION_KEY };
