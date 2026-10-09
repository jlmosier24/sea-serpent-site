// Run from api/: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMeetResultsText } = require("../shared/meetResultsParser");
const { meetSummary, teamScore, swimmerEvents, swimmerSeason } = require("../shared/stats");
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
    assert.deepEqual(s.highlights.biggestDrops.map(d => [d.eventName, d.seconds]), [["Girls 8 & Under 25m Freestyle", 0.6]]);
});

test("biggest time drops: one per age group by percent below seed, all ages, ties shown", () => {
    const swim = (name, age, eventNumber, seedSeconds, officialSeconds, extra = {}) =>
        ({ name, team: "Spotswood", age, eventNumber, eventName: "Girls 8 & Under 25m Freestyle", status: "OK", place: 3, seedSeconds, officialSeconds, ...extra });
    const individual = [
        swim("Moe, Mia", 5, 1, 60, 45),    // 6 & under: 25% and 15 s
        swim("Loe, Liz", 6, 2, 40, 36),    // 10%
        swim("Doe, Jane", 7, 3, 30, 27),   // 7-8: 10%
        swim("Poe, Pam", 8, 4, 40, 36),    // 10% too: a tie, both shown
        swim("Koe, Kim", 8, 5, 20, 21),    // slower than her seed
        swim("Roe, Rae", 11, 6, 40, 30, { seedConverted: true }), // a converted seed doesn't count
        swim("Zoe, Zed", 11, 7, null, 30)  // no seed
    ];
    const drops = meetSummary(individual, []).highlights.biggestDrops;
    assert.deepEqual(drops.map(d => [d.group, d.name, d.seconds]), [
        ["6 & under", "Moe, Mia", 15],
        ["7-8", "Doe, Jane", 3],
        ["7-8", "Poe, Pam", 4]
    ]);
});

test("a seed converted from the other course is left out of the seed comparisons", () => {
    const rows = [
        // Ten seconds under a converted seed: not a real drop, so it counts nowhere.
        { name: "A", team: "Spotswood", age: 9, status: "OK", place: 1, seedSeconds: 40, seedConverted: true, officialSeconds: 30, eventName: "e" },
        { name: "B", team: "Spotswood", age: 9, status: "OK", place: 2, seedSeconds: 40, officialSeconds: 38, eventName: "e" }
    ];
    const s = meetSummary(rows, []);
    assert.deepEqual([s.fasterThanSeed, s.timedWithSeed], [1, 1]);
    assert.deepEqual(s.highlights.biggestDrops.map(d => d.name), ["B"]);
});

test("meet tiles: personal bests against earlier meets, point scorers, and time dropped below real seeds", () => {
    const swim = (name, eventNumber, eventName, officialSeconds, extra = {}) =>
        ({ name, team: "Spotswood", age: 10, eventNumber, eventName, status: "OK", place: 4, officialSeconds, points: 0, seedSeconds: null, ...extra });
    const earlier = [
        swim("Doe, Jane", 1, "Girls 9-10 50m Freestyle", 40),
        swim("Doe, Jane", 2, "Girls 9-10 50m Backstroke", 45),
        swim("Poe, Pam", 1, "Girls 9-10 50m Freestyle", 41)
    ];
    const individual = [
        swim("Doe, Jane", 1, "Girls 9-10 50m Freestyle", 39.5, { points: 2, seedSeconds: 41 }),        // a PB, and 1.5 below its seed
        swim("Doe, Jane", 2, "Girls 9-10 50m Backstroke", 46, { seedSeconds: 50, seedConverted: true }), // slower, and a converted seed
        swim("Poe, Pam", 1, "Girls 9-10 50m Freestyle", 40.5, { points: 1, seedSeconds: 40 }),         // a PB, though over its seed
        swim("Koe, Kim", 3, "Girls 9-10 25m Butterfly", 20, { seedSeconds: 22 }),                      // a first swim, 2.0 below its seed
        swim("Loe, Liz", 3, "Girls 9-10 25m Butterfly", null, { status: "NS" })                        // didn't race
    ];
    const s = meetSummary(individual, [], earlier);
    assert.deepEqual([s.personalBests, s.personalBestSwimmers, s.comparableSwims], [2, 2, 3]);
    assert.deepEqual([s.pointScorers, s.swimmersRaced], [2, 3]);
    assert.equal(s.timeDropped, 3.5, "the converted seed's drop doesn't count");
    // A first meet has nothing earlier to compare with.
    assert.deepEqual(((({ personalBests, comparableSwims }) => [personalBests, comparableSwims])(meetSummary(individual, []))), [0, 0]);
});

