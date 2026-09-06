const pdfParse = require("pdf-parse");

// pdf-parse's default page renderer joins same-line text items with no
// separator at all -- PDF text is drawn as discrete positioned runs (e.g.
// one run per table column), and there's no literal space character
// between them, just an X-coordinate gap. Poppler's `pdftotext` fills that
// gap in with a heuristic; pdf.js (which pdf-parse wraps) does not. Without
// this, "1 Taormina, Soleil 12 Fawn Lake Fliers" collapses into
// "1Taormina, Soleil12Fawn Lake Fliers", which meetResultsParser.js can't
// read. This re-implements that gap-to-space heuristic against the same
// sample PDF used to design the line-shape regexes in meetResultsParser.js.
function renderPage(pageData) {
    const renderOptions = { normalizeWhitespace: false, disableCombineTextItems: false };
    return pageData.getTextContent(renderOptions).then(textContent => {
        let text = "";
        let lastY = null;
        let lastRight = null;
        for (const item of textContent.items) {
            const y = item.transform[5];
            const x = item.transform[4];
            const sameLine = lastY !== null && Math.abs(y - lastY) < 1;
            if (lastY !== null && !sameLine) {
                text += "\n";
            } else if (sameLine && lastRight !== null && x - lastRight > 1) {
                text += " ";
            }
            text += item.str;
            lastY = y;
            lastRight = x + item.width;
        }
        return text;
    });
}

async function extractPdfText(buffer) {
    const parsed = await pdfParse(buffer, { pagerender: renderPage });
    return parsed.text;
}

module.exports = { extractPdfText };
