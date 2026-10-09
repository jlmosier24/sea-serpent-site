// Run from api/: npm test
// Cross-checks the importer against the three real results sheets from the
// design handoff (design/fixtures/). Those sheets hold kids' names, so they
// stay on this computer and are never committed; anywhere they aren't
// present, these tests are skipped.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { extractPdfText } = require("../shared/pdfText");
const { parseMeetResultsText } = require("../shared/meetResultsParser");
const { meetSummary, teamScore } = require("../shared/stats");

const DIR = path.join(__dirname, "..", "..", "design", "fixtures");
const skip = !fs.existsSync(DIR) && "design/fixtures isn't on this computer";

// design/fixtures/EXPECTED.md's numbers, with one known difference: its
// "relay rows" left out the exhibition relays its own definition includes,
// so Jul 1 and Jul 13 have 4 and 8 more here (29 -> 33, 28 -> 36).
const EXPECTED = [
    {
        file: "2026_Spotswood_at_Fawn_Lake_Fliers_07_01_2026___Meet_Maestro_.pdf", date: "2026-07-01",
        swims: 298, relays: 33, swimmers: 117, firstPlaces: 33, relayWins: 7, relayEvents: 16, topThree: 84,
        firstTimeSwims: 34, fasterThanSeed: 110, timedWithSeed: 250, dqs: 12, noShows: 2,
        score: { us: 536, them: 506, source: "points" },
        drop: { eventName: "Boys 9-10 25m Backstroke", seedTime: "35.08", officialTime: "26.76", seconds: 8.32, percent: 23.7 }
    },
    {
        file: "2026_Massad_Marlins_at_Spotswood_07_08_2026___Meet_Maestro_.pdf", date: "2026-07-08",
        swims: 289, relays: 31, swimmers: 113, firstPlaces: 20, relayWins: 9, relayEvents: 16, topThree: 87,
        firstTimeSwims: 39, fasterThanSeed: 95, timedWithSeed: 230, dqs: 13, noShows: 7,
        score: { us: 550, them: 473, source: "points" },
        drop: { eventName: "Girls 8 & Under 25m Breaststroke", seedTime: "52.07", officialTime: "43.83", seconds: 8.24, percent: 15.8 }
    },
    {
        file: "2026_Spotswood_at_CPST_Seahawks_07_13_2026___Meet_Maestro_.pdf", date: "2026-07-13",
        swims: 289, relays: 36, swimmers: 109, firstPlaces: 26, relayWins: 7, relayEvents: 16, topThree: 85,
        firstTimeSwims: 32, fasterThanSeed: 103, timedWithSeed: 240, dqs: 16, noShows: 1,
        // This sheet has a Team Scores page, and it agrees with the points added up.
        score: { us: 525, them: 511, source: "sheet" },
        drop: { eventName: "Boys 11-12 50m Butterfly", seedTime: "1:06.24", officialTime: "53.46", seconds: 12.78, percent: 19.3 }
    }
];

for (const expected of EXPECTED) {
    test(`the ${expected.date} sheet matches the handoff's cross-check numbers`, { skip }, async () => {
        const parsed = parseMeetResultsText(await extractPdfText(fs.readFileSync(path.join(DIR, expected.file))));
        assert.deepEqual(parsed.unparsedLines, [], "every line read");
        assert.equal(parsed.sheetDate, expected.date);

        const summary = meetSummary(parsed.individual, parsed.relays);
        for (const key of ["swims", "relays", "swimmers", "firstPlaces", "relayWins", "relayEvents", "topThree", "firstTimeSwims", "fasterThanSeed", "timedWithSeed", "dqs", "noShows"]) {
            assert.equal(summary[key], expected[key], key);
        }
        assert.deepEqual(teamScore(parsed), expected.score);

        // The handoff's biggest drop is its age group's, among the popup's biggest drops by age group.
        const drop = summary.highlights.biggestDrops.find(d => d.eventName === expected.drop.eventName);
        assert.ok(drop, "the handoff's biggest drop is listed");
        assert.deepEqual([drop.seconds, Math.round(drop.percent * 1000) / 10], [expected.drop.seconds, expected.drop.percent]);

        // The popup's Points by age group: All adds up to the team's final score, and so do Boys and Girls together.
        const total = tab => summary.pointsBy[tab].reduce((n, r) => n + r.points, 0);
        assert.equal(Math.round(total("all") * 100) / 100, expected.score.us, "All");
        assert.equal(Math.round((total("boys") + total("girls")) * 100) / 100, expected.score.us, "Boys and Girls");
    });
}
