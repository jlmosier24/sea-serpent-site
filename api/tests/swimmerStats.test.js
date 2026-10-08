// Run from api/: npm test
// /api/swimmerStats against in-memory Meets, Results and SwimmerBadges tables.
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeTable, call } = require("./fakes");

const meets = new FakeTable();
const results = new FakeTable();
const badges = new FakeTable();
// The Function destructures these getters when it loads, so swap them in first.
Object.assign(require("../shared/meetsTable"), { getMeetsTable: () => meets });
Object.assign(require("../shared/resultsTable"), { getResultsTable: () => results });
Object.assign(require("../shared/badgeStore"), { getBadgesTable: () => badges });
const swimmerStats = require("../swimmerStats/index.js");

const { PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");
const { recomputeBadges } = require("../shared/badgeStore");

function addMeet(id, date) {
    meets.upsertEntity({ partitionKey: MEET_PARTITION_KEY, rowKey: id, opponent: "Test Seahawks", shortName: "Test", homeAway: "home", date });
}
function addSwim(name, team, meetId, eventNumber, eventName, place, officialSeconds) {
    results.upsertEntity({
        partitionKey: name, rowKey: `${meetId}__${eventNumber}`, meetId, eventNumber, eventName, age: 9, team,
        place, status: "OK", seedTime: "NT", officialTime: officialSeconds.toFixed(2), seedSeconds: null, officialSeconds, points: 0
    });
}

addMeet("m1", "2026-06-10");
addMeet("m2", "2026-06-17");
addSwim("Doe, Jane", "Spotswood", "m1", 3, "Girls 9-10 25m Freestyle", 2, 20.5);
addSwim("Doe, Jane", "Spotswood", "m2", 3, "Girls 9-10 25m Freestyle", 1, 19.9);
addSwim("O'Moe, Kim", "Spotswood", "m1", 5, "Girls 9-10 25m Backstroke", 4, 24.1);
// An opposing swimmer with the same name as a Spotswood one.
addSwim("Doe, Jane", "Test Seahawks", "m2", 7, "Girls 9-10 25m Butterfly", 3, 22);
addSwim("Roe, Rita", "Test Seahawks", "m1", 3, "Girls 9-10 25m Freestyle", 1, 18);

test("with no name, it lists Spotswood's swimmers only, sorted", async () => {
    const res = await call(swimmerStats, { query: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { swimmers: ["Doe, Jane", "O'Moe, Kim"] });
});

test("before badges have been worked out, a swimmer's season still loads, with none", async () => {
    const res = await call(swimmerStats, { query: { name: "Doe, Jane" } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.badges, []);
});

test("with a name, it returns that swimmer's season, leaving out an opposing swimmer's rows", async () => {
    await recomputeBadges({ resultsTable: results, relayTable: new FakeTable(), meetsTable: meets, badgesTable: badges });
    const res = await call(swimmerStats, { query: { name: "Doe, Jane" } });
    assert.equal(res.status, 200);
    const season = res.body;
    assert.equal(season.age, 9);
    assert.equal(season.season, "2026");
    assert.deepEqual(season.events.map(e => e.eventName), ["Girls 9-10 25m Freestyle"]);
    const [first, second] = season.events[0].swims;
    assert.deepEqual([first.meetDate, second.meetDate], ["2026-06-10", "2026-06-17"]);
    assert.equal(second.change, -0.6);
    // A first swim is never a personal best; the second beat it.
    assert.deepEqual([first.personalBest, second.personalBest], [false, true]);
    // New ones (from the latest meet) first, then the fixed ranking; First Splash last.
    assert.deepEqual(season.badges.map(b => [b.id, b.isNew]), [["champion", true], ["barrier", true], ["pb", true], ["attendance", true], ["splash", false]]);
    assert.equal(season.meetsSwum, 2);
});

test("a name with an apostrophe works, and an unknown or opposing-only name is a 404", async () => {
    assert.equal((await call(swimmerStats, { query: { name: "O'Moe, Kim" } })).status, 200);
    assert.equal((await call(swimmerStats, { query: { name: "Nobody, Here" } })).status, 404);
    assert.equal((await call(swimmerStats, { query: { name: "Roe, Rita" } })).status, 404);
});
