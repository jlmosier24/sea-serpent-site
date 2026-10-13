const { getResultsTable } = require("../shared/resultsTable");
const { getMeetsTable } = require("../shared/meetsTable");
const { getBadgesTable } = require("../shared/badgeStore");
const { getRecordsTable, listRecords, keyForEvent, sameTime } = require("../shared/teamRecords");
const { parseEvent, readLeaderboards, saveLeaderboards, leaderboardsFromResults } = require("../shared/leaderboards");

// Reachable at /api/leaderboards. Public, Spotswood only. The season's
// leaderboards (shared/leaderboards.js), saved after each import; until the
// first one they're worked out once and saved. Each event comes with what it
// is ({ gender, group, event }) and its current team record ({ time, year },
// never who holds it), and a row is marked teamRecord when that swim is the
// record now:
// { season, events: [{ eventName, gender, group, event, record, rows: [{ name, seconds, time, meetId, meetDate, teamRecord }] }] }.
module.exports = async function (context) {
    try {
        const badgesTable = getBadgesTable();
        let boards = await readLeaderboards(badgesTable);
        if (!boards) {
            boards = await leaderboardsFromResults(getResultsTable(), getMeetsTable());
            try {
                await saveLeaderboards(badgesTable, boards);
            } catch (e) {
                context.log.error("Failed to save the leaderboards:", e);
            }
        }
        let records = new Map();
        try {
            records = await listRecords(getRecordsTable());
        } catch (e) {
            context.log.error("Failed to load the team records:", e); // the boards still show without them
        }
        const events = boards.events.map(e => {
            const parsed = parseEvent(e.eventName);
            if (!parsed) return null;
            const r = records.get(keyForEvent(e.eventName));
            const record = r ? { time: r.time, seconds: r.seconds, year: r.year } : null;
            const rows = e.rows.map(row => ({ ...row, teamRecord: !!(row.teamRecord && record && sameTime(row.seconds, record.seconds)) }));
            return { eventName: e.eventName, ...parsed, record, rows };
        }).filter(Boolean);
        context.res = { status: 200, body: { season: boards.season, events } };
    } catch (e) {
        context.log.error("Failed to load the leaderboards:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
