// Run from api/: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { autoShortName, meetTitle, toMeetDto, buildMeetEntity, homePoolFill } = require("../shared/meetsTable");
const { isSheetForMeet, sheetBlobName } = require("../shared/resultsPdfContainer");

test("autoShortName drops the last word, keeping one-word names whole", () => {
    assert.equal(autoShortName("Massad Marlins"), "Massad");
    assert.equal(autoShortName("Curtis Park Seahawks"), "Curtis Park");
    assert.equal(autoShortName("  Fawn   Lake  Fliers "), "Fawn Lake");
    assert.equal(autoShortName("ChanBlueDolphins"), "ChanBlueDolphins");
    assert.equal(autoShortName(""), "");
    assert.equal(autoShortName(undefined), "");
});

test("meetTitle: vs. for home, at for away", () => {
    assert.equal(meetTitle("home", "Massad"), "vs. Massad");
    assert.equal(meetTitle("away", "Curtis Park"), "at Curtis Park");
});

test("toMeetDto reads home or away from an older meet's title and keeps that title", () => {
    const away = toMeetDto({ rowKey: "a", title: "at Fawn Lake Fliers", opponent: "Fawn Lake Fliers", date: "2026-07-01", teamScore: 536, opponentScore: 506 });
    assert.equal(away.homeAway, "away");
    assert.equal(away.title, "at Fawn Lake Fliers");
    assert.equal(away.shortName, "Fawn Lake");
    assert.equal(away.scoreSource, "import");
    assert.equal(away.resultsImported, true);

    const home = toMeetDto({ rowKey: "h", title: "vs. Woodland Wahoos", opponent: "Woodland Wahoos", date: "2026-06-17" });
    assert.equal(home.homeAway, "home");
    assert.equal(home.teamScore, null);
    assert.equal(home.scoreSource, null);
    assert.equal(home.resultsImported, false);
});

test("toMeetDto builds the title from the short name once a meet has one", () => {
    const meet = toMeetDto({ rowKey: "m", title: "old title", opponent: "Massad Marlins", shortName: "Massad", homeAway: "home", date: "2026-07-08" });
    assert.equal(meet.title, "vs. Massad");
});

const valid = { opponent: "Massad Marlins", date: "2026-07-08", time: "18:00", homeAway: "home" };

test("buildMeetEntity rejects what the form shouldn't allow", () => {
    assert.match(buildMeetEntity({ ...valid, opponent: " " }, "k").error, /opponent/);
    assert.match(buildMeetEntity({ ...valid, date: "July 8" }, "k").error, /date/);
    assert.match(buildMeetEntity({ ...valid, time: "6pm" }, "k").error, /times/);
    assert.match(buildMeetEntity({ ...valid, warmUp: "25:00" }, "k").error, /times/);
    assert.match(buildMeetEntity({ ...valid, note: "x".repeat(121) }, "k").error, /120/);
    assert.equal(buildMeetEntity({ ...valid, note: "x".repeat(120) }, "k").error, undefined);
    assert.match(buildMeetEntity({ ...valid, teamScore: 550 }, "k").error, /both scores/);
    assert.match(buildMeetEntity({ ...valid, teamScore: 550.5, opponentScore: 473 }, "k").error, /whole numbers/);
    assert.match(buildMeetEntity({ ...valid, teamScore: -1, opponentScore: 473 }, "k").error, /whole numbers/);
});

test("buildMeetEntity derives the title and fills a blank short name", () => {
    const { entity } = buildMeetEntity({ ...valid, shortName: "" }, "k");
    assert.equal(entity.shortName, "Massad");
    assert.equal(entity.title, "vs. Massad");
    const away = buildMeetEntity({ ...valid, homeAway: "away", shortName: "Curtis Park", opponent: "Curtis Park Seahawks" }, "k").entity;
    assert.equal(away.title, "at Curtis Park");
    // Anything but "away" is home.
    assert.equal(buildMeetEntity({ ...valid, homeAway: "bogus" }, "k").entity.homeAway, "home");
});

test("buildMeetEntity keeps coordinates only when an address suggestion supplied both", () => {
    assert.deepEqual(
        [buildMeetEntity({ ...valid, lat: 38.3, lon: -77.5 }, "k").entity.lat, buildMeetEntity({ ...valid, lat: 38.3, lon: -77.5 }, "k").entity.lon],
        [38.3, -77.5]
    );
    assert.equal("lat" in buildMeetEntity({ ...valid, lat: 38.3 }, "k").entity, false);
    assert.equal("lat" in buildMeetEntity({ ...valid, lat: "", lon: "" }, "k").entity, false);
});

