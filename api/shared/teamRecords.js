// Team records: the fastest Spotswood time in each event, by gender and age
// group, read from the saved SwimTopia "Team Records" page and kept in the
// TeamRecords table. Only the event, time, year, and whether the time was
// converted from another pool length are kept -- never the holders' names.
//
// An import compares Spotswood's legal swims and relays with these (only
// strictly faster counts) and marks the ones that set a new team record.
const { TableClient } = require("@azure/data-tables");
const { timeToSeconds } = require("./meetResultsParser");

const PARTITION_KEY = "record";

function getRecordsTable() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    return TableClient.fromConnectionString(connectionString, "TeamRecords");
}

const STROKES = { Freestyle: "Free", Backstroke: "Back", Breaststroke: "Breast", Butterfly: "Fly", IM: "IM", "Freestyle Relay": "Free Relay", "Medley Relay": "Medley Relay" };

// "9–10", "8 & Under" -> "9-10", "8 & under", so the page and the sheets agree.
function normalizeAgeGroup(text) {
    return String(text).replace(/[‒-―]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
}

// One record's key: course ("m" or "yd"), gender, age group, distance, stroke.
function recordKey({ course, gender, ageGroup, distance, stroke }) {
    return [course, gender, normalizeAgeGroup(ageGroup), distance, stroke].join("|");
}

// "Girls 9-10 25m Freestyle" -> its record's key, or null for an event with no
// record (a mixed relay, or one this doesn't recognise).
const EVENT_RE = /^(Girls|Boys|Women|Men)\s+(.+?)\s+(\d+)(m|yd)\s+(Freestyle Relay|Medley Relay|Freestyle|Backstroke|Breaststroke|Butterfly|IM)$/i;
function keyForEvent(eventName) {
    const m = String(eventName || "").trim().match(EVENT_RE);
    if (!m) return null;
    const [, who, ageGroup, distance, course, strokeName] = m;
    const stroke = Object.entries(STROKES).find(([name]) => name.toLowerCase() === strokeName.toLowerCase())[1];
    const gender = /^(girls|women)$/i.test(who) ? "girls" : "boys";
    return recordKey({ course: course.toLowerCase(), gender, ageGroup, distance: Number(distance), stroke });
}

// "m|girls|9-10|25|Free" -> "9–10 girls · 25 Free", for people.
function describeKey(key) {
    const [, gender, ageGroup, distance, stroke] = key.split("|");
    const group = ageGroup.replace(/-/g, "–").replace(/ & under/, " & Under");
    return `${group} ${gender} · ${distance} ${stroke}`;
}

// Youngest age group first, then by stroke and distance, girls before boys.
const STROKE_ORDER = Object.values(STROKES);
function compareKeys(a, b) {
    const parse = key => {
        const [, gender, ageGroup, distance, stroke] = key.split("|");
        const ages = (ageGroup.match(/\d+/g) || []).map(Number);
        const upper = ages.length ? ages[ages.length - 1] : 99;
        const lower = ages.length > 1 ? ages[0] : 0;
        return [upper, lower, STROKE_ORDER.indexOf(stroke), Number(distance), gender === "girls" ? 0 : 1];
    };
    const x = parse(a), y = parse(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
}

/* ---------- Reading the saved SwimTopia page ---------- */
const ENTITIES = { amp: "&", nbsp: " ", quot: '"', apos: "'", ndash: "\u2013", mdash: "\u2014", lt: "<", gt: ">" };
const decode = text => String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all)
    .replace(/\s+/g, " ").trim();

// The page lists one pool length ("Short Course Meters (25m)"), then an
// age-group table per group: a header (Girls · 6 & Under · Boys) and a row
// per event with the girls' record, the event, and the boys' record. Each
// record has a year, holder names (not kept), and a time, marked "*" when
// it was converted from another pool length.
function parseRecordsPage(html) {
    const text = String(html || "");
    const courseMatch = text.match(/(Short|Long) Course (Meters|Yards)/);
    if (!courseMatch) return { records: [], problem: "This doesn't look like a SwimTopia Team Records page." };
    const course = courseMatch[2] === "Meters" ? "m" : "yd";
    const records = [];
    const tables = text.split(/class="[^"]*record-snippet__age-range-table/).slice(1);
    for (const table of tables) {
        const titleMatch = table.match(/class="[^"]*age-range-title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        if (!titleMatch) continue;
        const ageGroup = decode(titleMatch[1]);
        for (const row of table.split(/class="[^"]*record-snippet__event-row/).slice(1)) {
            const eventMatch = row.match(/class="[^"]*event-row__event-detail[^"]*"[^>]*>([\s\S]*?)<\/div>/);
            if (!eventMatch) continue;
            const event = decode(eventMatch[1]); // "25 Free", "100 Medley Relay"
            const em = event.match(/^(\d+)\s+(.+)$/);
            if (!em) continue;
            const details = row.split(/class="[^"]*event-row__record-detail/).slice(1);
            ["girls", "boys"].forEach((gender, i) => {
                const side = details[i];
                if (!side) return;
                const timeMatch = side.match(/class="[^"]*record-row__time[^"]*"[^>]*>([\s\S]*?)<\/div>/);
                const yearMatch = side.match(/class="[^"]*record-row__year[^"]*"[^>]*>([\s\S]*?)<\/div>/);
                const timeText = timeMatch ? decode(timeMatch[1]) : "";
                const time = (timeText.match(/\d{1,2}:\d{2}\.\d{2}|\d{1,3}\.\d{2}/) || [])[0];
                if (!time) return;
                const year = yearMatch ? Number((decode(yearMatch[1]).match(/\d{4}/) || [])[0]) || null : null;
                records.push({
                    key: recordKey({ course, gender, ageGroup, distance: Number(em[1]), stroke: em[2] }),
                    time,
                    seconds: timeToSeconds(time),
                    year,
                    converted: timeText.includes("*")
                });
            });
        }
    }
    return records.length ? { course, records } : { records: [], problem: "No records were found on that page." };
}

