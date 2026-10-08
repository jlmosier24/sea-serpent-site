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

test("a seed converted from the other course is left out of the seed comparisons", () => {
    const rows = [
        // Ten seconds under a converted seed: not a real drop, so it counts nowhere.
        { name: "A", team: "Spotswood", age: 9, status: "OK", place: 1, seedSeconds: 40, seedConverted: true, officialSeconds: 30, eventName: "e" },
        { name: "B", team: "Spotswood", age: 9, status: "OK", place: 2, seedSeconds: 40, officialSeconds: 38, eventName: "e" }
    ];
    const s = meetSummary(rows, []);
    assert.deepEqual([s.fasterThanSeed, s.timedWithSeed], [1, 1]);
    assert.equal(s.biggestDrop.name, "B");
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

test("pointsBy: every tab adds up to the team's points, split by age group, stroke and place", () => {
    const swim = (age, eventNumber, eventName, place, points, team = "Spotswood") => ({ name: `S${eventNumber}`, team, age, eventNumber, eventName, status: "OK", place, points });
    const individual = [
        swim(6, 1, "Girls 8 & Under 25m Freestyle", 1, 6),
        swim(10, 2, "Boys 9-10 50m Backstroke", 2, 4),
        swim(13, 3, "Girls 13-14 100m IM", 2, 3.5), // tied for 2nd
        swim(17, 4, "Boys 15-18 50m Butterfly", 5, 1),
        swim(12, 5, "Girls 11-12 50m Breaststroke", 6, 0),
        swim(12, 5, "Girls 11-12 50m Breaststroke", 1, 6, "Test Seahawks") // the other team's points aren't ours
    ];
    const relay = (eventNumber, eventName, place, points) => ({ team: "Spotswood", relayLetter: "A", status: "OK", eventNumber, eventName, place, points });
    const relays = [
        relay(10, "Girls 8 & Under 100m Freestyle Relay", 1, 8),
        relay(11, "Boys 12 & Under 100m Medley Relay", 2, 4),    // spans age groups: Mixed relays
        relay(12, "Men 15-18 100m Freestyle Relay", 3, 2),
        relay(13, "Girls 18 & Under 125m Freestyle Relay", 1, 8) // Mixed relays too
    ];
    const { pointsBy } = meetSummary(individual, relays);
    const total = rows => rows.reduce((n, r) => n + r.individual + r.relay, 0);
    // 14.5 individual and 22 relay points, whichever way they're split.
    for (const tab of ["ageGroup", "stroke", "place"]) assert.equal(total(pointsBy[tab]), 36.5, tab);
    assert.deepEqual(pointsBy.ageGroup, [
        { label: "8 & under", individual: 6, relay: 8 },
        { label: "9-10", individual: 4, relay: 0 },
        { label: "11-12", individual: 0, relay: 0 },
        { label: "13-14", individual: 3.5, relay: 0 },
        { label: "15-18", individual: 1, relay: 2 },
        { label: "Mixed relays", individual: 0, relay: 12 }
    ]);
    const points = rows => rows.map(r => [r.label, r.individual + r.relay]);
    assert.deepEqual(points(pointsBy.stroke), [["Freestyle", 6], ["Backstroke", 4], ["Breaststroke", 0], ["Butterfly", 1], ["IM", 3.5], ["Relays", 22]]);
    assert.deepEqual(points(pointsBy.place), [["1st", 22], ["2nd", 11.5], ["3rd", 2], ["4th", 0], ["5th", 1]]);
});

test("meet highlights: triple winners and youngest scorers", () => {
    const swim = (name, age, eventNumber, place, points, status = "OK") =>
        ({ name, team: "Spotswood", age, eventNumber, eventName: "Girls 11-12 50m Freestyle", status, place, points, officialSeconds: 30 });
    const individual = [
        swim("Doe, Jane", 11, 1, 1, 6), swim("Doe, Jane", 11, 2, 1, 6), swim("Doe, Jane", 11, 3, 1, 6),
        swim("Poe, Sam", 9, 1, 1, 6), swim("Poe, Sam", 9, 2, 1, 6),                                         // two wins isn't three
        swim("Koe, Kim", 12, 1, 1, 6), swim("Koe, Kim", 12, 2, 1, 6), swim("Koe, Kim", 12, 3, null, 0, "DQ"), // a DQ in the third
        swim("Loe, Liz", 6, 4, 3, 3), swim("Moe, Mia", 6, 5, 2, 4),
        swim("Zoe, Zed", 5, 6, 7, 0) // younger, but didn't score
    ];
    const { highlights } = meetSummary(individual, []);
    assert.deepEqual(highlights.tripleWinners, [{ name: "Doe, Jane", age: 11, points: 18 }]);
    assert.deepEqual(highlights.youngestScorers, [{ name: "Moe, Mia", age: 6, points: 4 }, { name: "Loe, Liz", age: 6, points: 3 }]);
});

test("meet highlights: biggest climb from the seed order, with NT and converted seeds left out and ties shown", () => {
    const swim = (name, team, eventNumber, place, seedSeconds, extra = {}) =>
        ({ name, team, age: 9, eventNumber, eventName: "Boys 9-10 25m Freestyle", status: "OK", place, officialSeconds: 20 + place, seedSeconds, points: 0, ...extra });
    const individual = [
        // Event 1's real seeds rank 20, 21, 22, 23; an NT and a converted seed aren't in the order.
        swim("Fast, Al", "Test Seahawks", 1, 1, 20),
        swim("Doe, Jim", "Spotswood", 1, 2, 23), // seeded 4th, finished 2nd: up 2
        swim("Roe, Ray", "Test Seahawks", 1, 3, 21),
        swim("Poe, Pat", "Spotswood", 1, 4, null),
        swim("Koe, Ken", "Spotswood", 1, 5, 19, { seedConverted: true }),
        swim("Moe, Mo", "Test Seahawks", 1, 6, 22),
        // Event 2: seeded 3rd, won it, also up 2.
        swim("Loe, Lou", "Spotswood", 2, 1, 32),
        swim("Them, Tom", "Test Seahawks", 2, 2, 30),
        swim("Them, Tim", "Test Seahawks", 2, 3, 31)
    ];
    assert.deepEqual(meetSummary(individual, []).highlights.biggestClimb.map(c => [c.name, c.seedRank, c.place]), [["Doe, Jim", 4, 2], ["Loe, Lou", 3, 1]]);
});

test("meet highlights: photo finishes are Spotswood wins over the other team's swimmer in 2nd", () => {
    const swim = (name, team, eventNumber, place, officialSeconds) =>
        ({ name, team, age: 12, eventNumber, eventName: "Girls 11-12 50m Freestyle", status: "OK", place, officialSeconds, points: 0, seedSeconds: null });
    const individual = [
        swim("Doe, Jane", "Spotswood", 1, 1, 30.00), swim("Roe, Rita", "Test Seahawks", 1, 2, 30.07), // won by 0.07
        swim("Poe, Pam", "Spotswood", 2, 1, 31.00), swim("Koe, Kay", "Spotswood", 2, 2, 31.01),       // a Spotswood 1-2
        swim("Moe, Meg", "Spotswood", 3, 1, 29.00), swim("Toe, Tia", "Test Seahawks", 3, 2, 29.07),   // also 0.07: both shown
        swim("Loe, Lia", "Spotswood", 4, 1, 28.00), swim("Fay, Fi", "Test Seahawks", 4, 1, 28.00),    // a tie for first wasn't won
        swim("Hoe, Hal", "Test Seahawks", 5, 1, 27.00), swim("Yoe, Yan", "Spotswood", 5, 2, 27.01)    // their win
    ];
    assert.deepEqual(meetSummary(individual, []).highlights.photoFinishes.map(p => [p.name, p.margin]), [["Doe, Jane", 0.07], ["Moe, Meg", 0.07]]);
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
