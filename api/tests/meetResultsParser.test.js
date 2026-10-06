// Run from api/: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMeetResultsText, normalizeName, timeToSeconds } = require("../shared/meetResultsParser");
const { SHEET } = require("./sampleSheet");

const parsed = parseMeetResultsText(SHEET);
const swim = name => parsed.individual.find(r => r.name === name);

test("reads the sheet's date from its page header", () => {
    assert.equal(parsed.sheetDate, "2026-07-13");
    assert.equal(parseMeetResultsText("Results Some Meet — July 4, 2026 Page 1 of 1").sheetDate, "2026-07-04");
    assert.equal(parseMeetResultsText("#1 Girls 25m Freestyle").sheetDate, null);
});

test("every line is accounted for", () => {
    assert.deepEqual(parsed.unparsedLines, []);
    assert.equal(parsed.individual.length, 8);
    assert.equal(parsed.relays.length, 3);
});

test("individual rows: places, ties, times, and points", () => {
    assert.deepEqual(
        [swim("Doe, Jane").place, swim("Doe, Jane").status, swim("Doe, Jane").officialSeconds, swim("Doe, Jane").points, swim("Doe, Jane").age],
        [1, "OK", 24.5, 6, 8]
    );
    // "2*" is a tie for second; the tied swimmers split the points.
    assert.deepEqual([swim("Roe, Rachel").place, swim("Roe, Rachel").points], [2, 3.5]);
    assert.deepEqual([swim("Poe, Sam").seedTime, swim("Poe, Sam").seedSeconds, swim("Poe, Sam").place], ["NT", null, 2]);
    assert.equal(swim("Doe, Jane").eventName, "Girls 8 & Under 25m Freestyle");
});

test("DQs, no-shows, did-not-finish, and exhibition swims", () => {
    assert.deepEqual([swim("Moe, Max").status, swim("Moe, Max").place, swim("Moe, Max").officialSeconds], ["DQ", null, null]);
    // A second infraction continues on its own line.
    assert.equal(swim("Moe, Max").dqReason, "3J Touch: One hand; 7T Other - Misc");
    assert.equal(swim("Loe, Liz").status, "NS");
    assert.equal(swim("Joe, Jo").status, "DNF");
    // Rows after a page break still belong to the event they're under.
    assert.equal(swim("Joe, Jo").eventNumber, 1);
    assert.deepEqual([swim("Koe, Kim").status, swim("Koe, Kim").place, swim("Koe, Kim").officialSeconds], ["EXH", null, 30.1]);
});

test("a stray period in a name is tidied so one swimmer can't split in two", () => {
    assert.ok(swim("Voe, Val"));
    assert.equal(normalizeName("Voe., Val"), "Voe, Val");
    assert.equal(normalizeName("  Doe   Jr, John "), "Doe Jr, John");
});

test("relays: legs, DQ reasons after the legs, and a disqualified exhibition relay", () => {
    const [winner, dq, exhibition] = parsed.relays;
    assert.deepEqual([winner.team, winner.relayLetter, winner.teamAbbrev, winner.place, winner.officialSeconds, winner.points], ["Spotswood", "A", "S", 1, 105.88, 8]);
    assert.deepEqual(winner.swimmers, [{ name: "Doe, Jane", age: 8 }, { name: "Poe, Sam", age: 7 }, { name: "Koe, Kim", age: 8 }, { name: "Loe, Liz", age: 8 }]);
    assert.deepEqual([dq.status, dq.dqReason], ["DQ", "6H Early take-off swimmer #4"]);
    // "X ... DQ": the DQ outranks the exhibition mark, so its reason attaches.
    assert.deepEqual([exhibition.status, exhibition.place, exhibition.relayLetter, exhibition.dqReason], ["DQ", null, "C", "6F Early take-off swimmer #2"]);
});

test("the Team Scores page and the points behind a computed score", () => {
    assert.deepEqual(parsed.sheetTeamScores, { Spotswood: 525, "Test Seahawks": 511 });
    assert.deepEqual(parsed.teamPoints, { Spotswood: 17.5, "Test Seahawks": 4.5 });
    assert.equal(parseMeetResultsText("#1 Girls 25m Freestyle").sheetTeamScores, null);
});

test("timeToSeconds", () => {
    assert.equal(timeToSeconds("1:16.09"), 76.09);
    assert.equal(timeToSeconds("45.09"), 45.09);
    for (const none of ["NT", "DQ", "NS", "DNF", "", undefined]) assert.equal(timeToSeconds(none), null);
});

test("lines it can't place are kept for the admin to see, not guessed at", () => {
    const odd = parseMeetResultsText(["#1 Girls 25m Freestyle", "Pl Name Age Team Seed Official Pts", "something unexpected"].join("\n"));
    assert.deepEqual(odd.unparsedLines, ["something unexpected"]);
});
