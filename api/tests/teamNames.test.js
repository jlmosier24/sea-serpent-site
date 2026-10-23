// Run from api/: npm test
// Short team names for the full results list.
const test = require("node:test");
const assert = require("node:assert/strict");
const { teamShortNames } = require("../shared/teamNames");

const meets = [
    { meetType: "dual", opponent: "Woodland Wahoos", shortName: "Woodland" },
    { meetType: "dual", opponent: "Curtis Park Seahawks", shortName: "Curtis" },
    { meetType: "dual", opponent: "Chancellor Blue Dolphins", shortName: "Chancellor" },
    { meetType: "championship", opponent: "Division Finals", shortName: "Division Finals" }
];

test("teams take their short names from the meet records, Spotswood its own", () => {
    const short = teamShortNames(meets);
    assert.equal(short("Spotswood"), "Spotswood");
    assert.equal(short("Spotswood Sea Serpents"), "Spotswood");
    assert.equal(short("Woodland Wahoos"), "Woodland");
    assert.equal(short("woodland  wahoos"), "Woodland", "spacing and case don't matter");
    assert.equal(short("Chancellor Blue Dolphins"), "Chancellor", "a two-word mascot, from the record");
});

test("a sheet's other spelling matches by mascot; a team with no record loses only a plural mascot", () => {
    const short = teamShortNames(meets);
    assert.equal(short("CPST Seahawks"), "Curtis");
    assert.equal(short("Fawn Lake Fliers"), "Fawn Lake");
    assert.equal(short("Massad Marlins"), "Massad");
    assert.equal(short("Fox Point"), "Fox Point");
    assert.equal(short(""), "");
});

test("a mascot two teams share can't pick between them", () => {
    const short = teamShortNames([...meets, { meetType: "dual", opponent: "Lake Seahawks", shortName: "Lake" }]);
    assert.equal(short("CPST Seahawks"), "CPST");
    assert.equal(short("Lake Seahawks"), "Lake");
});