/* ---------- Stored records ---------- */
function toRecordEntity(record) {
    return {
        partitionKey: PARTITION_KEY,
        rowKey: encodeURIComponent(record.key),
        key: record.key,
        time: record.time,
        seconds: record.seconds,
        year: record.year,
        converted: !!record.converted,
        // Set by an import here: the meet, and the record it replaced, so a
        // re-import of that meet still compares against the old one.
        setAtMeet: record.setAtMeet || "",
        previousJson: record.previous ? JSON.stringify(record.previous) : ""
    };
}

function toRecordDto(entity) {
    let previous = null;
    try { previous = entity.previousJson ? JSON.parse(entity.previousJson) : null; } catch (e) { previous = null; }
    return {
        key: entity.key,
        time: entity.time,
        seconds: entity.seconds,
        year: entity.year != null ? entity.year : null,
        converted: !!entity.converted,
        setAtMeet: entity.setAtMeet || "",
        previous
    };
}

// Every stored record by key; empty before any are loaded.
async function listRecords(table) {
    const records = new Map();
    try {
        for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } })) {
            const dto = toRecordDto(entity);
            records.set(dto.key, dto);
        }
    } catch (e) {
        if (e.statusCode !== 404) throw e; // no table yet: no records
    }
    return records;
}

/* ---------- New records at a meet ---------- */
// What each record was before this meet: a record this meet set (on an
// earlier import of it) counts as the one it replaced. One matched to this
// meet's swim afterwards (manageRecordsMatch), with no record before it
// known, is marked `matched`: that swim's own time still sets it.
function recordBefore(record, meetId) {
    if (!record) return null;
    if (record.setAtMeet !== meetId) return record;
    return record.previous || { ...record, matched: true };
}
const sameTime = (a, b) => Math.abs(a - b) < 0.005;

// The swims and relays at a meet that set a new team record: Spotswood,
// legal and timed, strictly faster than the record coming in; when two beat
// the same record, the faster one sets it. Returns
// [{ key, kind: "swim" | "relay", row, old: { time, seconds, year } }].
function newRecordsAtMeet({ individual, relays }, records, meetId, isOurs) {
    const best = new Map();
    const consider = (row, kind) => {
        if (row.status !== "OK" || row.officialSeconds == null || !isOurs(row.team)) return;
        const key = keyForEvent(row.eventName);
        const old = key && recordBefore(records.get(key), meetId);
        if (!old || !(row.officialSeconds < old.seconds || (old.matched && sameTime(row.officialSeconds, old.seconds)))) return;
        const current = best.get(key);
        if (!current || row.officialSeconds < current.row.officialSeconds) {
            best.set(key, { key, kind, row, old: old.matched ? null : { time: old.time, seconds: old.seconds, year: old.year } });
        }
    };
    individual.forEach(row => consider(row, "swim"));
    relays.forEach(row => consider(row, "relay"));
    return [...best.values()].sort((a, b) => a.row.eventNumber - b.row.eventNumber);
}

// A new record as the meet's numbers keep it, for its card and popup.
function recordSummary(found) {
    const { key, kind, row, old } = found;
    return {
        key,
        label: describeKey(key),
        eventName: row.eventName,
        kind,
        name: kind === "swim" ? row.name : null,
        team: kind === "relay" ? `${row.team} (${row.relayLetter})` : null,
        swimmers: kind === "relay" ? (row.swimmers || []).map(s => s.name) : null,
        time: row.officialTime,
        seconds: row.officialSeconds,
        old
    };
}

// Saves the records a meet set (each remembering the one it replaced), and
// puts back the record the meet set on an earlier import of it but no
// longer does (a corrected sheet).
async function saveMeetRecords(table, records, found, meetId, meetDate) {
    const year = Number(String(meetDate || "").slice(0, 4)) || null;
    const setNow = new Set(found.map(f => f.key));
    await table.createTable();
    for (const f of found) {
        const before = recordBefore(records.get(f.key), meetId);
        await table.upsertEntity(toRecordEntity({
            key: f.key, time: f.row.officialTime, seconds: f.row.officialSeconds, year, converted: false,
            setAtMeet: meetId,
            previous: before.matched ? null : { time: before.time, seconds: before.seconds, year: before.year, converted: !!before.converted }
        }), "Replace");
    }
    for (const record of records.values()) {
        if (record.setAtMeet === meetId && !setNow.has(record.key)) await restoreRecord(table, record);
    }
}

// A record a deleted meet set goes back to the one it replaced.
async function restoreRecordsSetAt(table, meetId) {
    for (const record of (await listRecords(table)).values()) {
        if (record.setAtMeet === meetId) await restoreRecord(table, record);
    }
}

// One with no record before it known stays, just no longer tied to the meet.
async function restoreRecord(table, record) {
    if (!record.previous) {
        await table.upsertEntity(toRecordEntity({ ...record, setAtMeet: "", previous: null }), "Replace");
        return;
    }
    const p = record.previous;
    await table.upsertEntity(toRecordEntity({ key: record.key, time: p.time, seconds: p.seconds, year: p.year, converted: p.converted }), "Replace");
}

module.exports = {
    getRecordsTable, PARTITION_KEY, recordKey, keyForEvent, describeKey, compareKeys, normalizeAgeGroup,
    parseRecordsPage, toRecordEntity, toRecordDto, listRecords, newRecordsAtMeet, recordBefore,
    recordSummary, saveMeetRecords, restoreRecordsSetAt, sameTime
};
