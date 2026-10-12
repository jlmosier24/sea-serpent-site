// Run from api/: npm test
// The end-of-season championship: a made-up division-finals sheet (every
// name invented) with flights, read by the parser, placed across flights,
// and imported against in-memory storage.
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeTable, FakeContainer, call } = require("./fakes");

const store = {};
function resetStore() {
    store.meets = new FakeTable();
    store.results = new FakeTable();
    store.relays = new FakeTable();
    store.badges = new FakeTable();
    store.sheets = new FakeContainer();
}
resetStore();
// The Functions destructure these getters when they load, so swap them in first.
Object.assign(require("../shared/meetsTable"), { getMeetsTable: () => store.meets });
Object.assign(require("../shared/resultsTable"), { getResultsTable: () => store.results, getRelayResultsTable: () => store.relays });
Object.assign(require("../shared/resultsPdfContainer"), { getResultsPdfContainer: () => store.sheets });
Object.assign(require("../shared/badgeStore"), { getBadgesTable: () => store.badges });
// The "PDF" here is the sheet's text, so reading it is decoding it.
Object.assign(require("../shared/pdfText"), { extractPdfText: async buffer => buffer.toString("utf8") });

const { parseMeetResultsText } = require("../shared/meetResultsParser");
const { isChampionshipSheet, withOverallPlaces, standings } = require("../shared/championship");
const { teamScore, meetSummary } = require("../shared/stats");
const saveMeet = require("../manageMeetsSave/index.js");
const previewResults = require("../importMeetResultsPreview/index.js");
const commitResults = require("../importMeetResultsCommit/index.js");
const publicMeets = require("../meets/index.js");
const { SHEET } = require("./sampleSheet");

const scoreTable = (group, rows) => [`${group} Team Scores -- Through Event 2`, `Rank Team ${group}`, ...rows];
const SHEET_TEXT = [
    "Results 2026 Test Division Finals — Jul 26, 2026 Page 1 of 2",
    "#1 Girls 8 & Under 25yd Freestyle Girls 8 & Under",
    "Pl Name Age Team Seed Official Pts",
    "A    A",
    "1 Doe, Jane 8 Sample Sharks 20.00 19.50 7",
    "2 Poe, Pat 8 Spotswood 21.00 20.10 5",
    "3 Roe, Rae 8 Test Seahawks 21.50 21.00 4",
    "-- Moe, Mia 8 Spotswood 22.00 DQ",
    "DQ: 3J Touch: One hand",
    "B    B",
    // Wins the B flight with the third-best time of all.
    "1 Loe, Lu 8 Spotswood 23.00 20.80 7",
    // Ties the A flight's third.
    "2 Koe, Kay 8 Test Seahawks 24.00 21.00 5",
    "X Zoe, Zed EXH 8 Spotswood NT 25.00",
    "SwimTopia Meet Maestro™ Download the SwimTopia Mobile App for Live Results & More Printed 07/26/26 07:17 PM",
    "Results 2026 Test Division Finals — Jul 26, 2026 Page 2 of 2",
    "#2 Girls 8 & Under 100yd Freestyle Relay Girls 8 & Under",
    "Pl Team Relay Seed Official Pts",
    "R    Relays",
    "1 Spotswood A S 1:20.00 1:18.00 14",
    "1) Poe, Pat (8) 2) Loe, Lu (8) 3) Moe, Mia (8) 4) Zoe, Zed (8)",
    "2 Sample Sharks A SS 1:21.00 1:19.00 10",
    "1) Doe, Jane (8) 2) Aye, Al (8) 3) Bee, Bo (8) 4) Cee, Cy (8)",
    "Team Scores (for scored and filtered events)",
    "A",
    ...scoreTable("Combined", ["1 Sample Sharks SS 7", "2 Spotswood S 5", "3 Test Seahawks TS 4", "Total 16"]),
    "B",
    ...scoreTable("Combined", ["1 Spotswood S 7", "2 Test Seahawks TS 5", "Total 12"]),
    "Relays",
    ...scoreTable("Combined", ["1 Spotswood S 14", "2 Sample Sharks SS 10", "Total 24"]),
    "Overall",
    ...scoreTable("Women", ["1 Spotswood S 26", "2 Sample Sharks SS 17", "3 Test Seahawks TS 9", "Total 52"]),
    ...scoreTable("Combined", ["1 Spotswood S 26", "2 Sample Sharks SS 17", "3 Test Seahawks TS 9", "Total 52"])
].join("\n");

const byName = rows => Object.fromEntries(rows.map(r => [r.name, r]));

