// Parses the plain-text export of a SwimTopia Meet Maestro results PDF --
// after running it through shared/pdfText.js's extractPdfText(), NOT raw
// pdf-parse -- into individual and relay rows, keeping only one team's.
//
// Verified line-by-line against a real "<Team> at <Opponent>" dual-meet PDF.
// Getting clean text out of it took two fixes over the obvious approach:
//   1. `pdftotext -layout` (poppler) misaligns columns and drops the
//      1st-place name in several events -- `pdftotext -raw` (content-stream
//      order) does not.
//   2. pdf-parse's default renderer mimics that reading order but joins
//      same-line text runs with NO separator, collapsing e.g. "1 Taormina,
//      Soleil 12 Spotswood" into "1Taormina, Soleil12Spotswood". pdfText.js
//      reinserts a space wherever there's a real horizontal gap between
//      runs, matching what -raw does. That's the extraction this module
//      expects; it was cross-checked against both by running each through
//      this parser and comparing row counts.
//
// Line shapes this handles (one event block per "#<N> <name>" header):
//   Individual : "<place[*]|--> <Last[, Jr/Sr/II/III/IV], First> <age> <team words> <seed|NT> <official|DQ|NS> [points]"
//   DQ reason  : "DQ: <code> <reason text>"                (attaches to the row just above)
//   Relay      : "<place[*]|X|--> <team words> [EXH] <letter A-D> <abbrev> <seed|NT> <official|DQ|NS> [points]"
//                 followed by "1) Last, First (age) 2) ... 3) ... 4) ..."
// A trailing "*" on a place marks a tie, which is also why points can be a
// decimal ("3.5") -- tied swimmers split the points for their places.
// Page headers/footers can fall in the middle of an event across a page
// break and are discarded before line-matching.

const EVENT_HEADER_RE = /^#(\d+)\s+(.+)$/;
// The event header line repeats a short "<gender> <age group>" tag after the
// real title (e.g. "Boys 9-10 25m Breaststroke Boys 9-10", "...100m
// Freestyle Relay Girls Graduated") -- and that tag's wording doesn't
// reliably match the title's own gender/age text (Men vs Boys, Under vs
// under, Graduated vs a numeric range), so comparing head against tail to
// detect the duplicate isn't reliable. Every title does end in exactly one
// recognizable stroke name, though, so truncating right after that is a
// robust way to drop the tag regardless of how it's worded.
const STROKE_RE = /\b(?:Freestyle Relay|Medley Relay|Freestyle|Backstroke|Breaststroke|Butterfly|IM)\b/;

function cleanEventName(name) {
    const match = name.match(STROKE_RE);
    if (!match) return name.trim();
    return name.slice(0, match.index + match[0].length).trim();
}
const COLUMN_HEADER_RE = /^Pl\s+(Name|Team)\b/;
const PAGE_HEADER_RE = /^Results\s+.+Page\s+\d+\s+of\s+\d+$/;
const FOOTER_RE = /^SwimTopia Meet Maestro/i;
const DQ_REASON_RE = /^DQ:\s*(.*)$/;

// A name is normally "Last, First", but a generational suffix can add a
// second comma ("Colby, Jr., Stuart") -- the optional non-capturing group
// absorbs that middle segment so it doesn't get mistaken for the team name.
const NAME_RE = "[A-Za-z][A-Za-z .'-]*(?:,\\s*(?:Jr\\.?|Sr\\.?|II|III|IV))?,\\s*[A-Za-z][A-Za-z .'-]*?";
const TIME_RE = "NT|\\d{1,3}:\\d{2}\\.\\d{2}|\\d{1,3}\\.\\d{2}";
// A tied place is printed as e.g. "2*", with the points for that place
// split between the tied swimmers (so points can be a decimal like "3.5").
const PLACE_RE = "\\d+\\*?";
const POINTS_RE = "\\d+(?:\\.\\d+)?";

const INDIVIDUAL_ROW_RE = new RegExp(
    `^(${PLACE_RE}|--)\\s+(${NAME_RE})\\s+(\\d{1,2})\\s+(.+?)\\s+(${TIME_RE})\\s+(${TIME_RE}|DQ|NS)(?:\\s+(${POINTS_RE}))?$`
);
const RELAY_ROW_RE = new RegExp(
    `^(${PLACE_RE}|X|--)\\s+(.+?)\\s+(?:EXH\\s+)?([A-Z])\\s+([A-Z]{1,4})\\s+(${TIME_RE})\\s+(${TIME_RE}|DQ|NS)(?:\\s+(${POINTS_RE}))?$`
);
const RELAY_SWIMMER_RE = new RegExp(`\\d\\)\\s*(${NAME_RE})\\s*\\((\\d{1,2})\\)`, "g");

