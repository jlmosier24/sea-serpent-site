// Run from api/: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMeetResultsText } = require("../shared/meetResultsParser");
const { meetSummary, teamScore, swimmerEvents, mostImproved, swimmerTotals, statStrip, swimmerSeason } = require("../shared/stats");
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
    { meetId: "m1", meetDate: "2026-06-10", eventNumber: 3, eventName: "50m Free", status: "OK", place: 4, seedSeconds: 31, officialSeconds: 30, points: 2 },
    { meetId: "m2", meetDate: "2026-06-17", eventNumber: 3, eventName: "50m Free", status: "OK", place: 1, seedSeconds: 30, officialSeconds: 29.5, points: 6 },
    // Tied for 2nd, so 2nd and 3rd's points are split.
    { meetId: "m3", meetDate: "2026-06-24", eventNumber: 3, eventName: "50m Free", status: "OK", place: 2, seedSeconds: 29.5, officialSeconds: 29.8, points: 3.5 },
    { meetId: "m4", meetDate: "2026-07-01", eventNumber: 3, eventName: "50m Free", status: "DQ", place: null, seedSeconds: 29.5, officialSeconds: null, points: 0 },
    { meetId: "m5", meetDate: "2026-07-08", eventNumber: 3, eventName: "50m Free", status: "OK", place: 3, seedSeconds: 29.5, officialSeconds: 29, points: 3 },
    { meetId: "m5", meetDate: "2026-07-08", eventNumber: 9, eventName: "50m Back", status: "OK", place: 1, seedSeconds: 40, officialSeconds: 38, points: 6 },
    { meetId: "m6", meetDate: "2026-07-13", eventNumber: 9, eventName: "50m Back", status: "NS", place: null, seedSeconds: 38, officialSeconds: null, points: 0 }
];

test("swimmerEvents: change from the previous swim, personal bests, season best", () => {
    const [free, back] = swimmerEvents(season);
    assert.equal(free.eventName, "50m Free");
    assert.deepEqual(free.swims.map(s => s.change), [null, -0.5, 0.3, null, -0.8]);
    // A personal best beats the seed time and every earlier swim, so a first
    // swim under its seed is one; a slower swim and a DQ aren't.
    assert.deepEqual(free.swims.map(s => s.personalBest), [true, true, false, false, true]);
    assert.deepEqual(back.swims.map(s => s.personalBest), [true, false]);
    assert.equal(free.seasonBestSeconds, 29);
    assert.equal(back.seasonBestSeconds, 38);
});

test("swimmerEvents: a personal best needs a time to beat, and beats the seed too", () => {
    const swim = (meetId, meetDate, seedSeconds, officialSeconds) => ({ meetId, meetDate, eventNumber: 3, eventName: "25m Free", status: "OK", seedSeconds, officialSeconds });
    // No seed and no earlier swim: nothing to beat. Then faster than that first swim.
    const [noSeed] = swimmerEvents([swim("m1", "2026-06-10", null, 20), swim("m2", "2026-06-17", null, 19.5)]);
    assert.deepEqual(noSeed.swims.map(s => s.personalBest), [false, true]);
    // Faster than the last swim but not the seed (a best from before) isn't one.
    const [seeded] = swimmerEvents([swim("m1", "2026-06-10", 18, 20), swim("m2", "2026-06-17", 18, 19)]);
    assert.deepEqual(seeded.swims.map(s => s.personalBest), [false, false]);
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
    assert.equal(best.meetDate, "2026-07-08");
    // Meets swum leaves out m6, a no-show there; the DQ swim still got in the water.
    assert.deepEqual(totals, { personalBests: 4, points: 20.5, meetsSwum: 5 });
    assert.deepEqual(swimmerTotals([]), { personalBests: 0, points: 0, meetsSwum: 0, mostImproved: null });
});

// The stat strip's examples in design/update-2/UPDATE.md, section 2.
const drop = { seconds: 12.78, eventName: "50m Butterfly", meetDate: "2026-07-13" };
const stripKeys = items => items.map(i => i.key);

test("statStrip: the first three that apply, in order", () => {
    const strip = statStrip({ mostImproved: { ...drop, percent: 0.193 }, points: 7, personalBests: 5 }, 5);
    assert.deepEqual(strip, [
        { key: "mostImproved", seconds: 12.78, eventName: "50m Butterfly", meetDate: "2026-07-13" },
        { key: "points", value: 7 },
        { key: "personalBests", value: 5 }
    ]);
});

test("statStrip: without a most improved, relay legs fills the third spot", () => {
    assert.deepEqual(stripKeys(statStrip({ mostImproved: null, points: 36, personalBests: 3 }, 6)), ["points", "personalBests", "relayLegs"]);
    assert.deepEqual(stripKeys(statStrip({ mostImproved: null, points: 0, personalBests: 2 }, 1)), ["personalBests", "relayLegs"]);
});

test("statStrip: fewer than two that apply is no strip at all", () => {
    assert.deepEqual(statStrip({ mostImproved: null, points: 6, personalBests: 0 }, 0), []);
    assert.deepEqual(statStrip({ mostImproved: null, points: 0, personalBests: 0 }, 0), []);
});

test("swimmerSeason: age and season from the latest meet, saved badges, the strip, and each event's swims", () => {
    const swims = season.map(s => ({ ...s, name: "Doe, Jane", age: s.meetDate < "2026-07-01" ? 11 : 12, officialTime: s.officialSeconds == null ? s.status : String(s.officialSeconds) }));
    const badges = [{ id: "champion", name: "Champion", isNew: true }];
    // The saved totals also count a meet where they only swam a relay.
    const result = swimmerSeason("Doe, Jane", swims, { badges, totals: { relayLegs: 2, meetsSwum: 6 } });
    assert.equal(result.name, "Doe, Jane");
    assert.equal(result.age, 12);
    assert.equal(result.season, "2026");
    assert.equal(result.meetsSwum, 6);
    assert.deepEqual(result.badges, badges);
    assert.deepEqual(stripKeys(result.strip), ["mostImproved", "points", "personalBests"]);
    assert.deepEqual(result.events.map(e => e.eventName), ["50m Free", "50m Back"]);
    assert.deepEqual(Object.keys(result.events[0].swims[0]).sort(), ["change", "meetDate", "meetId", "officialSeconds", "officialTime", "personalBest", "place", "status"]);
    assert.deepEqual(result.events[1].swims.map(s => s.status), ["OK", "NS"]);

    // Before any badges have been worked out.
    const bare = swimmerSeason("Doe, Jane", swims);
    assert.deepEqual(bare.badges, []);
    assert.equal(bare.meetsSwum, 5);
});
