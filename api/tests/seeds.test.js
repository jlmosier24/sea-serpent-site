// Run from api/: npm test
// Seeds converted between yards and meters (design/update-4/UPDATE.md,
// rule A), with made-up swimmers.
const test = require("node:test");
const assert = require("node:assert/strict");
const { markConvertedSeeds, hasRealSeed, course } = require("../shared/seeds");

const swim = (name, eventName, extra) => ({ name, team: "Spotswood", eventName, ...extra });

test("course: yards or meters, and the race without the age group", () => {
    assert.deepEqual(course("Girls 7-8 25yd Backstroke"), { yards: true, race: "25 Backstroke" });
    assert.deepEqual(course("Boys 13-14 100m IM"), { yards: false, race: "100 IM" });
    assert.equal(course("Mystery event"), null);
});

test("a seed equal to the swimmer's own earlier time in the other course, converted, is flagged", () => {
    const earlier = [
        swim("Doe, Jane", "Girls 7-8 25yd Backstroke", { officialSeconds: 30.77 }),
        swim("Doe, Jane", "Girls 7-8 25yd Freestyle", { officialSeconds: 22.69 }),
        swim("Doe, Jane", "Girls 7-8 25m Butterfly", { officialSeconds: 33.30 }),
        swim("Doe, Jane", "Girls 7-8 25yd Breaststroke", { officialSeconds: null }) // a DQ has no time
    ];
    const rows = [
        swim("Doe, Jane", "Girls 7-8 25m Backstroke", { seedSeconds: 34.15 }), // 30.77 x 1.11 = 34.1547
        swim("Doe, Jane", "Girls 7-8 25m Freestyle", { seedSeconds: 25.19 }),  // 22.69 x 1.11 = 25.1859, rounded
        swim("Doe, Jane", "Girls 7-8 25m Freestyle", { seedSeconds: 25.18 }),  // ...or cut off
        swim("Poe, Sam", "Boys 7-8 25m Freestyle", { seedSeconds: 25.19 }),    // the same number, but not his own time
        swim("Doe, Jane", "Girls 7-8 25m Backstroke", { seedSeconds: 29.39 }), // a real meters time
        swim("Doe, Jane", "Girls 7-8 25yd Butterfly", { seedSeconds: 30.00 }), // 33.30 / 1.11: meters to yards
        swim("Doe, Jane", "Girls 7-8 25m Breaststroke", { seedSeconds: 40.00 }),
        swim("Doe, Jane", "Girls 7-8 25m Butterfly", { seedSeconds: null })    // NT: no seed at all
    ];
    assert.deepEqual(markConvertedSeeds(rows, earlier).map(r => r.seedConverted), [true, true, true, false, false, true, false, false]);
});

test("hasRealSeed: a seed that wasn't converted", () => {
    assert.equal(hasRealSeed({ seedSeconds: 30 }), true);
    assert.equal(hasRealSeed({ seedSeconds: 30, seedConverted: true }), false);
    assert.equal(hasRealSeed({ seedSeconds: null }), false);
});