test("buildMeetEntity: a typed or edited score is manual, an unchanged one keeps its source", () => {
    const imported = { rowKey: "k", opponent: "Massad Marlins", title: "vs. Massad Marlins", date: "2026-07-08", teamScore: 550, opponentScore: 473 };
    assert.equal(buildMeetEntity({ ...valid, id: "k", teamScore: 550, opponentScore: 473 }, "k", imported).entity.scoreSource, "import");
    assert.equal(buildMeetEntity({ ...valid, id: "k", teamScore: "550", opponentScore: "473" }, "k", imported).entity.scoreSource, "import");
    assert.equal(buildMeetEntity({ ...valid, id: "k", teamScore: 551, opponentScore: 473 }, "k", imported).entity.scoreSource, "manual");
    assert.equal(buildMeetEntity({ ...valid, teamScore: 10, opponentScore: 5 }, "k").entity.scoreSource, "manual");
    const cleared = buildMeetEntity({ ...valid, id: "k", teamScore: "", opponentScore: "" }, "k", imported).entity;
    assert.equal("teamScore" in cleared, false);
    assert.equal("scoreSource" in cleared, false);
});

test("buildMeetEntity carries over the import's own fields, including for older meets", () => {
    const withImport = { rowKey: "k", opponent: "Massad Marlins", shortName: "Massad", homeAway: "home", date: "2026-07-08", resultsImported: true, lastImportFile: "sheet.pdf", lastImportAt: "2026-10-04T23:00:00Z" };
    const carried = buildMeetEntity({ ...valid, id: "k" }, "k", withImport).entity;
    assert.equal(carried.resultsImported, true);
    assert.equal(carried.lastImportFile, "sheet.pdf");
    assert.equal(carried.lastImportAt, "2026-10-04T23:00:00Z");
    // An older meet has no resultsImported flag, but its imported score says it was imported --
    // clearing that score mustn't make the meet look un-imported.
    const older = { rowKey: "k", opponent: "Massad Marlins", title: "vs. Massad Marlins", date: "2026-07-08", teamScore: 550, opponentScore: 473 };
    assert.equal(buildMeetEntity({ ...valid, id: "k", teamScore: "", opponentScore: "" }, "k", older).entity.resultsImported, true);
    assert.equal("resultsImported" in buildMeetEntity(valid, "k").entity, false);
});

test("homePoolFill fills only a home meet's blanks", () => {
    const pool = { name: "Home Pool", address: "1 Main St", lat: 38, lon: -77 };
    assert.equal(homePoolFill({ homeAway: "away", placeName: "", address: "" }, pool), null);
    assert.equal(homePoolFill({ homeAway: "home", placeName: "Elsewhere", address: "2 Side St" }, pool), null);
    assert.deepEqual(homePoolFill({ homeAway: "home", placeName: "", address: "2 Side St" }, pool), { placeName: "Home Pool" });
    assert.deepEqual(homePoolFill({ homeAway: "home", placeName: "Elsewhere", address: "" }, pool), { address: "1 Main St", lat: 38, lon: -77 });
    assert.deepEqual(homePoolFill({ homeAway: "home", placeName: "", address: "" }, { name: "Home Pool", address: "", lat: null, lon: null }), { placeName: "Home Pool" });
    assert.equal(homePoolFill({ homeAway: "home", placeName: "", address: "" }, null), null);
});

test("isSheetForMeet matches a meet's archived sheets and no other meet's", () => {
    assert.equal(sheetBlobName("2026-07-08-massad-marlins", 1791164034802), "2026-07-08-massad-marlins-1791164034802.pdf");
    assert.equal(isSheetForMeet("a-1791164034802.pdf", "a"), true);
    assert.equal(isSheetForMeet("a-2-1791164034802.pdf", "a"), false);
    assert.equal(isSheetForMeet("a-2-1791164034802.pdf", "a-2"), true);
    assert.equal(isSheetForMeet("ab-1.pdf", "a"), false);
    assert.equal(isSheetForMeet("a-1.txt", "a"), false);
});
