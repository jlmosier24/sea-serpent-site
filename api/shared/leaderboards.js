const { isSpotswoodTeam } = require("./meetResultsParser");
const { toResultDto } = require("./resultsTable");
const { listMeets } = require("./meetsTable");
const { forEachInBatches } = require("./batches");

// The Stats page's leaderboards: for each individual meters event this
// season (the latest year with results), every Spotswood swimmer's best legal
// time, fastest first. Yards events (the championship) and relays aren't
// included. Worked out with the badges after each import or meet delete and
// saved in the SwimmerBadges table, one row per event, so the page doesn't
// scan every result.
const PARTITION_KEY = "leaderboard";

const EVENT_RE = /^(Girls|Boys|Women|Men)\s+(.+?)\s+(\d+m\s+(?:Freestyle|Backstroke|Breaststroke|Butterfly|IM))$/i;

// "Girls 9-10 25m Freestyle" -> { gender: "girls", group: "9-10", event: "25m Freestyle" },
// or null for a relay, a yards event, or one this doesn't recognise.
function parseEvent(eventName) {
    const m = String(eventName || "").trim().match(EVENT_RE);
    if (!m) return null;
    return { gender: /^(girls|women)$/i.test(m[1]) ? "girls" : "boys", group: m[2], event: m[3] };
}

// swims: Spotswood individual results, each with its meetDate.
function buildLeaderboards(swims) {
    const season = Math.max(0, ...swims.map(s => Number(String(s.meetDate || "").slice(0, 4)) || 0));
    const best = new Map(); // eventName -> name -> row
    for (const swim of swims) {
        if (Number(String(swim.meetDate || "").slice(0, 4)) !== season) continue;
        if (swim.status !== "OK" || swim.officialSeconds == null || !parseEvent(swim.eventName)) continue;
        const event = best.get(swim.eventName) || new Map();
        best.set(swim.eventName, event);
        const current = event.get(swim.name);
        // The faster swim, or the earlier one when the time is the same.
        if (current && (current.seconds < swim.officialSeconds || (current.seconds === swim.officialSeconds && current.meetDate <= swim.meetDate))) continue;
        event.set(swim.name, {
            name: swim.name,
            seconds: swim.officialSeconds,
            time: swim.officialTime,
            meetId: swim.meetId,
            meetDate: swim.meetDate,
            // Their age on that meet's sheet.
            age: swim.age != null ? swim.age : null,
            teamRecord: !!swim.teamRecord
        });
    }
    const events = [...best.entries()].map(([eventName, rows]) => ({
        eventName,
        rows: [...rows.values()].sort((a, b) => a.seconds - b.seconds || a.name.localeCompare(b.name))
    }));
    return { season: season || null, events };
}

async function saveLeaderboards(badgesTable, { season, events }) {
    await badgesTable.createTable(); // no-op once it exists
    const keep = new Set(events.map(e => encodeURIComponent(e.eventName)));
    await forEachInBatches(events, e => badgesTable.upsertEntity({
        partitionKey: PARTITION_KEY,
        rowKey: encodeURIComponent(e.eventName),
        eventName: e.eventName,
        season,
        rowsJson: JSON.stringify(e.rows)
    }, "Replace"));
    const gone = [];
    for await (const entity of badgesTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
        if (!keep.has(entity.rowKey)) gone.push(entity.rowKey);
    }
    await forEachInBatches(gone, rowKey => badgesTable.deleteEntity(PARTITION_KEY, rowKey));
}

// The saved boards, or null before any have been saved.
async function readLeaderboards(badgesTable) {
    const events = [];
    let season = null;
    try {
        for await (const entity of badgesTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
            season = entity.season || season;
            events.push({ eventName: entity.eventName, rows: JSON.parse(entity.rowsJson || "[]") });
        }
    } catch (e) {
        if (e.statusCode === 404) return null;
        throw e;
    }
    return events.length ? { season, events } : null;
}

// Before the first import saves them: worked out from every stored result.
async function leaderboardsFromResults(resultsTable, meetsTable) {
    const meetDates = new Map((await listMeets(meetsTable)).map(m => [m.id, m.date]));
    const swims = [];
    for await (const entity of resultsTable.listEntities()) {
        if (isSpotswoodTeam(entity.team)) swims.push({ ...toResultDto(entity), meetDate: meetDates.get(entity.meetId) || "" });
    }
    return buildLeaderboards(swims);
}

module.exports = { parseEvent, buildLeaderboards, saveLeaderboards, readLeaderboards, leaderboardsFromResults, PARTITION_KEY };
