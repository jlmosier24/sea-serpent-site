const { extractPdfText } = require("./pdfText");
const { parseMeetResultsText } = require("./meetResultsParser");

const MAX_BYTES = 15 * 1024 * 1024; // meet PDFs run a few MB at most

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

// Decodes and reads an uploaded results PDF (base64). Both the preview and
// the save read the file themselves, so what's saved is always exactly what
// the archived sheet says. A problem with the upload itself throws with
// .status 400 and a message meant for the admin.
async function readResultsSheet(dataBase64) {
    if (!dataBase64) throw badRequest("Missing PDF data.");
    const buffer = Buffer.from(String(dataBase64), "base64");
    if (buffer.length === 0 || buffer.length > MAX_BYTES) throw badRequest(`The PDF must be under ${MAX_BYTES / (1024 * 1024)}MB.`);
    let text;
    try {
        text = await extractPdfText(buffer);
    } catch (e) {
        throw badRequest("That file couldn't be read as a PDF.");
    }
    return { buffer, parsed: parseMeetResultsText(text) };
}

module.exports = { readResultsSheet };
