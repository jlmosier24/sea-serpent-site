// Run from api/: npm test
// Cross-checks badges against update 2's two example swimmers (the stat strip
// it also describes was later dropped at the user's choice): the three
// real results sheets (design/fixtures) are stored the way an import stores
// them, everyone's badges are worked out, and /api/swimmerStats is asked for
// each swimmer, as the Stats page would. The sheets and the expected values
// (design/update-2/expected-badges.json) hold kids' names, so they stay on
// this computer and are never committed; anywhere they aren't present, this
// test is skipped.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { FakeTable, call } = require("./fakes");

const meets = new FakeTable();
const results = new FakeTable();
const relays = new FakeTable();
const badges = new FakeTable();
// The Function destructures these getters when it loads, so swap them in first.
Object.assign(require("../shared/meetsTable"), { getMeetsTable: () => meets });
Object.assign(require("../shared/resultsTable"), { getResultsTable: () => results });
Object.assign(require("../shared/badgeStore"), { getBadgesTable: () => badges });
const swimmerStats = require("../swimmerStats/index.js");

const { extractPdfText } = require("../shared/pdfText");
const { parseMeetResultsText } = require("../shared/meetResultsParser");
const { toResultEntity, toRelayResultEntity } = require("../shared/resultsTable");
const { PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");
const { recomputeBadges, PARTITION_KEY: BADGE_PARTITION_KEY } = require("../shared/badgeStore");

const DESIGN = path.join(__dirname, "..", "..", "design");
const EXPECTED = path.join(DESIGN, "update-2", "expected-badges.json");
const skip = !(fs.existsSync(EXPECTED) && fs.existsSync(path.join(DESIGN, "fixtures"))) && "the design handoff's fixtures aren't on this computer";

test("update 2's example swimmers get the badges, pills, New tags and totals it expects", { skip }, async () => {
    const expected = JSON.parse(fs.readFileSync(EXPECTED, "utf8"));
    for (const { meetId, file } of expected.sheets) {
        const parsed = parseMeetResultsText(await extractPdfText(fs.readFileSync(path.join(DESIGN, "fixtures", file))));
        await meets.upsertEntity({ partitionKey: MEET_PARTITION_KEY, rowKey: meetId, opponent: "Test Seahawks", date: parsed.sheetDate });
        for (const row of parsed.individual) await results.upsertEntity(toResultEntity(row, meetId));
        for (const row of parsed.relays) await relays.upsertEntity(toRelayResultEntity(row, meetId));
    }
    await recomputeBadges({ resultsTable: results, relayTable: relays, meetsTable: meets, badgesTable: badges });

    for (const [i, swimmer] of expected.swimmers.entries()) {
        const label = `example swimmer ${i + 1}`;
        const res = await call(swimmerStats, { query: { name: swimmer.name } });
        assert.equal(res.status, 200, label);
        const season = res.body;

        assert.deepEqual(season.badges.map(b => b.id).sort(), Object.keys(swimmer.badges).sort(), label);
        for (const [id, want] of Object.entries(swimmer.badges)) {
            const got = season.badges.find(b => b.id === id);
            for (const [key, value] of Object.entries(want)) assert.deepEqual(got[key], value, `${label}: ${id} ${key}`);
        }
        // New ones first, and First Splash last.
        const firstOld = season.badges.findIndex(b => !b.isNew);
        assert.equal(season.badges.slice(firstOld).some(b => b.isNew), false, label);
        assert.equal(season.badges.at(-1).id, "splash", label);

        const saved = JSON.parse((await badges.getEntity(BADGE_PARTITION_KEY, encodeURIComponent(swimmer.name))).totalsJson);
        for (const [key, value] of Object.entries(swimmer.totals)) assert.equal(saved[key], value, `${label}: ${key}`);
    }
});
