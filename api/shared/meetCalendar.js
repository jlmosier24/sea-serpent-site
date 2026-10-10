// A meet as a calendar file (.ics), for "Add to calendar" > Apple or Outlook
// calendar. Served from /api/meetCalendar rather than built in the browser:
// an iPhone offers "Add to Calendar" only for a file that comes from a web
// address with the calendar file type.

// Meets have no end time and calendars need one.
const MEET_LENGTH_HOURS = 3;
// Meet times are Eastern; the file spells out the zone's daylight-saving rules.
const EASTERN_TIMEZONE = [
    "BEGIN:VTIMEZONE", "TZID:America/New_York",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:20070311T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:20071104T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
    "END:VTIMEZONE"
];

// "18:00" -> "6:00pm"
function fmtClock(time) {
    const [hours, minutes] = time.split(":");
    const h = parseInt(hours, 10);
    return `${h % 12 || 12}:${minutes}${h >= 12 ? "pm" : "am"}`;
}

function icsText(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Calendar file lines stop at 75 bytes; a longer one continues on the next line after a space.
function foldIcsLine(line) {
    let folded = "";
    let bytes = 0;
    for (const ch of line) {
        const size = Buffer.byteLength(ch);
        if (bytes + size > 75) {
            folded += "\r\n ";
            bytes = 1;
        }
        folded += ch;
        bytes += size;
    }
    return folded;
}

// "2026-07-22" at "18:00", plus `addHours` -> "20260722T180000" (a wall-clock time, not UTC).
function icsDateTime(date, time, addHours = 0) {
    const [y, mo, d] = date.split("-").map(Number);
    const [h, mi] = time.split(":").map(Number);
    const t = new Date(Date.UTC(y, mo - 1, d, h + addHours, mi));
    return t.toISOString().slice(0, 16).replace(/[-:]/g, "") + "00";
}

function icsDate(date, addDays = 0) {
    const [y, mo, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, d + addDays)).toISOString().slice(0, 10).replace(/-/g, "");
}

// The event runs from warm-up (or the meet's start, without one) for three
// hours; with neither time set, it's an all-day event.
function calendarFile(meet, now = new Date()) {
    const start = meet.warmUp || meet.time;
    const when = start
        ? [`DTSTART;TZID=America/New_York:${icsDateTime(meet.date, start)}`, `DTEND;TZID=America/New_York:${icsDateTime(meet.date, start, MEET_LENGTH_HOURS)}`]
        : [`DTSTART;VALUE=DATE:${icsDate(meet.date)}`, `DTEND;VALUE=DATE:${icsDate(meet.date, 1)}`];
    const location = [meet.placeName, meet.address].filter(Boolean).join(", ");
    const details = [meet.warmUp && `Warm-up at ${fmtClock(meet.warmUp)}.`, meet.time && `Meet starts at ${fmtClock(meet.time)}.`].filter(Boolean).join(" ");
    const lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Spotswood Sea Serpents//Meet schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        ...(start ? EASTERN_TIMEZONE : []),
        "BEGIN:VEVENT",
        `UID:${meet.id}@spotswood-sea-serpents`,
        `DTSTAMP:${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`,
        ...when,
        `SUMMARY:${icsText(`Spotswood ${meet.title}`)}`,
        location && `LOCATION:${icsText(location)}`,
        details && `DESCRIPTION:${icsText(details)}`,
        "END:VEVENT", "END:VCALENDAR"
    ];
    return lines.filter(Boolean).map(foldIcsLine).join("\r\n") + "\r\n";
}

module.exports = { calendarFile, MEET_LENGTH_HOURS };
