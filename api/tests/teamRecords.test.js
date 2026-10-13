// Run from api/: npm test
// Team records: reading a saved SwimTopia Team Records page (a made-up one in
// its layout, every name invented), matching results to records, and marking
// and saving new records at an import, against in-memory storage.
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeTable, FakeContainer, call } = require("./fakes");

const store = {};
function resetStore() {
    store.meets = new FakeTable();
    store.results = new FakeTable();
    store.relays = new FakeTable();
    store.badges = new FakeTable();
    store.records = new FakeTable();
    store.sheets = new FakeContainer();
}
resetStore();
// The Functions destructure these getters when they load, so swap them in first.
Object.assign(require("../shared/meetsTable"), { getMeetsTable: () => store.meets });
Object.assign(require("../shared/resultsTable"), { getResultsTable: () => store.results, getRelayResultsTable: () => store.relays });
Object.assign(require("../shared/resultsPdfContainer"), { getResultsPdfContainer: () => store.sheets });
Object.assign(require("../shared/badgeStore"), { getBadgesTable: () => store.badges });
Object.assign(require("../shared/teamRecords"), { getRecordsTable: () => store.records });
Object.assign(require("../shared/pdfText"), { extractPdfText: async buffer => buffer.toString("utf8") });

const { parseRecordsPage, keyForEvent, describeKey } = require("../shared/teamRecords");
const uploadRecords = require("../manageRecordsUpload/index.js");
const listRecordsFn = require("../manageRecordsList/index.js");
const previewResults = require("../importMeetResultsPreview/index.js");
const commitResults = require("../importMeetResultsCommit/index.js");
const deleteMeet = require("../manageMeetsDelete/index.js");
const matchRecords = require("../manageRecordsMatch/index.js");
const { sheetText } = require("./sampleSheet");

// One record, as the page lays it out: year, holder names, time ("*" when converted).
const side = (year, names, time, converted, girls) => {
    const parts = [
        `<div class="record-row__year st-col3">${year}</div>`,
        `<div class="record-row__names st-col6"><div>${names}</div></div>`,
        `<div class="record-row__time st-col3"><span>${time}<span class="conversion-indicator">${converted ? "*" : ""}</span></span></div>`
    ];
    return `<div class="event-row__record-detail st-col5 table-cell"><div class="record_detail__record-row st-row">${(girls ? parts : parts.reverse()).join("")}</div></div>`;
};
const row = (event, girls, boys) => `<div class="record-snippet__event-row st-row">${side(...girls, true)}<div class="event-row__event-detail st-col2 align-center table-header">${event}</div>${side(...boys, false)}</div>`;
const group = (title, rows) => `<div class="grid-lined record-snippet__age-range-table zebra-striped"><div class="record-snippet__header st-row table-header"><div class="age-range-gender-group st-col5">Girls</div><div class="age-range-title st-col2 align-center">${title}</div><div class="age-range-gender-group st-col5">Boys</div></div>${rows.join("")}</div>`;
const PAGE = `<html><body><h2>Team Records</h2><p>Records displayed in course (pool length): <strong>Short Course Meters (25m)</strong></p>
    ${group("8 &amp; Under", [
        row("25 Free", ["2019", "Old, Olive", "24.80", false], ["2015", "Past, Pete", "22.00", false]),
        row("100 Free Relay", ["1999", "A. One, B. Two, C. Three, D. Four", "1:50.00", true], ["2001", "E. Five, F. Six, G. Seven, H. Eight", "1:40.00", false])
    ])}
    ${group("9&ndash;10", [row("25 Fly", ["2010", "Fly, Fay", "16.36", false], ["2012", "Wing, Will", "16.12", false])])}
</body></html>`;

test("the records page is read: course, events by gender and age group, times, years, converted marks, and holders", () => {
    const parsed = parseRecordsPage(PAGE);
    assert.equal(parsed.course, "m");
    assert.deepEqual(parsed.records.map(r => [r.key, r.time, r.year, r.converted]), [
        ["m|girls|8 & under|25|Free", "24.80", 2019, false],
        ["m|boys|8 & under|25|Free", "22.00", 2015, false],
        ["m|girls|8 & under|100|Free Relay", "1:50.00", 1999, true],
        ["m|boys|8 & under|100|Free Relay", "1:40.00", 2001, false],
        ["m|girls|9-10|25|Fly", "16.36", 2010, false],
        ["m|boys|9-10|25|Fly", "16.12", 2012, false]
    ]);
    assert.equal(parsed.records[2].seconds, 110);
    assert.deepEqual(parsed.records.map(r => r.holder), ["Olive Old", "Pete Past", "A. One, B. Two, C. Three, D. Four", "E. Five, F. Six, G. Seven, H. Eight", "Fay Fly", "Will Wing"]);
    assert.equal(parseRecordsPage("<p>Something else</p>").records.length, 0);
});

