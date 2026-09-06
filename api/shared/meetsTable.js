const { TableClient } = require("@azure/data-tables");

const PARTITION_KEY = "meet";

function getMeetsTable() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    return TableClient.fromConnectionString(connectionString, "Meets");
}

function toMeetDto(entity) {
    return {
        id: entity.rowKey,
        title: entity.title,
        opponent: entity.opponent || "",
        address: entity.address || "",
        placeName: entity.placeName || "",
        lat: entity.lat,
        lon: entity.lon,
        date: entity.date,
        time: entity.time || "",
        hidden: !!entity.hidden
    };
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

module.exports = { getMeetsTable, toMeetDto, sortByDate, todayIsoDate, isPastMeet, slugify, PARTITION_KEY };
