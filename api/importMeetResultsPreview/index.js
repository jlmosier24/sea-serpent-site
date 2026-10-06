const { readResultsSheet } = require("../shared/resultsSheet");
const { meetSummary, teamScore } = require("../shared/stats");

// Reachable at /api/importMeetResultsPreview. Admin only (route rules in
// staticwebapp.config.json). Reads an uploaded results PDF and reports what
// importing it would save -- nothing is written here; see
// importMeetResultsCommit for that. Returns the sheet's own date (for the
// dialog's date check), Spotswood's swim/relay/swimmer counts, the team
// score it would save, and any lines it couldn't read.
module.exports = async function (context, req) {
    try {
        const { parsed } = await readResultsSheet((req.body || {}).dataBase64);
        const summary = meetSummary(parsed.individual, parsed.relays);
        context.res = {
            status: 200,
            body: {
                sheetDate: parsed.sheetDate,
                swims: summary.swims,
                relays: summary.relays,
                swimmers: summary.swimmers,
                teamScore: teamScore(parsed),
                unreadLines: parsed.unparsedLines
            }
        };
    } catch (e) {
        if (e.status === 400) {
            context.res = { status: 400, body: e.message };
            return;
        }
        context.log.error("Failed to read meet results PDF:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
