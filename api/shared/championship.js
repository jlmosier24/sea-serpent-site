// The end-of-season championship (division finals): every team in the
// division at one meet, each event swum in flights (A, B, C) that are placed
// and scored on their own. The sheet's points are kept as printed (that's
// how the team scores add up); what changes here is each swimmer's place,
// which is ranked by time across every flight, so winning the B flight
// with the 9th-best time is 9th. The flight place is kept alongside.
const { isSpotswoodTeam } = require("./meetResultsParser");

// A sheet from a championship: its events are split into flights, or it
// scores more than two teams.
function isChampionshipSheet(parsed) {
    if ((parsed.individual || []).some(r => r.flight)) return true;
    const teams = parsed.sheetTeamScores && Object.keys(parsed.sheetTeamScores).length ? parsed.sheetTeamScores : parsed.teamPoints;
    return Object.keys(teams || {}).length > 2;
}

// Each individual row with its place across all flights, by official time:
// a swimmer's place is one more than the number of faster swimmers, so a
// tie shares a place. A swim without a place in its flight (a DQ, a
// no-show, an exhibition swim) gets none here either.
function withOverallPlaces(individual) {
    const byEvent = new Map();
    for (const row of individual) {
        if (row.place == null || row.officialSeconds == null) continue;
        if (!byEvent.has(row.eventNumber)) byEvent.set(row.eventNumber, []);
        byEvent.get(row.eventNumber).push(row.officialSeconds);
    }
    return individual.map(row => {
        if (!row.flight) return row;
        const times = byEvent.get(row.eventNumber);
        const place = row.place == null || row.officialSeconds == null || !times
            ? null
            : 1 + times.filter(t => t < row.officialSeconds).length;
        return { ...row, place, flightPlace: row.place };
    });
}

// Every team's overall place and score, best first: the sheet's Overall
// Combined table when it has one, otherwise each team's points added up.
function standings(parsed) {
    const overall = (parsed.teamScoreTables || []).find(t => t.section === "Overall" && t.group === "combined");
    const rows = overall
        ? overall.rows.map(r => ({ team: r.team, score: r.score, place: r.rank }))
        : Object.entries(parsed.teamPoints || {})
            .sort((a, b) => b[1] - a[1])
            .map(([team, score], i, all) => ({ team, score, place: 1 + all.filter(([, s]) => s > score).length }));
    return rows.sort((a, b) => a.place - b.place || a.team.localeCompare(b.team));
}

// Spotswood's line in the standings: { score, place, of } or null.
function ourStanding(table) {
    const ours = table.find(r => isSpotswoodTeam(r.team));
    return ours ? { score: ours.score, place: ours.place, of: table.length } : null;
}

module.exports = { isChampionshipSheet, withOverallPlaces, standings, ourStanding };
