const { TableClient } = require("@azure/data-tables");
const { isSpotswoodTeam } = require("./meetResultsParser");

function getResultsTable() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    return TableClient.fromConnectionString(connectionString, "Results");
}

function getRelayResultsTable() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    return TableClient.fromConnectionString(connectionString, "RelayResults");
}

// PartitionKey is the swimmer's name (so "all of this swimmer's results" is
// a single partition query) and RowKey is stable per meet+event, so
// re-importing the same meet updates rows in place instead of duplicating.
function resultRowKey(meetId, eventNumber) {
    return `${meetId}__${eventNumber}`;
}

function toResultEntity(row, meetId) {
    return {
        partitionKey: row.name,
        rowKey: resultRowKey(meetId, row.eventNumber),
        meetId,
        eventNumber: row.eventNumber,
        eventName: row.eventName,
        age: row.age,
        team: row.team,
        place: row.place,
        status: row.status,
        seedTime: row.seedTime || "",
        officialTime: row.officialTime || "",
        seedSeconds: row.seedSeconds,
        officialSeconds: row.officialSeconds,
        points: row.points || 0,
        dqReason: row.dqReason || ""
    };
}

function toResultDto(entity) {
    return {
        name: entity.partitionKey,
        meetId: entity.meetId,
        eventNumber: entity.eventNumber,
        eventName: entity.eventName,
        age: entity.age,
        team: entity.team,
        place: entity.place,
        status: entity.status,
        seedTime: entity.seedTime,
        officialTime: entity.officialTime,
        seedSeconds: entity.seedSeconds,
        officialSeconds: entity.officialSeconds,
        points: entity.points,
        dqReason: entity.dqReason
    };
}

// PartitionKey is the meet id (relays aren't queried per-swimmer the way
// individual results are), RowKey is stable per meet+event+relay leg.
function relayRowKey(meetId, eventNumber, relayLetter) {
    return `${meetId}__${eventNumber}__${relayLetter}`;
}

function toRelayResultEntity(row, meetId) {
    return {
        partitionKey: meetId,
        rowKey: relayRowKey(meetId, row.eventNumber, row.relayLetter),
        meetId,
        eventNumber: row.eventNumber,
        eventName: row.eventName,
        relayLetter: row.relayLetter,
        teamAbbrev: row.teamAbbrev,
        team: row.team,
        place: row.place,
        status: row.status,
        seedTime: row.seedTime || "",
        officialTime: row.officialTime || "",
        seedSeconds: row.seedSeconds,
        officialSeconds: row.officialSeconds,
        points: row.points || 0,
        swimmersJson: JSON.stringify(row.swimmers || [])
    };
}

function toRelayResultDto(entity) {
    let swimmers = [];
    try { swimmers = JSON.parse(entity.swimmersJson || "[]"); } catch (e) { swimmers = []; }
    return {
        meetId: entity.meetId,
        eventNumber: entity.eventNumber,
        eventName: entity.eventName,
        relayLetter: entity.relayLetter,
        teamAbbrev: entity.teamAbbrev,
        team: entity.team,
        place: entity.place,
        status: entity.status,
        seedTime: entity.seedTime,
        officialTime: entity.officialTime,
        seedSeconds: entity.seedSeconds,
        officialSeconds: entity.officialSeconds,
        points: entity.points,
        swimmers
    };
}

// Every distinct Spotswood swimmer name seen in Results, for stats.html's
// picker -- there's no separately-maintained roster table (see build plan).
// Results now holds both teams' rows (see meetResultsParser.js), so this
// filters by team; swimmer-stats tracking is Spotswood-only by design, even
// though the opposing team's rows are in the same table for resultsByMeet.
async function listSwimmerNames() {
    const table = getResultsTable();
    const names = new Set();
    for await (const entity of table.listEntities()) {
        if (isSpotswoodTeam(entity.team)) names.add(entity.partitionKey);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
}

module.exports = {
    getResultsTable, getRelayResultsTable,
    toResultEntity, toResultDto,
    toRelayResultEntity, toRelayResultDto,
    listSwimmerNames
};
