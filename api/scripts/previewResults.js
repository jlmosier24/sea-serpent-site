// Quick offline check for a meet results PDF, without going through the
// admin UI: `node scripts/previewResults.js path/to/results.pdf`
// Prints what importMeetResultsPreview would return (both teams), plus any
// lines the parser couldn't read -- useful for spot-checking a new meet's
// PDF before trusting it, since meet-software export formats can vary.
// An optional teamFilter arg narrows the printed rows to one team, applied
// here (not in the parser, which always returns everyone) -- handy for
// eyeballing just Spotswood's rows against the PDF.
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
    const teamFilter = process.argv[3] || "";
    const needle = teamFilter.toLowerCase();

    const buffer = fs.readFileSync(path.resolve(pdfPath));
    const text = await extractPdfText(buffer);
    const result = parseMeetResultsText(text);
    const individual = needle ? result.individual.filter(r => r.team.toLowerCase().includes(needle)) : result.individual;
    const relays = needle ? result.relays.filter(r => r.team.toLowerCase().includes(needle)) : result.relays;

    const label = teamFilter || "all teams";
    console.log(`Individual rows (${label}): ${individual.length}`);
    console.log(`Relay rows (${label}): ${relays.length}`);
    console.log(`Team points: ${JSON.stringify(result.teamPoints)}`);
    console.log(`Unparsed lines: ${result.unparsedLines.length}`);
    if (result.unparsedLines.length) {
        console.log("\nLines the parser could not read (not silently guessed at):");
        result.unparsedLines.forEach(l => console.log("  " + l));
    }
}

main().catch(e => { console.error(e); process.exit(1); });
