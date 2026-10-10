const { getMeetsTable, toMeetDto, PARTITION_KEY } = require("../shared/meetsTable");
const { calendarFile } = require("../shared/meetCalendar");

// Reachable at /api/meetCalendar?id=... Public -- one meet as a calendar
// file, opened from "Add to calendar" > Apple or Outlook calendar. It's
// served as a calendar to open, not a download, so an iPhone shows its
// "Add to Calendar" screen; a computer saves it for Outlook or Calendar.
module.exports = async function (context, req) {
    const id = String(req.query.id || "");
    if (!id) {
        context.res = { status: 400, body: "Missing meet id." };
        return;
    }
    try {
        let entity;
        try {
            entity = await getMeetsTable().getEntity(PARTITION_KEY, id);
        } catch (e) {
            if (e.statusCode !== 404) throw e;
            context.res = { status: 404, body: "No meet with that id." };
            return;
        }
        const meet = toMeetDto(entity);
        context.res = {
            status: 200,
            headers: {
                "Content-Type": "text/calendar; charset=utf-8",
                "Content-Disposition": `inline; filename="sea-serpents-${meet.id.replace(/[^\w-]/g, "")}.ics"`,
                // A meet's time or place can change; always ask for the current one.
                "Cache-Control": "no-cache"
            },
            body: calendarFile(meet)
        };
    } catch (e) {
        context.log.error("Failed to build the meet's calendar file:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
