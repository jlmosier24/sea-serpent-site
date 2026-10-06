const { TableClient } = require("@azure/data-tables");

const PARTITION_KEY = "meet";
const NOTE_MAX_LENGTH = 120;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function getMeetsTable() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    return TableClient.fromConnectionString(connectionString, "Meets");
}

// "Massad Marlins" -> "Massad": the opponent's name without its last word,
// which is usually the mascot. One-word names stay whole. It's only a
// starting point -- "Fox Point" has no mascot, so the admin edits that one.
function autoShortName(opponent) {
    const words = String(opponent || "").trim().split(/\s+/).filter(Boolean);
    return words.length > 1 ? words.slice(0, -1).join(" ") : (words[0] || "");
}

// "vs." means a home meet, "at" an away one.
function meetTitle(homeAway, shortName) {
    return `${homeAway === "away" ? "at" : "vs."} ${shortName}`;
}

// Meets saved before home/away and short names existed have only a
// free-text title the admin wrote, like "at Chancellor". Both come from it,
// so the title reads exactly as it did -- the opponent's name can't stand in
// ("Chancellor Blue Dolphins" minus its last word is "Chancellor Blue").
const OLD_TITLE_RE = /^\s*(vs\.?|at)\s+(.+)$/i;

function toMeetDto(entity) {
    const oldTitle = (entity.title || "").match(OLD_TITLE_RE);
    const homeAway = entity.homeAway || (oldTitle && oldTitle[1].toLowerCase() === "at" ? "away" : "home");
    const shortName = entity.shortName || (oldTitle ? oldTitle[2].trim() : "") || autoShortName(entity.opponent);
    const hasScore = entity.teamScore != null && entity.opponentScore != null;
    return {
        id: entity.rowKey,
        title: entity.shortName ? meetTitle(homeAway, entity.shortName) : (entity.title || meetTitle(homeAway, shortName)),
        opponent: entity.opponent || "",
        shortName,
        homeAway,
        date: entity.date,
        time: entity.time || "", // start time, "HH:MM"
        warmUp: entity.warmUp || "",
        placeName: entity.placeName || "", // the venue name
        address: entity.address || "",
        lat: entity.lat,
        lon: entity.lon,
        note: entity.note || "",
        // Added up from the sheet's points on import (see importMeetResultsCommit),
        // or typed in by the admin. Scores from before scoreSource existed all came from imports.
        teamScore: hasScore ? entity.teamScore : null,
        opponentScore: hasScore ? entity.opponentScore : null,
        scoreSource: hasScore ? (entity.scoreSource || "import") : null,
        // Likewise, every older meet that has a score had its results imported.
        resultsImported: entity.resultsImported != null ? !!entity.resultsImported : hasScore,
        lastImportFile: entity.lastImportFile || "",
        lastImportAt: entity.lastImportAt || ""
    };
}

function text(value) {
    return value == null ? "" : String(value).trim();
}

// A score box is blank (null) or a whole number of points (NaN otherwise).
function parseScore(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : NaN;
}

// Turns the admin form into the stored meet, or explains what's wrong with
// it. Saving replaces the whole record (so a cleared field really clears),
// which means the import's own fields are carried over from the existing one.
function buildMeetEntity(body, rowKey, existingEntity) {
    const opponent = text(body.opponent);
    const date = text(body.date);
    if (!opponent) return { error: "Enter the opponent's name." };
    if (!DATE_RE.test(date)) return { error: "Pick a date." };
    const time = text(body.time);
    const warmUp = text(body.warmUp);
    if ((time && !TIME_RE.test(time)) || (warmUp && !TIME_RE.test(warmUp))) return { error: "Enter times like 6:00pm." };
    const note = text(body.note);
    if (note.length > NOTE_MAX_LENGTH) return { error: `The note can be up to ${NOTE_MAX_LENGTH} characters.` };
    const teamScore = parseScore(body.teamScore);
    const opponentScore = parseScore(body.opponentScore);
    if (Number.isNaN(teamScore) || Number.isNaN(opponentScore)) return { error: "Scores must be whole numbers." };
    if ((teamScore == null) !== (opponentScore == null)) return { error: "Enter both scores, or leave both blank." };

    const homeAway = body.homeAway === "away" ? "away" : "home";
    const shortName = text(body.shortName) || autoShortName(opponent);
    const entity = {
        partitionKey: PARTITION_KEY,
        rowKey,
        title: meetTitle(homeAway, shortName),
        opponent,
        shortName,
        homeAway,
        date,
        time,
        warmUp,
        placeName: text(body.placeName),
        address: text(body.address),
        note
    };
    // Coordinates only come from picking an address suggestion; an address
    // typed in by hand arrives without them, so stale ones don't linger.
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    if (text(body.lat) && text(body.lon) && Number.isFinite(lat) && Number.isFinite(lon)) {
        entity.lat = lat;
        entity.lon = lon;
    }

    const existing = existingEntity ? toMeetDto(existingEntity) : null;
    if (teamScore != null) {
        entity.teamScore = teamScore;
        entity.opponentScore = opponentScore;
        // An unchanged score keeps its source. A new or edited one was typed
        // in, and an import never overwrites a typed-in score.
        const unchanged = existing && existing.teamScore === teamScore && existing.opponentScore === opponentScore;
        entity.scoreSource = unchanged ? existing.scoreSource : "manual";
    }
    if (existing && existing.resultsImported) {
        entity.resultsImported = true;
        entity.lastImportFile = existing.lastImportFile;
        entity.lastImportAt = existing.lastImportAt;
    }
    return { entity };
}

// Home meets missing a venue name or address take the home pool's. Anything
// already filled in stays, so a meet moved to another pool keeps its venue.
function homePoolFill(meet, pool) {
    if (!pool || meet.homeAway !== "home") return null;
    const update = {};
    if (!meet.placeName && pool.name) update.placeName = pool.name;
    if (!meet.address && pool.address) {
        update.address = pool.address;
        if (pool.lat != null && pool.lon != null) {
            update.lat = pool.lat;
            update.lon = pool.lon;
        }
    }
    return Object.keys(update).length ? update : null;
}

function sortByDate(meets) {
    return meets.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

// Meet dates are local-calendar "YYYY-MM-DD" strings, but Azure Functions
// run in UTC -- using UTC "now" would flip to tomorrow's date several hours
// before midnight actually arrives locally, so "today" is anchored to
// US Eastern time instead (see ad-astra-site/api/shared/tripsTable.js).
const LOCAL_TIME_ZONE = "America/New_York";
const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
});
function todayIsoDate() {
    return isoDateFormatter.format(new Date());
}

function isPastMeet(meet) {
    return !!meet.date && meet.date < todayIsoDate();
}

function slugify(title) {
    return title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "meet";
}

module.exports = {
    getMeetsTable, toMeetDto, buildMeetEntity, homePoolFill, autoShortName, meetTitle,
    sortByDate, todayIsoDate, isPastMeet, slugify, PARTITION_KEY, NOTE_MAX_LENGTH
};
