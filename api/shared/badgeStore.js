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

    // Also creates the table the first time.
    await saveSwimmerNames(badgesTable, swimmerNames(swims), {
        ages: swimmerAges(swims),
        badgesEarned: everyone.reduce((total, e) => total + e.badges.length, 0)
    });
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

// Each swimmer's age: the oldest on record, so this season's.
function swimmerAges(swims) {
    const ages = {};
    for (const swim of swims) {
        if (swim.age != null && !(swim.age <= ages[swim.name])) ages[swim.name] = swim.age;
    }
    return ages;
}

// Saved with the names: each swimmer's age (for the search's age groups) and
// how many badges the team holds in all (for the Stats page's season totals,
// null when not worked out).
async function saveSwimmerNames(badgesTable, names, { ages = {}, badgesEarned = null } = {}) {
    await badgesTable.createTable(); // no-op once it exists
    await badgesTable.upsertEntity({
        partitionKey: NAMES_PARTITION_KEY,
        rowKey: NAMES_ROW_KEY,
        namesJson: JSON.stringify(names),
        agesJson: JSON.stringify(ages),
        ...(badgesEarned != null ? { badgesEarned } : {})
    }, "Replace");
}

// The saved list: { swimmers, ages, badgesEarned }, or null before one has been saved.
async function readSwimmerList(badgesTable) {
    try {
        const entity = await badgesTable.getEntity(NAMES_PARTITION_KEY, NAMES_ROW_KEY);
        return {
            swimmers: JSON.parse(entity.namesJson || "[]"),
            ages: JSON.parse(entity.agesJson || "{}"),
            badgesEarned: entity.badgesEarned != null ? entity.badgesEarned : null
        };
    } catch (e) {
        if (e.statusCode === 404) return null;
        throw e;
    }
}

// How many badges the team holds, counted from every swimmer's saved badges.
async function countBadges(badgesTable) {
    let total = 0;
    try {
        for await (const entity of badgesTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
            total += JSON.parse(entity.badgesJson || "[]").length;
        }
    } catch (e) {
        if (e.statusCode === 404) return 0; // no badges worked out yet
        throw e;
    }
    return total;
}

// Just the saved names, or null before they've been saved.
async function readSwimmerNames(badgesTable) {
    const list = await readSwimmerList(badgesTable);
    return list && list.swimmers;
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

module.exports = { getBadgesTable, recomputeBadges, readSwimmerBadges, saveSwimmerNames, readSwimmerNames, readSwimmerList, countBadges, PARTITION_KEY };