test("points by age group: All adds up to the team's points, and so do Boys and Girls together", () => {
    const swim = (age, eventNumber, eventName, place, points, team = "Spotswood") => ({ name: `S${eventNumber}`, team, age, eventNumber, eventName, status: "OK", place, points });
    const individual = [
        swim(6, 1, "Girls 6 & Under 25m Freestyle", 1, 6),
        swim(8, 2, "Boys 7-8 25m Backstroke", 2, 4),
        swim(13, 3, "Girls 13-14 100m IM", 2, 3.5), // tied for 2nd
        swim(17, 4, "Men 15-18 50m Butterfly", 5, 1),
        swim(12, 5, "Girls 11-12 50m Breaststroke", 6, 0),
        swim(12, 5, "Girls 11-12 50m Breaststroke", 1, 6, "Test Seahawks") // the other team's points aren't ours
    ];
    const relay = (eventNumber, eventName, place, points, ages = []) => ({ team: "Spotswood", relayLetter: "A", status: "OK", eventNumber, eventName, place, points, swimmers: ages.map((age, i) => ({ name: `R${eventNumber}-${i}`, age })) });
    const relays = [
        // 8 & under: shared four ways, each to the swimmer's own age group (2 points each).
        relay(10, "Girls 8 & Under 100m Freestyle Relay", 1, 8, [6, 7, 8, 8]),
        // Only three listed: the 2 points are split among them, so they all land somewhere.
        relay(11, "Boys 8 & Under 100m Freestyle Relay", 3, 2, [6, 8, 8]),
        relay(12, "Boys 9-10 100m Freestyle Relay", 2, 4, [9, 9, 10, 10]),
        relay(13, "Girls 12 & Under 100m Medley Relay", 2, 4),    // spans age groups: Mixed relays
        relay(14, "Women 18 & Under 125m Freestyle Relay", 1, 8) // Mixed relays too
    ];
    const { pointsBy } = meetSummary(individual, relays);
    const total = rows => Math.round(rows.reduce((n, r) => n + r.points, 0) * 100) / 100;
    // 14.5 individual and 26 relay points.
    assert.equal(total(pointsBy.all), 40.5);
    assert.equal(total(pointsBy.boys) + total(pointsBy.girls), 40.5);
    const rows = tab => pointsBy[tab].map(r => [r.label, r.points]);
    assert.deepEqual(rows("all"), [["6 & under", 8.67], ["7-8", 11.33], ["9-10", 4], ["11-12", 0], ["13-14", 3.5], ["15-18", 1], ["Mixed relays", 12]]);
    assert.deepEqual(rows("boys"), [["6 & under", 0.67], ["7-8", 5.33], ["9-10", 4], ["11-12", 0], ["13-14", 0], ["15-18", 1], ["Mixed relays", 0]]);
    assert.deepEqual(rows("girls"), [["6 & under", 8], ["7-8", 6], ["9-10", 0], ["11-12", 0], ["13-14", 3.5], ["15-18", 0], ["Mixed relays", 12]]);
});