test("a result's event finds its record: gender, age group, distance, stroke, and pool length", () => {
    assert.equal(keyForEvent("Girls 8 & Under 25m Freestyle"), "m|girls|8 & under|25|Free");
    assert.equal(keyForEvent("Women 15-18 50m Freestyle"), "m|girls|15-18|50|Free");
    assert.equal(keyForEvent("Boys 9-10 25m Butterfly"), "m|boys|9-10|25|Fly");
    assert.equal(keyForEvent("Girls 9-10 25yd Freestyle"), "yd|girls|9-10|25|Free");
    assert.equal(keyForEvent("Mixed 6 & Under 100m Freestyle Relay"), null);
    assert.equal(describeKey("m|girls|9-10|25|Fly"), "9–10 girls · 25 Fly");
});

async function loadRecords() {
    const preview = await call(uploadRecords, { body: { html: PAGE } });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.changes, { added: 6, changed: 0, unchanged: 0, keptFromSite: [] });
    assert.equal(store.records.all().length, 0, "a preview saves nothing");
    assert.equal((await call(uploadRecords, { body: { html: PAGE, save: true } })).status, 200);
}
const storedRecord = async key => (await call(listRecordsFn, {})).body.find(r => r.key === key);
async function addMeet(rowKey, date = "2026-07-13") {
    await store.meets.upsertEntity({ partitionKey: "meet", rowKey, opponent: "Test Seahawks", shortName: "Test", homeAway: "away", date });
}
const upload = text => Buffer.from(text, "utf8").toString("base64");

