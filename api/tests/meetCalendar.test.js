// Run from api/: npm test
// /api/meetCalendar and the calendar file it serves, against an in-memory Meets table.
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeTable, call } = require("./fakes");

const meets = new FakeTable();
// The Function destructures this getter when it loads, so swap it in first.
Object.assign(require("../shared/meetsTable"), { getMeetsTable: () => meets });
const meetCalendar = require("../meetCalendar/index.js");
const { PARTITION_KEY } = require("../shared/meetsTable");
const { calendarFile } = require("../shared/meetCalendar");

meets.upsertEntity({ partitionKey: PARTITION_KEY, rowKey: "m1", opponent: "Test Seahawks", shortName: "Test", homeAway: "away", date: "2026-07-22", warmUp: "17:00", time: "18:00", placeName: "Test Pool", address: "1 Main St, Testville, VA" });

test("a meet is served as a calendar to open, running from warm-up for three hours", async () => {
    const res = await call(meetCalendar, { query: { id: "m1" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers["Content-Type"], "text/calendar; charset=utf-8");
    assert.match(res.headers["Content-Disposition"], /^inline; filename="sea-serpents-m1\.ics"$/);
    const ics = res.body;
    assert.match(ics, /\r\nDTSTART;TZID=America\/New_York:20260722T170000\r\n/);
    assert.match(ics, /\r\nDTEND;TZID=America\/New_York:20260722T200000\r\n/);
    assert.match(ics, /\r\nSUMMARY:Spotswood at Test\r\n/);
    assert.match(ics, /\r\nLOCATION:Test Pool\\, 1 Main St\\, Testville\\, VA\r\n/);
    assert.match(ics, /\r\nDESCRIPTION:Warm-up at 5:00pm. Meet starts at 6:00pm.\r\n/);
    assert.ok(ics.includes("BEGIN:VTIMEZONE"));
});

test("an unknown or missing id isn't a calendar", async () => {
    assert.equal((await call(meetCalendar, { query: { id: "nope" } })).status, 404);
    assert.equal((await call(meetCalendar, { query: {} })).status, 400);
});

test("without a warm-up it starts at the meet's start; with no times it's all day", () => {
    const base = { id: "m2", title: "vs. Test", date: "2026-12-31", warmUp: "", time: "", placeName: "", address: "" };
    const startOnly = calendarFile({ ...base, time: "18:30" });
    assert.match(startOnly, /DTSTART;TZID=America\/New_York:20261231T183000/);
    assert.match(startOnly, /DTEND;TZID=America\/New_York:20261231T213000/);
    const allDay = calendarFile(base);
    assert.match(allDay, /DTSTART;VALUE=DATE:20261231\r\n/);
    assert.match(allDay, /DTEND;VALUE=DATE:20270101\r\n/);
    assert.ok(!allDay.includes("VTIMEZONE") && !allDay.includes("LOCATION") && !allDay.includes("DESCRIPTION"));
});

test("long lines fold at 75 bytes", () => {
    const ics = calendarFile({ id: "m3", title: "vs. Test", date: "2026-07-01", warmUp: "", time: "18:00", placeName: "A very long pool name that keeps going and going", address: "12345 Long Road Name, Somewhere, VA 22000" });
    for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
    assert.ok(ics.includes("\r\n "));
});