test("triple winners with their events; top point scorers only when there are none", () => {
    const swim = (name, age, eventNumber, eventName, place, points, status = "OK") =>
        ({ name, team: "Spotswood", age, eventNumber, eventName, status, place, points, officialSeconds: 30 });
    const triple = [
        swim("Doe, Jane", 11, 3, "Girls 11-12 50m Butterfly", 1, 6),
        swim("Doe, Jane", 11, 1, "Girls 11-12 50m Freestyle", 1, 6),
        swim("Doe, Jane", 11, 5, "Girls 11-12 100m IM", 1, 6)
    ];
    const others = [
        swim("Poe, Sam", 9, 1, "Boys 9-10 25m Freestyle", 1, 6), swim("Poe, Sam", 9, 2, "Boys 9-10 25m Backstroke", 1, 6), // two wins isn't three
        swim("Koe, Kim", 12, 1, "Girls 11-12 50m Freestyle", 2, 4), swim("Koe, Kim", 12, 2, "Girls 11-12 50m Backstroke", 1, 6),
        swim("Koe, Kim", 12, 3, "Girls 11-12 50m Butterfly", null, 0, "DQ"),                                               // a DQ in the third
        swim("Loe, Liz", 6, 4, "Girls 6 & Under 25m Freestyle", 1, 6), swim("Loe, Liz", 6, 6, "Girls 6 & Under 25m Backstroke", 2, 4),
        swim("Moe, Mia", 8, 5, "Girls 7-8 25m Freestyle", 2, 4), swim("Moe, Mia", 8, 7, "Girls 7-8 25m Backstroke", 2, 4), swim("Moe, Mia", 8, 8, "Girls 7-8 25m Butterfly", 5, 1)
    ];
    const withTriple = meetSummary([...triple, ...others], []).highlights;
    assert.deepEqual(withTriple.tripleWinners, [{ name: "Doe, Jane", age: 11, events: ["50 Free", "50 Fly", "100 IM"] }]);
    assert.deepEqual(withTriple.topScorers, []);
    // No triple winner: the top 3 by individual points, with everyone tied at the cut-off.
    const without = meetSummary(others, []).highlights;
    assert.deepEqual(without.tripleWinners, []);
    assert.deepEqual(without.topScorers, [{ name: "Poe, Sam", points: 12 }, { name: "Koe, Kim", points: 10 }, { name: "Loe, Liz", points: 10 }]);
    const tied = meetSummary([...others, swim("Hoe, Hal", 10, 9, "Boys 9-10 25m Butterfly", 1, 6), swim("Hoe, Hal", 10, 10, "Boys 9-10 25m Breaststroke", 2, 4)], []).highlights;
    assert.deepEqual(tied.topScorers.map(s => s.name), ["Poe, Sam", "Hoe, Hal", "Koe, Kim", "Loe, Liz"]);
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
    // A personal best beats every earlier swim in the event; a first swim, a
    // slower swim, and a DQ aren't.
    assert.deepEqual(free.swims.map(s => s.personalBest), [false, true, false, false, true]);
    assert.deepEqual(back.swims.map(s => s.personalBest), [false, false]);
    assert.equal(free.seasonBestSeconds, 29);
    assert.equal(back.seasonBestSeconds, 38);
});

test("swimmerEvents: a first swim is never a personal best, and seed times don't count", () => {
    const swim = (meetId, meetDate, seedSeconds, officialSeconds) => ({ meetId, meetDate, eventNumber: 3, eventName: "25m Free", status: "OK", seedSeconds, officialSeconds });
    // Well under its seed, but a first swim. Then faster than that first swim,
    // though not the seed: a personal best all the same.
    const [event] = swimmerEvents([swim("m1", "2026-06-10", 25, 20), swim("m2", "2026-06-17", 18, 19.5)]);
    assert.deepEqual(event.swims.map(s => s.personalBest), [false, true]);
});

test("swimmerSeason: age and season from the latest meet, meets swum, saved badges, and each event's swims", () => {
    const swims = season.map(s => ({ ...s, name: "Doe, Jane", age: s.meetDate < "2026-07-01" ? 11 : 12, officialTime: s.officialSeconds == null ? s.status : String(s.officialSeconds) }));
    const badges = [{ id: "champion", name: "Champion", isNew: true }];
    // The saved totals also count a meet where they only swam a relay.
    const result = swimmerSeason("Doe, Jane", swims, { badges, totals: { relayLegs: 2, meetsSwum: 6 } });
    assert.deepEqual(Object.keys(result).sort(), ["age", "badges", "events", "meetsSwum", "name", "season"]);
    assert.equal(result.name, "Doe, Jane");
    assert.equal(result.age, 12);
    assert.equal(result.season, "2026");
    assert.equal(result.meetsSwum, 6);
    assert.deepEqual(result.badges, badges);
    assert.deepEqual(result.events.map(e => e.eventName), ["50m Free", "50m Back"]);
    assert.deepEqual(Object.keys(result.events[0].swims[0]).sort(), ["change", "meetDate", "meetId", "officialSeconds", "officialTime", "personalBest", "place", "status"]);
    assert.deepEqual(result.events[1].swims.map(s => s.status), ["OK", "NS"]);

    // Before any badges have been worked out. Meets swum leaves out m6, a
    // no-show there; the DQ swim at m4 still got in the water.
    const bare = swimmerSeason("Doe, Jane", swims);
    assert.deepEqual(bare.badges, []);
    assert.equal(bare.meetsSwum, 5);
});
