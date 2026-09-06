// Quick offline check for a meet results PDF, without going through the
// admin UI: `node scripts/previewResults.js path/to/results.pdf`
// Prints what importMeetResultsPreview would return, plus any lines the
// parser couldn't read -- useful for spot-checking a new meet's PDF before
// trusting it, since meet-software export formats can vary.
const fs = require("fs");
const path = require("path");
const { extractPdfText } = require("../shared/pdfText");
const { parseMeetResultsText } = require("../shared/meetResultsParser");

async function main() {
    const pdfPath = process.argv[2];
    if (!pdfPath) {
        console.error("Usage: node scripts/previewResults.js path/to/results.pdf [teamFilter]");
        process.exit(1);
    }
    const teamFilter = process.argv[3] || "Spotswood";

    const buffer = fs.readFileSync(path.resolve(pdfPath));
    const text = await extractPdfText(buffer);
    const result = parseMeetResultsText(text, { teamFilter });

    console.log(`Individual rows (${teamFilter}): ${result.individual.length}`);
    console.log(`Relay rows (${teamFilter}): ${result.relays.length}`);
    console.log(`Unparsed lines: ${result.unparsedLines.length}`);
    if (result.unparsedLines.length) {
        console.log("\nLines the parser could not read (not silently guessed at):");
        result.unparsedLines.forEach(l => console.log("  " + l));
    }
}

main().catch(e => { console.error(e); process.exit(1); });
