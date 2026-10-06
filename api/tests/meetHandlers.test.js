// Run from api/: npm test
// The meet Functions run against in-memory stand-ins for Table and Blob
// storage, so these tests never touch real data.
const test = require("node:test");
const assert = require("node:assert/strict");

function notFound() {
    const err = new Error("Not found");
    err.statusCode = 404;
    return err;
}

// Just enough of @azure/data-tables' TableClient for these Functions,
// including "<field> eq '<value>'" filters.
class FakeTable {
    constructor() { this.rows = new Map(); }
    key(pk, rk) { return `${pk}\u0000${rk}`; }
    async getEntity(pk, rk) {
        const row = this.rows.get(this.key(pk, rk));
        if (!row) throw notFound();
        return { ...row };
    }
    async upsertEntity(entity, mode = "Merge") {
        const k = this.key(entity.partitionKey, entity.rowKey);
        const prev = this.rows.get(k);
        this.rows.set(k, mode === "Replace" || !prev ? { ...entity } : { ...prev, ...entity });
    }
    async updateEntity(entity, mode = "Merge") {
        const k = this.key(entity.partitionKey, entity.rowKey);
        const prev = this.rows.get(k);
        if (!prev) throw notFound();
        this.rows.set(k, mode === "Replace" ? { ...entity } : { ...prev, ...entity });
    }
    async deleteEntity(pk, rk) {
        if (!this.rows.delete(this.key(pk, rk))) throw notFound();
    }
    async *listEntities(options = {}) {
        const filter = options.queryOptions && options.queryOptions.filter;
        const match = filter && filter.match(/^(\w+) eq '((?:[^']|'')*)'$/);
        for (const row of [...this.rows.values()]) {
            if (match) {
                const field = { PartitionKey: "partitionKey", RowKey: "rowKey" }[match[1]] || match[1];
                if (String(row[field]) !== match[2].replace(/''/g, "'")) continue;
            }
            yield { ...row };
        }
    }
    all() { return [...this.rows.values()]; }
}

class FakeContainer {
    constructor() { this.blobs = new Map(); }
    getBlockBlobClient(name) { return { uploadData: async (data) => { this.blobs.set(name, data); } }; }
    async *listBlobsFlat({ prefix = "" } = {}) {
        for (const name of [...this.blobs.keys()]) if (name.startsWith(prefix)) yield { name };
    }
    async deleteBlob(name) { this.blobs.delete(name); }
}

const store = {};
function resetStore() {
    store.meets = new FakeTable();
    store.results = new FakeTable();
    store.relays = new FakeTable();
    store.settings = new FakeTable();
    store.sheets = new FakeContainer();
}
resetStore();

// The Functions destructure these getters when they load, so swap them in first.
Object.assign(require("../shared/meetsTable"), { getMeetsTable: () => store.meets });
Object.assign(require("../shared/resultsTable"), { getResultsTable: () => store.results, getRelayResultsTable: () => store.relays });
Object.assign(require("../shared/settingsTable"), { getSettingsTable: () => store.settings });
Object.assign(require("../shared/resultsPdfContainer"), { getResultsPdfContainer: () => store.sheets });
// The "PDF" in these tests is just a sample sheet's text, so reading it is decoding it.
Object.assign(require("../shared/pdfText"), { extractPdfText: async buffer => buffer.toString("utf8") });

const saveMeet = require("../manageMeetsSave/index.js");
const deleteMeet = require("../manageMeetsDelete/index.js");
const fillHomePool = require("../manageMeetsFillHomePool/index.js");
const saveSettings = require("../manageSettingsSave/index.js");
const getSettings = require("../manageSettingsGet/index.js");
const previewResults = require("../importMeetResultsPreview/index.js");
const commitResults = require("../importMeetResultsCommit/index.js");
const publicMeets = require("../meets/index.js");
const { sheetText, INDIVIDUAL } = require("./sampleSheet");

const asUpload = text => Buffer.from(text, "utf8").toString("base64");

async function call(handler, { body, query = {} } = {}) {
    const log = () => {};
    log.error = () => {};
    const context = { res: null, log };
    await handler(context, { body, query });
    return context.res;
}

