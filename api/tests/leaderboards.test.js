// Run from api/: npm test
// The Stats page's leaderboards: each meters event's best season times,
// worked out with the badges and served by /api/leaderboards (made-up names).
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeTable, call } = require("./fakes");

const store = {};
function resetStore() {
    store.meets = new FakeTable();
    store.results = new FakeTable();
    store.relays = new FakeTable();
    store.badges = new FakeTable();
    store.records = new FakeTable();
}
resetStore();
// The Functions destructure these getters when they load, so swap them in first.
Object.assign(require("../shared/meetsTable"), { getMeetsTable: () => store.meets });
Object.assign(require("../shared/resultsTable"), { getResultsTable: () => store.results, getRelayResultsTable: () => store.relays });
Object.assign(require("../shared/badgeStore"), { getBadgesTable: () => store.badges });
Object.assign(require("../shared/teamRecords"), { getRecordsTable: () => store.records });
const leaderboards = require("../leaderboards/index.js");
const { buildLeaderboards } = require("../shared/leaderboards");
const { recomputeBadges } = require("../shared/badgeStore");
const { toRecordEntity } = require("../shared/teamRecords");
const { PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");

const swim = (name, eventName, seconds, meetDate, extra = {}) => ({
    name, eventName, officialSeconds: seconds, officialTime: seconds.toFixed(2), meetId: `m-${meetDate}`, meetDate, status: "OK", team: "Spotswood", ...extra
});

test("each event lists every swimmer once at their best time this season, fastest first", () => {
    const boards = buildLeaderboards([
        swim("Doe, Jane", "Girls 9-10 25m Freestyle", 16.2, "2026-06-17"),
        swim("Doe, Jane", "Girls 9-10 25m Freestyle", 15.9, "2026-07-08"),
        swim("Roe, Mia", "Girls 9-10 25m Freestyle", 15.9, "2026-06-24"),
        swim("Poe, Ava", "Girls 9-10 25m Freestyle", 15.1, "2026-07-08", { status: "DQ" }),
        swim("Poe, Ava", "Girls 9-10 25m Freestyle", 14.0, "2025-07-08"), // last season
        swim("Poe, Ava", "Girls 9-10 25yd Freestyle", 13.0, "2026-07-26"), // yards: the championship
        swim("Poe, Ava", "Girls 9-10 100m Freestyle Relay", 70, "2026-07-08")
    ]);
    assert.equal(boards.season, 2026);
    assert.deepEqual(boards.events.map(e => e.eventName), ["Girls 9-10 25m Freestyle"]);
    assert.deepEqual(boards.events[0].rows.map(r => [r.name, r.time, r.meetDate]), [["Doe, Jane", "15.90", "2026-07-08"], ["Roe, Mia", "15.90", "2026-06-24"]]);
});

test("/api/leaderboards: worked out once, saved, and served with each event's current record", async () => {
    resetStore();
    store.meets.upsertEntity({ partitionKey: MEET_PARTITION_KEY, rowKey: "m1", opponent: "Test Seahawks", shortName: "Test", homeAway: "home", date: "2026-07-13" });
    const add = (name, eventNumber, eventName, seconds, extra = {}) => store.results.upsertEntity({
        partitionKey: name, rowKey: `m1__${eventNumber}`, meetId: "m1", eventNumber, eventName, age: 9, team: "Spotswood",
        place: 1, status: "OK", officialTime: seconds.toFixed(2), officialSeconds: seconds, points: 6, ...extra
    });
    add("Doe, Jane", 3, "Girls 9-10 25m Freestyle", 15.31, { teamRecord: true });
    add("Roe, Mia", 3, "Girls 9-10 25m Freestyle", 16.02);
    add("Lowe, Sam", 4, "Boys 9-10 25m Freestyle", 15.5);
    store.results.upsertEntity({ partitionKey: "Rival, Ann", rowKey: "m1__3", meetId: "m1", eventNumber: 3, eventName: "Girls 9-10 25m Freestyle", team: "Test Seahawks", status: "OK", officialTime: "14.00", officialSeconds: 14 });
    store.records.upsertEntity(toRecordEntity({ key: "m|girls|9-10|25|Free", time: "15.31", seconds: 15.31, year: 2026, holder: "Jane Doe", setAtMeet: "m1" }));

    const res = await call(leaderboards, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.season, 2026);
    const girls = res.body.events.find(e => e.eventName === "Girls 9-10 25m Freestyle");
    assert.deepEqual([girls.gender, girls.group, girls.event], ["girls", "9-10", "25m Freestyle"]);
    assert.deepEqual(girls.record, { time: "15.31", seconds: 15.31, year: 2026 });
    assert.deepEqual(girls.rows.map(r => [r.name, r.age, r.teamRecord]), [["Doe, Jane", 9, true], ["Roe, Mia", 9, false]]);
    assert.equal(JSON.stringify(res.body).includes("Jane Doe"), false, "record holders' names stay on the admin page");
    assert.equal(JSON.stringify(res.body).includes("Rival"), false, "Spotswood only");
    assert.equal(res.body.events.find(e => e.gender === "boys").record, null);
    // Saved, so the next request reads the saved boards.
    assert.equal(store.badges.all().filter(r => r.partitionKey === "leaderboard").length, 2);
});

test("the boards are saved again with the badges after an import, and an event no longer swum is dropped", async () => {
    resetStore();
    store.meets.upsertEntity({ partitionKey: MEET_PARTITION_KEY, rowKey: "m1", opponent: "Test Seahawks", shortName: "Test", homeAway: "home", date: "2026-07-13" });
    store.badges.upsertEntity({ partitionKey: "leaderboard", rowKey: encodeURIComponent("Boys 9-10 25m Butterfly"), eventName: "Boys 9-10 25m Butterfly", season: 2026, rowsJson: "[]" });
    store.results.upsertEntity({ partitionKey: "Doe, Jane", rowKey: "m1__3", meetId: "m1", eventNumber: 3, eventName: "Girls 9-10 25m Freestyle", age: 9, team: "Spotswood", place: 1, status: "OK", officialTime: "15.31", officialSeconds: 15.31, points: 6 });
    await recomputeBadges({ resultsTable: store.results, relayTable: store.relays, meetsTable: store.meets, badgesTable: store.badges });
    assert.deepEqual(store.badges.all().filter(r => r.partitionKey === "leaderboard").map(r => r.eventName), ["Girls 9-10 25m Freestyle"]);
});

test("boards saved before ages were kept are worked out again", async () => {
    resetStore();
    store.meets.upsertEntity({ partitionKey: MEET_PARTITION_KEY, rowKey: "m1", opponent: "Test Seahawks", shortName: "Test", homeAway: "home", date: "2026-07-13" });
    store.results.upsertEntity({ partitionKey: "Doe, Jane", rowKey: "m1__3", meetId: "m1", eventNumber: 3, eventName: "Girls 9-10 25m Freestyle", age: 10, team: "Spotswood", place: 1, status: "OK", officialTime: "15.31", officialSeconds: 15.31 });
    store.badges.upsertEntity({ partitionKey: "leaderboard", rowKey: encodeURIComponent("Girls 9-10 25m Freestyle"), eventName: "Girls 9-10 25m Freestyle", season: 2026,
        rowsJson: JSON.stringify([{ name: "Doe, Jane", seconds: 15.31, time: "15.31", meetId: "m1", meetDate: "2026-07-13", teamRecord: false }]) });
    const res = await call(leaderboards, {});
    assert.equal(res.body.events[0].rows[0].age, 10);
    assert.equal(JSON.parse(store.badges.all().find(r => r.partitionKey === "leaderboard").rowsJson)[0].age, 10);
});
