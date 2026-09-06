const { extractPdfText } = require("../shared/pdfText");
const { parseMeetResultsText } = require("../shared/meetResultsParser");

const MAX_BYTES = 15 * 1024 * 1024; // 15MB -- meet PDFs run a few MB at most

// Reachable at /api/importMeetResultsPreview. Protected by an explicit
// route rule in staticwebapp.config.json (requires the "administrator"
// role). Parses the uploaded PDF and returns the Spotswood-only rows (plus
// any lines it couldn't match) for the admin to review -- nothing is
// written to storage here. See importMeetResultsCommit for the write step.
module.exports = async function (context, req) {
    const { dataBase64 } = req.body || {};
    if (!dataBase64) {
        context.res = { status: 400, body: "Missing PDF data." };
        return;
    }

    let buffer;
    try {
        buffer = Buffer.from(dataBase64, "base64");
    } catch (e) {
        context.res = { status: 400, body: "Could not decode PDF data." };
        return;
    }
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
        context.res = { status: 400, body: `PDF must be under ${MAX_BYTES / (1024 * 1024)}MB.` };
        return;
    }

    try {
        const text = await extractPdfText(buffer);
        const result = parseMeetResultsText(text);
        context.res = { status: 200, body: result };
    } catch (e) {
        context.log.error("Failed to parse meet results PDF:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
