// Parses the plain-text export of a SwimTopia Meet Maestro results PDF --
// after running it through shared/pdfText.js's extractPdfText(), NOT raw
// pdf-parse -- into individual and relay rows for every team in the PDF.
// Each row carries a `team` field; callers that only want Spotswood's rows
// (e.g. swimmer-stats storage) filter for it themselves -- see
// resultsTable.js's listSwimmerNames() and swimmerStats/index.js.
//
// Verified line-by-line against a real "<Team> at <Opponent>" dual-meet PDF.
// Getting clean text out of it took two fixes over the obvious approach:
//   1. `pdftotext -layout` (poppler) misaligns columns and drops the
//      1st-place name in several events -- `pdftotext -raw` (content-stream
//      order) does not.
//   2. pdf-parse's default renderer mimics that reading order but joins
//      same-line text runs with NO separator, collapsing e.g. "1 Doe, Jane
//      12 Spotswood" into "1Doe, Jane12Spotswood". pdfText.js
//      reinserts a space wherever there's a real horizontal gap between
//      runs, matching what -raw does. That's the extraction this module
//      expects; it was cross-checked against both by running each through
//      this parser and comparing row counts.
//
// Line shapes this handles (one event block per "#<N> <name>" header):
//   Individual : "<place[*]|X|--> <Last[, Jr/Sr/II/III/IV], First> [EXH] <age> <team words> <seed|NT> <official|DQ|NS|DNF> [points]"
//   Relay      : "<place[*]|X|--> <team words> [EXH] <letter A-D> <abbrev> <seed|NT> <official|DQ|NS|DNF> [points]"
//                 followed by "1) Last, First (age) 2) ... 3) ... 4) ..."
//   DQ reason  : "DQ: <code> <reason text>", attached to the DQ'd row above
//                it (for a relay, after its swimmers line); a further
//                infraction continues on its own line ("7T Other - Misc").
//   Page header: "Results <meet name> — Jul 13, 2026 Page 1 of 23" -- the
//                sheet's date, which the importer checks against the meet.
//   Team Scores: an optional last page ("1 Spotswood S 525") with the
//                sheet's own team totals.
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
const SHEET_DATE_RE = /\b([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),\s+(\d{4})\s+Page\s+\d+\s+of\s+\d+$/;
const FOOTER_RE = /^SwimTopia Meet Maestro/i;
const DQ_REASON_RE = /^DQ:\s*(.*)$/;
const DQ_CONTINUATION_RE = /^\d{1,2}[A-Z]\s+\S/;
const TEAM_SCORES_START_RE = /^Team Scores\b/i;
const TEAM_SCORE_ROW_RE = /^\d+\s+(.+?)\s+[A-Z]{1,4}\s+(\d+(?:\.\d+)?)$/;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// A name is normally "Last, First", but a generational suffix can add a
// second comma ("Doe, Jr., John") -- the optional non-capturing group
// absorbs that middle segment so it doesn't get mistaken for the team name.
// Any letters, not just A-Z -- an accented name like "Zoë" otherwise drops a scoring row.
const NAME_RE = "\\p{L}[\\p{L}\\p{M} .'-]*(?:,\\s*(?:Jr\\.?|Sr\\.?|II|III|IV))?,\\s*\\p{L}[\\p{L}\\p{M} .'-]*?";
const TIME_RE = "NT|\\d{1,3}:\\d{2}\\.\\d{2}|\\d{1,3}\\.\\d{2}";
// A tied place is printed as e.g. "2*", with the points for that place
// split between the tied swimmers (so points can be a decimal like "3.5").
const PLACE_RE = "\\d+\\*?";
const POINTS_RE = "\\d+(?:\\.\\d+)?";

const INDIVIDUAL_ROW_RE = new RegExp(
    `^(${PLACE_RE}|X|--)\\s+(${NAME_RE})\\s+(?:EXH\\s+)?(\\d{1,2})\\s+(.+?)\\s+(${TIME_RE})\\s+(${TIME_RE}|DQ|NS|DNF)(?:\\s+(${POINTS_RE}))?$`,
    "u"
);
const RELAY_ROW_RE = new RegExp(
    `^(${PLACE_RE}|X|--)\\s+(.+?)\\s+(?:EXH\\s+)?([A-Z])\\s+([A-Z]{1,4})\\s+(${TIME_RE})\\s+(${TIME_RE}|DQ|NS|DNF)(?:\\s+(${POINTS_RE}))?$`
);
const RELAY_SWIMMER_RE = new RegExp(`\\d\\)\\s*(${NAME_RE})\\s*\\((\\d{1,2})\\)`, "gu");

function parsePlace(place) {
    const digits = place.replace("*", "");
    return /^\d+$/.test(digits) ? parseInt(digits, 10) : null;
}

// An "X" place is an exhibition swim: timed, but not scored. An exhibition
// swim can still be disqualified ("X Spotswood EXH C S 2:39.02 DQ"), and the
// DQ wins -- otherwise its "DQ:" reason has no row to attach to.
function rowStatus(place, official) {
    if (["DQ", "NS", "DNF"].includes(official)) return official;
    return place === "X" ? "EXH" : "OK";
}

// "1:16.09" -> 76.09, "45.09" -> 45.09, "NT"/"DQ"/"NS"/"DNF" -> null.
function timeToSeconds(time) {
    if (!time || ["NT", "DQ", "NS", "DNF"].includes(time)) return null;
    const parts = time.split(":");
    if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
    return parseFloat(parts[0]);
}

// Swimmers' results are stored under their name, so a typo like
// "Voe., Val" would split one swimmer across two. Stray periods
// before a comma and doubled spaces are tidied away.
function normalizeName(name) {
    return name.replace(/\.+\s*,/g, ",").replace(/\s+/g, " ").trim();
}

// "Jul 13, 2026 Page 1 of 23" -> "2026-07-13", or null.
function sheetDateFrom(line) {
    const match = line.match(SHEET_DATE_RE);
    if (!match) return null;
    const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
    return month ? `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}` : null;
}

// Shared "is this row ours" check -- used wherever a full (both-team) set of
// parsed rows needs to be narrowed to just Spotswood's (swimmer-stats
// storage, the meet score split), so every caller agrees on the same needle.
function isSpotswoodTeam(team) {
    return (team || "").toLowerCase().includes("spotswood");
}

function parseMeetResultsText(rawText) {
    const lines = rawText.split("\n").map(l => l.replace(/\r$/, "").trim());

    let currentEvent = null;
    let lastDqRow = null;     // the latest row, while it's a DQ waiting for its reason
    let dqReasonRow = null;   // the row whose reason a continuation line extends
    let pendingRelay = null;
    let inTeamScores = false;
    let sheetDate = null;
    let sheetTeamScores = null;
    const individual = [];
    const relays = [];
    const unparsedLines = [];
    // Every team's point total -- this is how a meet's final score
    // ("Spotswood 540, Fawn Lake Fliers 356") gets computed when the sheet
    // has no Team Scores page of its own.
    const teamPoints = {};
    function addPoints(team, points) {
        teamPoints[team] = (teamPoints[team] || 0) + points;
    }
    function startRow(row) {
        lastDqRow = row.status === "DQ" ? row : null;
        dqReasonRow = null;
        addPoints(row.team, row.points);
    }

    for (const line of lines) {
        if (!line) continue;
        if (PAGE_HEADER_RE.test(line)) {
            if (!sheetDate) sheetDate = sheetDateFrom(line);
            continue;
        }
        if (FOOTER_RE.test(line)) continue;

        const eventMatch = line.match(EVENT_HEADER_RE);
        if (eventMatch) {
            currentEvent = { number: parseInt(eventMatch[1], 10), name: cleanEventName(eventMatch[2]), isRelay: /relay/i.test(eventMatch[2]) };
            lastDqRow = null;
            dqReasonRow = null;
            pendingRelay = null;
            inTeamScores = false;
            continue;
        }
        if (COLUMN_HEADER_RE.test(line)) continue;

        // The summary page's own lines ("Combined Team Scores...", "Rank Team
        // Combined", "Total 1036") aren't results, so only its team rows count.
        if (TEAM_SCORES_START_RE.test(line)) {
            inTeamScores = true;
            sheetTeamScores = sheetTeamScores || {};
            continue;
        }
        if (inTeamScores) {
            const scoreMatch = line.match(TEAM_SCORE_ROW_RE);
            if (scoreMatch) sheetTeamScores[scoreMatch[1]] = parseFloat(scoreMatch[2]);
            continue;
        }

        const dqMatch = line.match(DQ_REASON_RE);
        if (dqMatch) {
            if (lastDqRow) {
                lastDqRow.dqReason = dqMatch[1].trim() || null;
                dqReasonRow = lastDqRow;
            }
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
                    place: parsePlace(place),
                    status: rowStatus(place, official),
                    team: team.trim(),
                    relayLetter,
                    teamAbbrev,
                    seedTime: seed,
                    officialTime: official,
                    seedSeconds: timeToSeconds(seed),
                    officialSeconds: timeToSeconds(official),
                    points: points ? parseFloat(points) : 0,
                    dqReason: null,
                    swimmers: []
                };
                pendingRelay = row;
                startRow(row);
                relays.push(row);
                continue;
            }

            const swimmerMatches = [...line.matchAll(RELAY_SWIMMER_RE)];
            if (swimmerMatches.length) {
                if (pendingRelay) pendingRelay.swimmers = swimmerMatches.map(sm => ({ name: normalizeName(sm[1]), age: parseInt(sm[2], 10) }));
                pendingRelay = null;
                continue;
            }
        } else {
            const m = line.match(INDIVIDUAL_ROW_RE);
            if (m) {
                const [, place, name, age, team, seed, official, points] = m;
                const row = {
                    eventNumber: currentEvent.number,
                    eventName: currentEvent.name,
                    place: parsePlace(place),
                    status: rowStatus(place, official),
                    name: normalizeName(name),
                    age: parseInt(age, 10),
                    team: team.trim(),
                    seedTime: seed,
                    officialTime: official,
                    seedSeconds: timeToSeconds(seed),
                    officialSeconds: timeToSeconds(official),
                    points: points ? parseFloat(points) : 0,
                    dqReason: null
                };
                startRow(row);
                individual.push(row);
                continue;
            }
        }

        if (dqReasonRow && DQ_CONTINUATION_RE.test(line)) {
            dqReasonRow.dqReason = dqReasonRow.dqReason ? `${dqReasonRow.dqReason}; ${line}` : line;
            continue;
        }

        unparsedLines.push(line);
    }

    return { individual, relays, unparsedLines, teamPoints, sheetDate, sheetTeamScores };
}

module.exports = { parseMeetResultsText, timeToSeconds, isSpotswoodTeam, normalizeName };
