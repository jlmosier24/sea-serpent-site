// Run from api/: npm test
// Cross-checks badges against update 2's two example swimmers, under update
// 4's rules (its badge mockup lists the same two swimmers' rows): the three
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

test("update 2's example swimmers get the badges, pills, lists, New tags and totals expected", { skip }, async () => {
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
        // New ones first, then the fixed ranking, as the mockup sorts them.
        assert.deepEqual(season.badges.map(b => b.id), swimmer.order, label);

        const saved = JSON.parse((await badges.getEntity(BADGE_PARTITION_KEY, encodeURIComponent(swimmer.name))).totalsJson);
        for (const [key, value] of Object.entries(swimmer.totals)) assert.equal(saved[key], value, `${label}: ${key}`);
    }

    // Everyone's pills match their lists: a count is the number of rows, and
    // a total is the rows added up.
    const number = text => Number(String(text).replace(/[^\d.]/g, ""));
    for await (const entity of badges.listEntities()) {
        for (const b of JSON.parse(entity.badgesJson).filter(b => b.list)) {
            const rows = b.list.rows;
            if (b.pill == null) assert.equal(rows.length, 1, b.id);
            else if (b.pill.startsWith("×")) assert.equal(number(b.pill), rows.length, b.id);
            else assert.ok(Math.abs(rows.reduce((total, row) => total + number(row.value), 0) - number(b.pill)) < 0.051, b.id);
        }
    }
});
