// Run from api/: npm test
// /api/swimmerStats against in-memory Meets, Results and SwimmerBadges tables.
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeTable, call } = require("./fakes");

const meets = new FakeTable();
const results = new FakeTable();
const badges = new FakeTable();
const records = new FakeTable();
// The Function destructures these getters when it loads, so swap them in first.
Object.assign(require("../shared/meetsTable"), { getMeetsTable: () => meets });
Object.assign(require("../shared/resultsTable"), { getResultsTable: () => results });
Object.assign(require("../shared/badgeStore"), { getBadgesTable: () => badges });
Object.assign(require("../shared/teamRecords"), { getRecordsTable: () => records });
const swimmerStats = require("../swimmerStats/index.js");

const { PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");
const { recomputeBadges, readSwimmerNames } = require("../shared/badgeStore");
const { toRelayResultEntity } = require("../shared/resultsTable");

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
    // With each swimmer's age, and the badges held: none before badges are worked out.
    assert.deepEqual(res.body, { swimmers: ["Doe, Jane", "O'Moe, Kim"], ages: { "Doe, Jane": 9, "O'Moe, Kim": 9 }, badgesEarned: 0 });
});

test("before any import saves the list, the first request gathers it from the results and saves it", async () => {
    assert.deepEqual(await readSwimmerNames(badges), ["Doe, Jane", "O'Moe, Kim"]);
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

test("the list is read from the saved row, and each badge update saves it again", async () => {
    // A new swim without a badge update isn't listed yet, so the saved row is what's read.
    addSwim("Poe, Sam", "Spotswood", "m2", 9, "Boys 9-10 25m Freestyle", 1, 17.2);
    assert.deepEqual((await call(swimmerStats, { query: {} })).body.swimmers, ["Doe, Jane", "O'Moe, Kim"]);

    // A Spotswood relay swimmer with no individual swim has no season, so stays off the list.
    const relays = new FakeTable();
    relays.upsertEntity(toRelayResultEntity({
        eventNumber: 11, eventName: "Mixed 9-10 100m Freestyle Relay", relayLetter: "A", teamAbbrev: "SPOT", team: "Spotswood",
        place: 1, status: "OK", officialTime: "70.00", officialSeconds: 70,
        swimmers: [{ name: "Doe, Jane" }, { name: "Relay, Only" }, { name: "Poe, Sam" }, { name: "O'Moe, Kim" }]
    }, "m2"));
    await recomputeBadges({ resultsTable: results, relayTable: relays, meetsTable: meets, badgesTable: badges });
    const listed = (await call(swimmerStats, { query: {} })).body;
    assert.deepEqual(listed.swimmers, ["Doe, Jane", "O'Moe, Kim", "Poe, Sam"]);
    assert.deepEqual(listed.ages, { "Doe, Jane": 9, "O'Moe, Kim": 9, "Poe, Sam": 9 });
    // Every badge the team holds, relay-only swimmers' included.
    const held = badges.all().filter(r => r.partitionKey === "swimmer").reduce((total, r) => total + JSON.parse(r.badgesJson).length, 0);
    assert.equal(listed.badgesEarned, held);
    assert.ok(held > 0);

    // Someone whose only swims are gone (their meet deleted) drops off at the next update.
    await results.deleteEntity("Poe, Sam", "m2__9");
    await recomputeBadges({ resultsTable: results, relayTable: new FakeTable(), meetsTable: meets, badgesTable: badges });
    assert.deepEqual((await call(swimmerStats, { query: {} })).body.swimmers, ["Doe, Jane", "O'Moe, Kim"]);
    // The list's row isn't mistaken for a swimmer's badges.
    assert.equal((await call(swimmerStats, { query: { name: "Doe, Jane" } })).status, 200);
});

test("a list saved without a badge count gets one counted from the saved badges", async () => {
    const { saveSwimmerNames } = require("../shared/badgeStore");
    await saveSwimmerNames(badges, ["Doe, Jane", "O'Moe, Kim"], { ages: { "Doe, Jane": 9, "O'Moe, Kim": 9 } });
    const held = badges.all().filter(r => r.partitionKey === "swimmer").reduce((total, r) => total + JSON.parse(r.badgesJson).length, 0);
    assert.equal((await call(swimmerStats, { query: {} })).body.badgesEarned, held);
    assert.equal((await readSwimmerNames(badges)).length, 2);
});

test("each event carries its team record, marked as the swimmer's own when they set it here", async () => {
    const { toRecordEntity } = require("../shared/teamRecords");
    records.upsertEntity(toRecordEntity({ key: "m|girls|9-10|25|Free", time: "19.90", seconds: 19.9, year: 2026, setAtMeet: "m2" }));
    records.upsertEntity(toRecordEntity({ key: "m|girls|9-10|25|Back", time: "18.00", seconds: 18, year: 2015 }));
    const row = results.rows.get(results.key("Doe, Jane", "m2__3"));
    row.teamRecord = true;
    try {
        const jane = (await call(swimmerStats, { query: { name: "Doe, Jane" } })).body;
        assert.deepEqual(jane.events.find(e => e.eventName === "Girls 9-10 25m Freestyle").record, { time: "19.90", seconds: 19.9, year: 2026, yards: false, mine: true });
        const kim = (await call(swimmerStats, { query: { name: "O'Moe, Kim" } })).body;
        assert.deepEqual(kim.events[0].record, { time: "18.00", seconds: 18, year: 2015, yards: false, mine: false });
    } finally {
        row.teamRecord = false;
    }
});

test("a yards event is held to the meters record at its converted time", async () => {
    const { toRecordEntity } = require("../shared/teamRecords");
    records.upsertEntity(toRecordEntity({ key: "m|boys|9-10|25|Free", time: "23.55", seconds: 23.55, year: 2026, converted: true, setAtMeet: "m1" }));
    results.upsertEntity({ partitionKey: "Yard, Yan", rowKey: "m1__9", meetId: "m1", eventNumber: 9, eventName: "Boys 9-10 25yd Freestyle", age: 9, team: "Spotswood",
        place: 1, status: "OK", seedTime: "NT", officialTime: "21.22", seedSeconds: null, officialSeconds: 21.22, points: 6, teamRecord: true });
    const yan = (await call(swimmerStats, { query: { name: "Yard, Yan" } })).body;
    assert.deepEqual(yan.events[0].record, { time: "23.55", seconds: 23.55, year: 2026, yards: true, mine: true });
});