const massad = { opponent: "Massad Marlins", shortName: "Massad", homeAway: "home", date: "2026-07-08", time: "18:00" };

test("saving a new meet stores the derived title under an id from its date and opponent", async () => {
    resetStore();
    const res = await call(saveMeet, { body: massad });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, "2026-07-08-massad-marlins");
    assert.equal(res.body.title, "vs. Massad");
    const second = await call(saveMeet, { body: massad });
    assert.equal(second.body.id, "2026-07-08-massad-marlins-2");
});

test("a save that fails the checks stores nothing; an edit of a deleted meet is a 404", async () => {
    resetStore();
    assert.equal((await call(saveMeet, { body: { ...massad, opponent: "" } })).status, 400);
    assert.equal(store.meets.all().length, 0);
    assert.equal((await call(saveMeet, { body: { ...massad, id: "gone" } })).status, 404);
});

test("editing replaces the details but keeps the import's fields, and clears what was cleared", async () => {
    resetStore();
    await store.meets.upsertEntity({ partitionKey: "meet", rowKey: "m", title: "vs. Massad Marlins", opponent: "Massad Marlins", date: "2026-07-08",
        note: "Bring a chair", lat: 1, lon: 2, address: "Old address", teamScore: 550, opponentScore: 473, scoreSource: "import",
        resultsImported: true, lastImportFile: "sheet.pdf", lastImportAt: "2026-10-04T23:00:00Z", hidden: false });
    const res = await call(saveMeet, { body: { ...massad, id: "m", address: "Typed address", note: "", teamScore: 550, opponentScore: 473 } });
    assert.equal(res.status, 200);
    const row = await store.meets.getEntity("meet", "m");
    assert.equal(row.title, "vs. Massad");
    assert.equal(row.note, "");
    assert.equal(row.address, "Typed address");
    assert.equal("lat" in row, false, "coordinates for the old address are dropped");
    assert.equal("hidden" in row, false, "the retired hidden flag is dropped");
    assert.equal(row.scoreSource, "import");
    assert.equal(row.lastImportFile, "sheet.pdf");
    assert.equal(row.resultsImported, true);
});