function parsePlace(place) {
    const digits = place.replace("*", "");
    return /^\d+$/.test(digits) ? parseInt(digits, 10) : null;
}

// "1:16.09" -> 76.09, "45.09" -> 45.09, "NT"/"DQ"/"NS" -> null.
function timeToSeconds(time) {
    if (!time || time === "NT" || time === "DQ" || time === "NS") return null;
    const parts = time.split(":");
    if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
    return parseFloat(parts[0]);
}

function parseMeetResultsText(rawText, { teamFilter = "Spotswood" } = {}) {
    const teamNeedle = teamFilter.toLowerCase();
    const lines = rawText.split("\n").map(l => l.replace(/\r$/, "").trim());

    let currentEvent = null;
    let lastDqRow = null;
    let pendingRelay = null;
    const individual = [];
    const relays = [];
    const unparsedLines = [];

    for (const line of lines) {
        if (!line) continue;
        if (PAGE_HEADER_RE.test(line) || FOOTER_RE.test(line)) continue;

        const eventMatch = line.match(EVENT_HEADER_RE);
        if (eventMatch) {
            currentEvent = { number: parseInt(eventMatch[1], 10), name: cleanEventName(eventMatch[2]), isRelay: /relay/i.test(eventMatch[2]) };
            lastDqRow = null;
            pendingRelay = null;
            continue;
        }
        if (COLUMN_HEADER_RE.test(line)) continue;

        const dqMatch = line.match(DQ_REASON_RE);
        if (dqMatch) {
            if (lastDqRow) lastDqRow.dqReason = dqMatch[1].trim() || null;
            lastDqRow = null;
            continue;
        }

        if (!currentEvent) {
            unparsedLines.push(line);
            continue;
        }

        if (currentEvent.isRelay) {
            const m = line.match(RELAY_ROW_RE);
            if (m) {
                const [, place, team, relayLetter, teamAbbrev, seed, official, points] = m;
                const row = {
                    eventNumber: currentEvent.number,
                    eventName: currentEvent.name,
                    place: place === "X" ? null : parsePlace(place),
                    status: place === "X" ? "EXH" : (official === "DQ" ? "DQ" : (official === "NS" ? "NS" : "OK")),
                    team: team.trim(),
                    relayLetter,
                    teamAbbrev,
                    seedTime: seed,
                    officialTime: official,
                    seedSeconds: timeToSeconds(seed),
                    officialSeconds: timeToSeconds(official),
                    points: points ? parseFloat(points) : 0,
                    swimmers: []
                };
                pendingRelay = row;
                if (team.toLowerCase().includes(teamNeedle)) relays.push(row);
                continue;
            }

            const swimmerMatches = [...line.matchAll(RELAY_SWIMMER_RE)];
            if (swimmerMatches.length) {
                if (pendingRelay) pendingRelay.swimmers = swimmerMatches.map(sm => ({ name: sm[1].trim(), age: parseInt(sm[2], 10) }));
                pendingRelay = null;
                continue;
            }

            unparsedLines.push(line);
            continue;
        }

        const m = line.match(INDIVIDUAL_ROW_RE);
        if (m) {
            const [, place, name, age, team, seed, official, points] = m;
            const row = {
                eventNumber: currentEvent.number,
                eventName: currentEvent.name,
                place: parsePlace(place),
                status: official === "DQ" ? "DQ" : (official === "NS" ? "NS" : "OK"),
                name: name.trim(),
                age: parseInt(age, 10),
                team: team.trim(),
                seedTime: seed,
                officialTime: official,
                seedSeconds: timeToSeconds(seed),
                officialSeconds: timeToSeconds(official),
                points: points ? parseFloat(points) : 0,
                dqReason: null
            };
            lastDqRow = row.status === "DQ" ? row : null;
            if (team.toLowerCase().includes(teamNeedle)) individual.push(row);
            continue;
        }

        unparsedLines.push(line);
    }

    return { individual, relays, unparsedLines };
}

module.exports = { parseMeetResultsText, timeToSeconds };