test("the parser keeps each row's flight and reads each Team Scores section on its own", () => {
    const parsed = parseMeetResultsText(SHEET_TEXT);
    assert.deepEqual(parsed.unparsedLines, []);
    const rows = byName(parsed.individual);
    assert.deepEqual([rows["Doe, Jane"].flight, rows["Loe, Lu"].flight, rows["Loe, Lu"].place], ["A", "B", 1]);
    assert.equal(parsed.relays[0].flight, null);
    assert.deepEqual(parsed.teamScoreTables.map(t => `${t.section} ${t.group}`), ["A combined", "B combined", "Relays combined", "Overall women", "Overall combined"]);
    // The team totals are the Overall Combined ones, not the last table read.
    assert.deepEqual(parsed.sheetTeamScores, { Spotswood: 26, "Sample Sharks": 17, "Test Seahawks": 9 });
    assert.equal(isChampionshipSheet(parsed), true);
});

test("a regular meet's sheet is unchanged: no flights, and not a championship", () => {
    const parsed = parseMeetResultsText(SHEET);
    assert.equal(parsed.individual.every(r => r.flight === null), true);
    assert.equal(isChampionshipSheet(parsed), false);
    assert.equal(teamScore(parsed).them, 511);
});

test("swimmers are placed by time across every flight; ties share a place, and DQs and exhibition swims get none", () => {
    const rows = byName(withOverallPlaces(parseMeetResultsText(SHEET_TEXT).individual));
    const places = name => [rows[name].place, rows[name].flightPlace];
    assert.deepEqual(places("Doe, Jane"), [1, 1]);
    assert.deepEqual(places("Poe, Pat"), [2, 2]);
    assert.deepEqual(places("Loe, Lu"), [3, 1]);
    assert.deepEqual(places("Roe, Rae"), [4, 3]);
    assert.deepEqual(places("Koe, Kay"), [4, 2]);
    assert.deepEqual(places("Moe, Mia"), [null, null]);
    assert.deepEqual(places("Zoe, Zed"), [null, null]);
});

test("the standings list every team best first, with Spotswood's place for the team score", () => {
    const parsed = parseMeetResultsText(SHEET_TEXT);
    assert.deepEqual(standings(parsed), [
        { team: "Spotswood", score: 26, place: 1 },
        { team: "Sample Sharks", score: 17, place: 2 },
        { team: "Test Seahawks", score: 9, place: 3 }
    ]);
    assert.deepEqual(teamScore(parsed), { us: 26, them: null, place: 1, of: 3, source: "sheet" });
    // Without a Team Scores page, the points are added up instead.
    const noScores = parseMeetResultsText(SHEET_TEXT.split("\nTeam Scores")[0]);
    assert.deepEqual(standings(noScores).map(r => [r.team, r.score, r.place]), [["Spotswood", 26, 1], ["Sample Sharks", 17, 2], ["Test Seahawks", 9, 3]]);
});

test("a flight win that isn't the best time isn't a first place in the meet's numbers", () => {
    const parsed = parseMeetResultsText(SHEET_TEXT);
    const summary = meetSummary(withOverallPlaces(parsed.individual), parsed.relays);
    assert.equal(summary.firstPlaces, 0);
    assert.equal(summary.topThree, 2);
    assert.equal(summary.relayWins, 1);
});

test("importing a championship saves overall places, flights, and the standings, with no opponent score", async () => {
    resetStore();
    await call(saveMeet, { body: { opponent: "Division Finals", shortName: "Division Finals", homeAway: "away", date: "2026-07-26", time: "08:00" } });
    const [meet] = store.meets.all();
    const upload = Buffer.from(SHEET_TEXT, "utf8").toString("base64");

    const preview = await call(previewResults, { body: { dataBase64: upload } });
    assert.equal(preview.body.championship, true);
    assert.deepEqual(preview.body.teamScore, { us: 26, them: null, place: 1, of: 3, source: "sheet" });

    const res = await call(commitResults, { body: { meetId: meet.rowKey, fileName: "finals.pdf", dataBase64: upload } });
    assert.equal(res.status, 200);
    const loe = store.results.all().find(r => r.partitionKey === "Loe, Lu");
    assert.deepEqual([loe.place, loe.flight, loe.flightPlace], [3, "B", 1]);

    const [listed] = (await call(publicMeets, {})).body;
    assert.equal(listed.meetType, "championship");
    assert.equal(listed.teamScore, 26);
    assert.equal(listed.opponentScore, null);
    assert.deepEqual(listed.standings.map(r => r.team), ["Spotswood", "Sample Sharks", "Test Seahawks"]);

    // Editing the meet keeps it a championship with its standings.
    await call(saveMeet, { body: { id: meet.rowKey, opponent: "Division Finals", shortName: "Division Finals", homeAway: "away", date: "2026-07-26", time: "08:30" } });
    const [edited] = (await call(publicMeets, {})).body;
    assert.equal(edited.meetType, "championship");
    assert.equal(edited.standings.length, 3);
});