test("deleting a meet deletes its results and sheets, and only its own", async () => {
    resetStore();
    await store.meets.upsertEntity({ partitionKey: "meet", rowKey: "m", opponent: "A", date: "2026-07-08" });
    await store.meets.upsertEntity({ partitionKey: "meet", rowKey: "m-2", opponent: "B", date: "2026-07-08" });
    for (const meetId of ["m", "m-2"]) {
        await store.results.upsertEntity({ partitionKey: "Doe, Jane", rowKey: `${meetId}__1`, meetId });
        await store.results.upsertEntity({ partitionKey: "Doe, John", rowKey: `${meetId}__2`, meetId });
        await store.relays.upsertEntity({ partitionKey: meetId, rowKey: `${meetId}__5__S__A`, meetId });
    }
    store.sheets.blobs.set("m-1791164034802.pdf", "x");
    store.sheets.blobs.set("m-2-1791164034803.pdf", "x");

    const res = await call(deleteMeet, { query: { id: "m" } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { deletedResults: 2, deletedRelays: 1, deletedSheets: 1 });
    assert.deepEqual(store.meets.all().map(r => r.rowKey), ["m-2"]);
    assert.ok(store.results.all().every(r => r.meetId === "m-2"));
    assert.ok(store.relays.all().every(r => r.meetId === "m-2"));
    assert.deepEqual([...store.sheets.blobs.keys()], ["m-2-1791164034803.pdf"]);
    // Deleting again is harmless.
    assert.equal((await call(deleteMeet, { query: { id: "m" } })).status, 200);
});

test("the home pool is saved and read back; a name is required", async () => {
    resetStore();
    assert.deepEqual((await call(getSettings)).body, { homePool: null });
    assert.equal((await call(saveSettings, { body: { homePool: { name: " ", address: "1 Main St" } } })).status, 400);
    const saved = await call(saveSettings, { body: { homePool: { name: "Home Pool", address: "1 Main St", lat: 38, lon: -77 } } });
    assert.equal(saved.status, 200);
    assert.deepEqual((await call(getSettings)).body, { homePool: { name: "Home Pool", address: "1 Main St", lat: 38, lon: -77 } });
    // Coordinates without an address are meaningless, so they're not kept.
    await call(saveSettings, { body: { homePool: { name: "Home Pool", address: "", lat: 38, lon: -77 } } });
    assert.deepEqual((await call(getSettings)).body.homePool, { name: "Home Pool", address: "", lat: null, lon: null });
});

test("filling from the home pool only touches home meets with blanks", async () => {
    resetStore();
    assert.equal((await call(fillHomePool)).status, 400, "no pool saved yet");
    await call(saveSettings, { body: { homePool: { name: "Home Pool", address: "1 Main St" } } });
    await store.meets.upsertEntity({ partitionKey: "meet", rowKey: "home-blank", homeAway: "home", shortName: "A", opponent: "A", date: "2026-06-17" });
    await store.meets.upsertEntity({ partitionKey: "meet", rowKey: "home-set", homeAway: "home", shortName: "B", opponent: "B", date: "2026-06-24", placeName: "Other Pool", address: "2 Side St" });
    await store.meets.upsertEntity({ partitionKey: "meet", rowKey: "away-blank", homeAway: "away", shortName: "C", opponent: "C", date: "2026-07-01" });
    // An older meet with no homeAway field counts as home when its title says "vs."
    await store.meets.upsertEntity({ partitionKey: "meet", rowKey: "older", title: "vs. D Team", opponent: "D Team", date: "2026-07-08" });

    const res = await call(fillHomePool);
    assert.deepEqual(res.body, { updated: 2 });
    assert.equal((await store.meets.getEntity("meet", "home-blank")).placeName, "Home Pool");
    assert.equal((await store.meets.getEntity("meet", "older")).address, "1 Main St");
    assert.equal((await store.meets.getEntity("meet", "home-set")).placeName, "Other Pool");
    assert.equal((await store.meets.getEntity("meet", "away-blank")).placeName, undefined);
});

async function addMeet(rowKey, extra = {}) {
    await store.meets.upsertEntity({ partitionKey: "meet", rowKey, opponent: "Test Seahawks", shortName: "Test", homeAway: "away", date: "2026-07-13", ...extra });
}

test("the import preview reports the sheet's date, Spotswood's counts, and the score it would save", async () => {
    resetStore();
    const res = await call(previewResults, { body: { dataBase64: asUpload(sheetText()) } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { sheetDate: "2026-07-13", swims: 5, relays: 2, swimmers: 5, teamScore: { us: 525, them: 511, source: "sheet" }, unreadLines: [] });
    assert.equal((await call(previewResults, { body: {} })).status, 400);
    assert.equal(store.results.all().length, 0, "a preview saves nothing");
});

test("an import refuses a sheet dated for another day unless told to import anyway", async () => {
    resetStore();
    await addMeet("m");
    const wrongDay = asUpload(sheetText({ date: "Jul 8, 2026" }));
    const refused = await call(commitResults, { body: { meetId: "m", dataBase64: wrongDay, fileName: "x.pdf" } });
    assert.equal(refused.status, 409);
    assert.match(refused.body, /Jul 8, 2026.*Jul 13, 2026/);
    assert.equal(store.results.all().length, 0);
    assert.equal(store.sheets.blobs.size, 0);
    assert.equal((await store.meets.getEntity("meet", "m")).resultsImported, undefined);

    const anyway = await call(commitResults, { body: { meetId: "m", dataBase64: wrongDay, fileName: "x.pdf", importAnyway: true } });
    assert.equal(anyway.status, 200);
});

test("an import saves both teams' rows, archives the sheet, and marks the meet", async () => {
    resetStore();
    await addMeet("m");
    const res = await call(commitResults, { body: { meetId: "m", dataBase64: asUpload(sheetText()), fileName: "results.pdf" } });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.replaced, res.body.swims, res.body.relays, res.body.swimmers], [false, 5, 2, 5]);
    assert.deepEqual(res.body.teamScore, { us: 525, them: 511, source: "sheet" });
    assert.equal(store.results.all().length, 8, "both teams' swims");
    assert.equal(store.relays.all().length, 3);
    assert.equal(store.results.all().find(r => r.partitionKey === "Moe, Max").dqReason, "3J Touch: One hand; 7T Other - Misc");
    assert.equal(store.relays.all().find(r => r.relayLetter === "C").dqReason, "6F Early take-off swimmer #2");
    assert.equal(store.sheets.blobs.size, 1);
    const meet = await store.meets.getEntity("meet", "m");
    assert.deepEqual([meet.resultsImported, meet.lastImportFile, meet.teamScore, meet.opponentScore, meet.scoreSource], [true, "results.pdf", 525, 511, "import"]);
    assert.match(meet.lastImportAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("re-importing replaces the meet's results and leaves no leftovers", async () => {
    resetStore();
    await addMeet("m");
    await call(commitResults, { body: { meetId: "m", dataBase64: asUpload(sheetText()), fileName: "first.pdf" } });
    // Another meet's rows must survive.
    await store.results.upsertEntity({ partitionKey: "Doe, Jane", rowKey: "other__1", meetId: "other" });

    const fewerSwims = asUpload(sheetText({ individual: INDIVIDUAL.slice(0, 1) }));
    const res = await call(commitResults, { body: { meetId: "m", dataBase64: fewerSwims, fileName: "second.pdf" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.replaced, true);
    assert.equal(res.body.removedRows, 7);
    assert.deepEqual(store.results.all().map(r => `${r.partitionKey} ${r.meetId}`).sort(), ["Doe, Jane m", "Doe, Jane other"]);
    assert.equal(store.relays.all().length, 3);
    assert.equal((await store.meets.getEntity("meet", "m")).lastImportFile, "second.pdf");
});

test("an import keeps a typed-in score and replaces an imported one", async () => {
    resetStore();
    await addMeet("typed", { teamScore: 500, opponentScore: 400, scoreSource: "manual" });
    await addMeet("auto", { teamScore: 1, opponentScore: 1, scoreSource: "import" });
    const noScoresPage = asUpload(sheetText({ teamScores: false }));

    const typedRes = await call(commitResults, { body: { meetId: "typed", dataBase64: noScoresPage, fileName: "a.pdf" } });
    assert.deepEqual(typedRes.body.teamScore, { us: 500, them: 400, source: "manual" });
    const typed = await store.meets.getEntity("meet", "typed");
    assert.deepEqual([typed.teamScore, typed.opponentScore, typed.scoreSource, typed.resultsImported], [500, 400, "manual", true]);

    await call(commitResults, { body: { meetId: "auto", dataBase64: noScoresPage, fileName: "b.pdf" } });
    const auto = await store.meets.getEntity("meet", "auto");
    // No Team Scores page, so the points are added up.
    assert.deepEqual([auto.teamScore, auto.opponentScore, auto.scoreSource], [17.5, 4.5, "import"]);
});

test("import errors: a missing meet, a missing upload, a sheet with no results", async () => {
    resetStore();
    assert.equal((await call(commitResults, { body: { meetId: "gone", dataBase64: asUpload(sheetText()) } })).status, 404);
    await addMeet("m");
    assert.equal((await call(commitResults, { body: { meetId: "m" } })).status, 400);
    const empty = await call(commitResults, { body: { meetId: "m", dataBase64: asUpload("#1 Girls 25m Freestyle") } });
    assert.deepEqual([empty.status, empty.body], [400, "No results were found in that PDF."]);
});

test("the public meet list leaves out the import details", async () => {
    resetStore();
    await store.meets.upsertEntity({ partitionKey: "meet", rowKey: "m", opponent: "A", shortName: "A", homeAway: "home", date: "2026-07-08",
        teamScore: 1, opponentScore: 2, scoreSource: "manual", resultsImported: true, lastImportFile: "x.pdf", lastImportAt: "t" });
    const [meet] = (await call(publicMeets)).body;
    assert.equal(meet.title, "vs. A");
    assert.equal(meet.resultsImported, true);
    for (const key of ["scoreSource", "lastImportFile", "lastImportAt"]) assert.equal(key in meet, false, key);
});
