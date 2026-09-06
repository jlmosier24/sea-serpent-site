// Builds local-only fixture JSON under ../sample-data/ so the real pages
// (unmodified) can be previewed against real season data before Azure
// exists. .devserver.ps1 serves these for the matching /api/* routes.
//
// Deliberately gitignored (see ../../.gitignore) -- this embeds real
// swimmers' names, ages, and times, and shouldn't end up in source control
// or get pushed anywhere, even though it never leaves this machine.
//
// Reuses the exact same shared/*Table.js entity<->DTO mapping the real
// Functions use, so the JSON shape here is identical to what the live API
// will eventually return -- this is a fixture of the data, not a
// reimplementation of the response format.
const fs = require("fs");
const path = require("path");
const { extractPdfText } = require("../shared/pdfText");
const { parseMeetResultsText } = require("../shared/meetResultsParser");
const { slugify, toMeetDto, PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");
const { toResultEntity, toResultDto, toRelayResultEntity, toRelayResultDto } = require("../shared/resultsTable");

const OUT_DIR = path.join(__dirname, "..", "..", "sample-data");

// Meet metadata isn't in the results PDFs (no address/time) -- only what's
// actually known goes here; schedule.html already handles a missing
// address/time gracefully (skips the weather lookup, just omits the line).
// `file` is optional -- a meet with no results PDF yet (scheduled but not
// yet swum) still gets a meets.json entry, just with no results/<id>.json,
// which resultsByMeet's mock already treats as "nothing imported yet".
// No lat/lon here even where an address is known: the real admin flow
// resolves those from Azure Maps' autocomplete at entry time (geocodeAddress),
// and guessing coordinates via some other lookup could disagree with what
// that would actually resolve to.
const MEETS = [
    { file: "2026 Spotswood at ChanBlueDolphins 06_10_2026 _ Meet Maestro™.pdf", date: "2026-06-10", opponent: "ChanBlueDolphins", title: "at ChanBlueDolphins" },
    { file: "2026 Woodland Wahoos at Spotswood 06_17_2026 _ Meet Maestro™.pdf", date: "2026-06-17", opponent: "Woodland Wahoos", title: "vs. Woodland Wahoos" },
    { file: "2026 Fox Point at Spotswood 06_24_2026 _ Meet Maestro™.pdf", date: "2026-06-24", opponent: "Fox Point", title: "vs. Fox Point" },
    { file: "2026 Spotswood at Fawn Lake Fliers 07_01_2026 _ Meet Maestro™.pdf", date: "2026-07-01", opponent: "Fawn Lake Fliers", title: "at Fawn Lake Fliers" },
    { date: "2026-07-08", opponent: "Massad Marlins", title: "vs. Massad Marlins", time: "18:00", address: "413 Lorraine Ave, Fredericksburg, VA 22408" },
    { date: "2026-07-13", opponent: "Curtis Park Seahawks", title: "at Curtis Park Seahawks", time: "18:00", address: "58 Jesse Curtis Ln, Fredericksburg, VA 22406" }
];

const DOWNLOADS = "C:/Users/jlmos/Downloads";

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJson(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

async function main() {
    ensureDir(OUT_DIR);

    const meetDtos = [];
    const allResultDtos = []; // enriched with meetDate/meetTitle, like swimmerStats returns
    let totalUnparsed = 0;

    for (const m of MEETS) {
        const meetId = slugify(`${m.date}-${m.opponent}`);
        const meetEntity = { partitionKey: MEET_PARTITION_KEY, rowKey: meetId, title: m.title, opponent: m.opponent, date: m.date, time: m.time || "", address: m.address || "", placeName: m.placeName || "", hidden: false };
        const meetDto = toMeetDto(meetEntity);
        meetDtos.push(meetDto);

        if (!m.file) {
            console.log(`${m.date} ${m.opponent}: no results PDF yet -- schedule-only entry`);
            continue;
        }

        const buffer = fs.readFileSync(path.join(DOWNLOADS, m.file));
        const text = await extractPdfText(buffer);
        const parsed = parseMeetResultsText(text);
        totalUnparsed += parsed.unparsedLines.length;
        console.log(`${m.date} ${m.opponent}: ${parsed.individual.length} individual, ${parsed.relays.length} relay, ${parsed.unparsedLines.length} unparsed`);

        const individualDtos = parsed.individual.map(row => toResultDto(toResultEntity(row, meetId)));
        const relayDtos = parsed.relays.map(row => toRelayResultDto(toRelayResultEntity(row, meetId)));

        writeJson(path.join(OUT_DIR, "meet", `${meetId}.json`), { individual: individualDtos, relays: relayDtos });

        for (const dto of individualDtos) {
            allResultDtos.push({ ...dto, meetDate: meetDto.date, meetTitle: meetDto.title });
        }
    }

    writeJson(path.join(OUT_DIR, "meets.json"), meetDtos.sort((a, b) => a.date.localeCompare(b.date)));
    writeJson(path.join(OUT_DIR, "gallery-public.json"), []);

    const swimmerNames = [...new Set(allResultDtos.map(r => r.name))].sort((a, b) => a.localeCompare(b));
    writeJson(path.join(OUT_DIR, "swimmer-names.json"), { swimmers: swimmerNames });

    for (const name of swimmerNames) {
        const rows = allResultDtos
            .filter(r => r.name === name)
            .sort((a, b) => a.meetDate.localeCompare(b.meetDate) || a.eventNumber - b.eventNumber);
        writeJson(path.join(OUT_DIR, "swimmer", `${slugify(name)}.json`), rows);
    }

    console.log(`\n${meetDtos.length} meets, ${swimmerNames.length} swimmers, ${allResultDtos.length} individual results total, ${totalUnparsed} unparsed lines across all meets.`);
    console.log(`Written to ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
