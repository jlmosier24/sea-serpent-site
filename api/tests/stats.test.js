// Run from api/: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMeetResultsText } = require("../shared/meetResultsParser");
const { meetSummary, teamScore, swimmerEvents, mostImproved, swimmerTotals, rankHighlights, swimmerSeason } = require("../shared/stats");
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
    const { mostImproved: best, ...totals } = swimmerTotals(season);
    assert.equal(best.eventName, "50m Back");
    assert.deepEqual(totals, {
        // Meets swum leaves out m6 (a no-show there); events swum counts the DQ but not the no-show.
        firstPlaces: 2, topThree: 4, personalBests: 2, meetsSwum: 5, eventsSwum: 6,
        // For the tiles' captions: "2 different events", "Latest Jul 8", "Jun 10 to Jul 8".
        differentEvents: 2, latestPersonalBestDate: "2026-07-08", firstMeetDate: "2026-06-10", lastMeetDate: "2026-07-08"
    });
    assert.deepEqual(swimmerTotals([]), {
        firstPlaces: 0, topThree: 0, personalBests: 0, meetsSwum: 0, eventsSwum: 0, mostImproved: null,
        differentEvents: 0, latestPersonalBestDate: null, firstMeetDate: null, lastMeetDate: null
    });
});

// The four examples in design/mockups/spotswood_stats_header_states.html.
const totals = (overrides) => ({ mostImproved: null, firstPlaces: 0, topThree: 0, personalBests: 0, meetsSwum: 0, eventsSwum: 0, ...overrides });
const tileKeys = ranked => ranked.tiles.map(t => t.key);

test("highlights: plenty of podiums but no firsts yet", () => {
    const ranked = rankHighlights(totals({ mostImproved: { seconds: 12.78, percent: 0.193 }, topThree: 3, personalBests: 5, meetsSwum: 6, eventsSwum: 17 }));
    // 1st places is skipped at 0, so Meets swum fills the fourth tile and Events swum isn't needed.
    assert.deepEqual(tileKeys(ranked), ["mostImproved", "topThree", "personalBests", "meetsSwum"]);
    assert.deepEqual(ranked.tiles.map(t => t.gold), [true, false, false, false]);
    assert.equal(ranked.gettingStarted, false);
});

test("highlights: lots of firsts, and every podium was a win", () => {
    // A drop under 2% never becomes mostImproved, so it stays null here.
    const ranked = rankHighlights(totals({ firstPlaces: 6, topThree: 6, personalBests: 3, meetsSwum: 2, eventsSwum: 6 }));
    // Top-3 equals 1st places, so it would only repeat it.
    assert.deepEqual(tileKeys(ranked), ["firstPlaces", "personalBests", "meetsSwum", "eventsSwum"]);
    assert.equal(ranked.tiles[0].gold, true);
});

test("highlights: a swimmer's first meet gets one plain tile and the getting-started line", () => {
    const ranked = rankHighlights(totals({ meetsSwum: 1, eventsSwum: 3 }));
    assert.deepEqual(tileKeys(ranked), ["eventsSwum"]);
    // Events swum isn't a celebration stat, so it's never gold.
    assert.equal(ranked.tiles[0].gold, false);
    assert.equal(ranked.gettingStarted, true);
});

test("highlights: 3 firsts and 5 podiums keeps Top-3, since it adds something", () => {
    const ranked = rankHighlights(totals({ mostImproved: { seconds: 3.1, percent: 0.062 }, firstPlaces: 3, topThree: 5, personalBests: 4, meetsSwum: 5, eventsSwum: 14 }));
    assert.deepEqual(tileKeys(ranked), ["mostImproved", "firstPlaces", "topThree", "personalBests"]);
});

test("highlights: two plain tiles get no gold and no getting-started line", () => {
    const ranked = rankHighlights(totals({ meetsSwum: 2, eventsSwum: 4 }));
    assert.deepEqual(tileKeys(ranked), ["meetsSwum", "eventsSwum"]);
    assert.deepEqual(ranked.tiles.map(t => t.gold), [false, false]);
    assert.equal(ranked.gettingStarted, false);
    assert.deepEqual(rankHighlights(totals({})), { tiles: [], gettingStarted: true });
});

test("swimmerSeason: age and season from the latest meet, tiles, and each event's swims", () => {
    const swims = season.map(s => ({ ...s, name: "Doe, Jane", age: s.meetDate < "2026-07-01" ? 11 : 12, officialTime: s.officialSeconds == null ? s.status : String(s.officialSeconds) }));
    const result = swimmerSeason("Doe, Jane", swims);
    assert.equal(result.name, "Doe, Jane");
    assert.equal(result.age, 12);
    assert.equal(result.season, "2026");
    assert.deepEqual(tileKeys(result.highlights), ["mostImproved", "firstPlaces", "topThree", "personalBests"]);
    assert.deepEqual(result.events.map(e => e.eventName), ["50m Free", "50m Back"]);
    assert.deepEqual(Object.keys(result.events[0].swims[0]).sort(), ["change", "meetDate", "meetId", "officialSeconds", "officialTime", "personalBest", "place", "status"]);
    assert.deepEqual(result.events[1].swims.map(s => s.status), ["OK", "NS"]);
});