test("an import marks the swims and relays that set a team record, and saves the new records", async () => {
    resetStore();
    await loadRecords();
    await addMeet("m");
    // The sample sheet: Spotswood's 24.50 in the girls' 8 & under 25 free, and its 1:45.88 relay.
    const preview = await call(previewResults, { body: { meetId: "m", dataBase64: upload(sheetText()) } });
    assert.deepEqual(preview.body.newRecords.map(r => [r.label, r.time, r.old.time]), [["8 & Under girls · 25 Free", "24.50", "24.80"], ["8 & Under girls · 100 Free Relay", "1:45.88", "1:50.00"]]);

    const res = await call(commitResults, { body: { meetId: "m", dataBase64: upload(sheetText()), fileName: "results.pdf" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.newRecords.length, 2);
    // Only the record-setting rows are marked, and not the other team's or an exhibition swim.
    assert.deepEqual(store.results.all().filter(r => r.teamRecord).map(r => r.partitionKey), ["Doe, Jane"]);
    assert.deepEqual(store.relays.all().filter(r => r.teamRecord).map(r => `${r.team} ${r.relayLetter}`), ["Spotswood A"]);
    const meet = await store.meets.getEntity("meet", "m");
    const summary = JSON.parse(meet.summaryJson);
    assert.deepEqual(summary.newRecords.map(r => r.name || r.team), ["Doe, Jane", "Spotswood (A)"]);
    assert.deepEqual(summary.newRecords[1].swimmers, ["Doe, Jane", "Poe, Sam", "Koe, Kim", "Loe, Liz"]);

    // The stored record is the new one, set this year at this meet.
    assert.deepEqual(await storedRecord("m|girls|8 & under|25|Free"), { key: "m|girls|8 & under|25|Free", label: "8 & Under girls · 25 Free", time: "24.50", year: 2026, converted: false, holder: "Jane Doe", setAtMeet: "m" });
    assert.equal((await storedRecord("m|girls|8 & under|100|Free Relay")).holder, "Jane Doe, Sam Poe, Kim Koe, Liz Loe");

    // The swimmer earns Record Breaker, listing the swim and the relay.
    const badges = JSON.parse((await store.badges.getEntity("swimmer", encodeURIComponent("Doe, Jane"))).badgesJson);
    const breaker = badges.find(b => b.id === "record");
    assert.deepEqual([breaker.pill, breaker.list.rows.length], ["×2", 2]);
});

test("re-importing the meet still marks its records, against the ones they replaced", async () => {
    const res = await call(commitResults, { body: { meetId: "m", dataBase64: upload(sheetText()), fileName: "results.pdf" } });
    assert.equal(res.body.newRecords.length, 2);
    assert.equal((await storedRecord("m|girls|8 & under|25|Free")).time, "24.50");
});

test("a corrected sheet that no longer sets a record puts the old one back; so does deleting the meet", async () => {
    // Without the record swim, the girls' 25 free goes back to 24.80; the relay record stays.
    const slower = sheetText({ individual: ["1 Doe, Jane 8 Spotswood 25.10 24.90 6"] });
    await call(commitResults, { body: { meetId: "m", dataBase64: upload(slower), fileName: "results.pdf" } });
    assert.deepEqual([(await storedRecord("m|girls|8 & under|25|Free")).time, (await storedRecord("m|girls|8 & under|100|Free Relay")).time], ["24.80", "1:45.88"]);

    await call(deleteMeet, { query: { id: "m" } });
    const relay = await storedRecord("m|girls|8 & under|100|Free Relay");
    assert.deepEqual([relay.time, relay.year, relay.converted, relay.holder, relay.setAtMeet], ["1:50.00", 1999, true, "A. One, B. Two, C. Three, D. Four", ""]);
});

test("an import told not to update the records marks the swims but leaves the records", async () => {
    resetStore();
    await loadRecords();
    await addMeet("m");
    const res = await call(commitResults, { body: { meetId: "m", dataBase64: upload(sheetText()), fileName: "results.pdf", updateRecords: false } });
    assert.equal(res.body.newRecords.length, 2);
    assert.equal(store.results.all().filter(r => r.teamRecord).length, 1);
    assert.equal((await storedRecord("m|girls|8 & under|25|Free")).time, "24.80");
});

test("loading the page again keeps a faster record set here that SwimTopia doesn't have yet", async () => {
    resetStore();
    await loadRecords();
    await addMeet("m");
    await call(commitResults, { body: { meetId: "m", dataBase64: upload(sheetText()), fileName: "results.pdf" } });
    const res = await call(uploadRecords, { body: { html: PAGE, save: true } });
    assert.deepEqual(res.body.changes.keptFromSite.map(k => [k.label, k.time, k.pageTime]), [["8 & Under girls · 25 Free", "24.50", "24.80"], ["8 & Under girls · 100 Free Relay", "1:45.88", "1:50.00"]]);
    assert.equal((await storedRecord("m|girls|8 & under|25|Free")).time, "24.50");
    assert.equal((await call(uploadRecords, { body: {} })).status, 400);
});

// The page once SwimTopia lists this season's records: the sample sheet's
// 24.50 and 1:45.88, a converted one, and one no swim here has.
const SEASON_PAGE = `<html><body><p>Records displayed in course (pool length): <strong>Short Course Meters (25m)</strong></p>
    ${group("8 &amp; Under", [
        row("25 Free", ["2026", "Doe, Jane", "24.50", false], ["2026", "New, Ned", "21.90", true]),
        row("100 Free Relay", ["2026", "J. Doe, S. Poe, K. Koe, L. Loe", "1:45.88", false], ["2026", "E. Five, F. Six, G. Seven, H. Eight", "1:39.00", false])
    ])}
</body></html>`;

test("records loaded after their meet was imported are matched to the swims that set them", async () => {
    resetStore();
    await addMeet("m");
    await call(commitResults, { body: { meetId: "m", dataBase64: upload(sheetText()), fileName: "results.pdf" } });
    assert.equal(store.results.all().filter(r => r.teamRecord).length, 0, "no records loaded yet, so nothing is marked");
    await call(uploadRecords, { body: { html: SEASON_PAGE, save: true } });

    const res = await call(matchRecords, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.season, 2026);
    assert.deepEqual(res.body.matched.map(r => [r.label, r.time, r.meetDate]), [
        ["8 & Under girls · 25 Free", "24.50", "2026-07-13"],
        ["8 & Under girls · 100 Free Relay", "1:45.88", "2026-07-13"]
    ]);
    assert.deepEqual(res.body.notMatched.map(r => [r.label, r.reason]), [
        ["8 & Under boys · 25 Free", "No yards swim this season converts to this time"],
        ["8 & Under boys · 100 Free Relay", "No swim this season with this time"]
    ]);
    assert.deepEqual(store.results.all().filter(r => r.teamRecord).map(r => r.partitionKey), ["Doe, Jane"]);
    assert.deepEqual(store.relays.all().filter(r => r.teamRecord).map(r => `${r.team} ${r.relayLetter}`), ["Spotswood A"]);
    const summary = JSON.parse((await store.meets.getEntity("meet", "m")).summaryJson);
    assert.deepEqual(summary.newRecords.map(r => [r.name || r.team, r.time, r.old]), [["Doe, Jane", "24.50", null], ["Spotswood (A)", "1:45.88", null]]);
    assert.equal(summary.swims > 0, true, "the rest of the meet's numbers stay");
    const badges = JSON.parse((await store.badges.getEntity("swimmer", encodeURIComponent("Doe, Jane"))).badgesJson);
    assert.equal(badges[0].id, "record");
    assert.deepEqual(await storedRecord("m|girls|8 & under|25|Free").then(r => [r.setAtMeet, r.holder]), ["m", "Jane Doe"]);

    // Again: nothing new to match.
    const again = await call(matchRecords, {});
    assert.deepEqual([again.body.matched.length, again.body.alreadyMarked.length], [0, 2]);

    // Re-importing the meet keeps its matched records marked, with no old record known.
    const reimport = await call(commitResults, { body: { meetId: "m", dataBase64: upload(sheetText()), fileName: "results.pdf" } });
    assert.deepEqual(reimport.body.newRecords.map(r => [r.time, r.old]), [["24.50", null], ["1:45.88", null]]);
    const record = await storedRecord("m|girls|8 & under|25|Free");
    assert.deepEqual([record.time, record.setAtMeet], ["24.50", "m"]);

    // Loading the page again keeps them tied to the meet.
    const reload = await call(uploadRecords, { body: { html: SEASON_PAGE, save: true } });
    assert.deepEqual(reload.body.changes.keptFromSite, []);
    assert.equal((await storedRecord("m|girls|8 & under|100|Free Relay")).setAtMeet, "m");

    // One matched before holders were saved gets the page's holder, still tied to the meet.
    const { toRecordEntity } = require("../shared/teamRecords");
    const relayRow = store.records.all().find(r => r.key === "m|girls|8 & under|100|Free Relay");
    await store.records.upsertEntity(toRecordEntity({ ...relayRow, holder: "" }), "Replace");
    const filled = await call(uploadRecords, { body: { html: SEASON_PAGE, save: true } });
    assert.equal(filled.body.changes.changed, 1);
    const relayRecord = await storedRecord("m|girls|8 & under|100|Free Relay");
    assert.deepEqual([relayRecord.holder, relayRecord.setAtMeet], ["J. Doe, S. Poe, K. Koe, L. Loe", "m"]);

    // Deleting the meet leaves the records, no longer tied to it.
    await call(deleteMeet, { query: { id: "m" } });
    const kept = await storedRecord("m|girls|8 & under|25|Free");
    assert.deepEqual([kept.time, kept.setAtMeet], ["24.50", ""]);
});

// A yards meet: Spotswood's 22.00 yd converts to 24.42 m (x 1.11), under the 24.80 record.
const yardsSheet = () => sheetText({ course: "yd", individual: ["1 Doe, Jane 8 Spotswood 22.50 22.00 6", "2 Roe, Rachel 8 Test Seahawks 23.00 22.40 4"] });

test("a yards swim sets a meters record at its time x 1.11, saved as converted", async () => {
    resetStore();
    await loadRecords();
    await addMeet("m");
    const res = await call(commitResults, { body: { meetId: "m", dataBase64: upload(yardsSheet()), fileName: "results.pdf" } });
    assert.deepEqual(res.body.newRecords.map(r => [r.label, r.time, r.converted, r.fromTime, r.old.time]), [["8 & Under girls · 25 Free", "24.42", true, "22.00", "24.80"]]);
    assert.deepEqual(store.results.all().filter(r => r.teamRecord).map(r => r.partitionKey), ["Doe, Jane"]);
    const record = await storedRecord("m|girls|8 & under|25|Free");
    assert.deepEqual([record.time, record.converted, record.setAtMeet], ["24.42", true, "m"]);
    // Deleting the meet puts the meters record back.
    await call(deleteMeet, { query: { id: "m" } });
    const back = await storedRecord("m|girls|8 & under|25|Free");
    assert.deepEqual([back.time, back.converted], ["24.80", false]);
});

test("a converted record loaded after its yards meet was imported is matched to that swim", async () => {
    resetStore();
    await addMeet("m");
    await call(commitResults, { body: { meetId: "m", dataBase64: upload(yardsSheet()), fileName: "results.pdf" } });
    const page = `<html><body><p>Records displayed in course (pool length): <strong>Short Course Meters (25m)</strong></p>
        ${group("8 &amp; Under", [row("25 Free", ["2026", "Doe, Jane", "24.42", true], ["2015", "Past, Pete", "22.00", false])])}</body></html>`;
    await call(uploadRecords, { body: { html: page, save: true } });
    const res = await call(matchRecords, {});
    assert.deepEqual(res.body.matched.map(r => [r.label, r.time]), [["8 & Under girls · 25 Free", "24.42"]]);
    assert.deepEqual(store.results.all().filter(r => r.teamRecord).map(r => r.partitionKey), ["Doe, Jane"]);
    const summary = JSON.parse((await store.meets.getEntity("meet", "m")).summaryJson);
    assert.deepEqual(summary.newRecords.map(r => [r.time, r.fromTime, r.old]), [["24.42", "22.00", null]]);
});
