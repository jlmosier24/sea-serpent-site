// Run from api/: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMeetResultsText } = require("../shared/meetResultsParser");
const { meetSummary, teamScore, swimmerEvents, mostImproved, swimmerTotals } = require("../shared/stats");
const { SHEET } = require("./sampleSheet");

test("meetSummary counts Spotswood's swims by the handoff's definitions", () => {
    const parsed = parseMeetResultsText(SHEET);
    const s = meetSummary(parsed.individual, parsed.relays);
    assert.equal(s.swims, 5);          // every Spotswood entry, DQs and no-shows included
    assert.equal(s.swimmers, 5);
    assert.equal(s.relays, 2);         // A and the exhibition C
    assert.equal(s.firstPlaces, 1);
    assert.equal(s.topThree, 2);       // includes the tie for second
    assert.equal(s.relayWins, 1);
    assert.equal(s.relayEvents, 1);
    assert.equal(s.firstTimeSwims, 1); // NT seed and a time; the exhibition swim isn't scored
    assert.deepEqual([s.fasterThanSeed, s.timedWithSeed], [1, 1]);
    assert.deepEqual([s.dqs, s.noShows], [0, 1]);
    assert.equal(s.biggestDrop.eventName, "Girls 8 & Under 25m Freestyle");
    assert.equal(s.biggestDrop.seconds, 0.6);
});

test("biggest drop leaves out swimmers under 7, whose seeds are often placeholders", () => {
    const rows = [
        { name: "A", team: "Spotswood", age: 6, status: "OK", place: 1, seedSeconds: 60, officialSeconds: 30, eventName: "e" },
        { name: "B", team: "Spotswood", age: 7, status: "OK", place: 2, seedSeconds: 40, officialSeconds: 38, eventName: "e" }
    ];
    assert.equal(meetSummary(rows, []).biggestDrop.name, "B");
    assert.equal(meetSummary(rows.slice(0, 1), []).biggestDrop, null);
});

test("ties for first count as wins; only A and B relays can win", () => {
    const rows = [
        { name: "A", team: "Spotswood", status: "OK", place: 1 },
        { name: "B", team: "Spotswood", status: "OK", place: 1 },
        { name: "C", team: "Test Seahawks", status: "OK", place: 1 }
    ];
    const relays = [
        { team: "Spotswood", relayLetter: "A", status: "OK", place: 1, eventNumber: 5 },
        { team: "Spotswood", relayLetter: "C", status: "OK", place: 1, eventNumber: 6 },
        { team: "Spotswood", relayLetter: "B", status: "EXH", place: null, eventNumber: 7 }
    ];
    const s = meetSummary(rows, relays);
    assert.equal(s.firstPlaces, 2);
    assert.deepEqual([s.relayWins, s.relayEvents], [1, 3]);
});

test("teamScore uses the sheet's Team Scores page when it has one, otherwise the points", () => {
    const parsed = parseMeetResultsText(SHEET);
    assert.deepEqual(teamScore(parsed), { us: 525, them: 511, source: "sheet" });
    assert.deepEqual(teamScore({ ...parsed, sheetTeamScores: null }), { us: 17.5, them: 4.5, source: "points" });
    assert.equal(teamScore({ teamPoints: {}, sheetTeamScores: null }), null);
});

const season = [
    { meetId: "m1", meetDate: "2026-06-10", eventNumber: 3, eventName: "50m Free", status: "OK", place: 4, seedSeconds: 31, officialSeconds: 30 },
    { meetId: "m2", meetDate: "2026-06-17", eventNumber: 3, eventName: "50m Free", status: "OK", place: 1, seedSeconds: 30, officialSeconds: 29.5 },
    { meetId: "m3", meetDate: "2026-06-24", eventNumber: 3, eventName: "50m Free", status: "OK", place: 2, seedSeconds: 29.5, officialSeconds: 29.8 },
    { meetId: "m4", meetDate: "2026-07-01", eventNumber: 3, eventName: "50m Free", status: "DQ", place: null, seedSeconds: 29.5, officialSeconds: null },
    { meetId: "m5", meetDate: "2026-07-08", eventNumber: 3, eventName: "50m Free", status: "OK", place: 3, seedSeconds: 29.5, officialSeconds: 29 },
    { meetId: "m5", meetDate: "2026-07-08", eventNumber: 9, eventName: "50m Back", status: "OK", place: 1, seedSeconds: 40, officialSeconds: 38 },
    { meetId: "m6", meetDate: "2026-07-13", eventNumber: 9, eventName: "50m Back", status: "NS", place: null, seedSeconds: 38, officialSeconds: null }
];

test("swimmerEvents: change from the previous swim, personal bests, season best", () => {
    const [free, back] = swimmerEvents(season);
    assert.equal(free.eventName, "50m Free");
    assert.deepEqual(free.swims.map(s => s.change), [null, -0.5, 0.3, null, -0.8]);
    // The first swim has nothing to beat; a slower swim and a DQ aren't bests.
    assert.deepEqual(free.swims.map(s => s.personalBest), [false, true, false, false, true]);
    assert.equal(free.seasonBestSeconds, 29);
    assert.equal(back.seasonBestSeconds, 38);
});

test("mostImproved is the biggest percent drop below seed, and needs 2%", () => {
    const best = mostImproved(season);
    assert.equal(best.eventName, "50m Back");
    assert.equal(best.seconds, 2);
    assert.equal(best.percent, 0.05);
    // 30.0 -> 29.5 is under 2% (1.7%), so on its own it doesn't count.
    assert.equal(mostImproved([season[1]]), null);
});

test("swimmerTotals", () => {
    assert.deepEqual(
        (({ firstPlaces, topThree, personalBests, meetsSwum, eventsSwum }) => ({ firstPlaces, topThree, personalBests, meetsSwum, eventsSwum }))(swimmerTotals(season)),
        // Meets swum leaves out m6 (a no-show there); events swum counts the DQ but not the no-show.
        { firstPlaces: 2, topThree: 4, personalBests: 2, meetsSwum: 5, eventsSwum: 6 }
    );
});
