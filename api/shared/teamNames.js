// Short team names for the full results list (2026-10-23): "Spotswood",
// "Woodland", "Fox Point", as the site's meet titles call teams, rather than
// the sheet's "Woodland Wahoos". Opponent names come from the admin's meet
// records (each opponent's full name and short name), matched to the sheet's
// team by its full name or, when the sheet spells the rest differently
// ("CPST Seahawks" for "Curtis Park Seahawks"), by its mascot, the last word,
// if only one opponent has it. A team with no meet record loses a mascot
// that's a plural last word ("Fawn Lake Fliers" -> "Fawn Lake"); a name
// without one stays as printed ("Fox Point").
const { isSpotswoodTeam } = require("./meetResultsParser");

const normalize = name => String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
const lastWord = name => normalize(name).split(" ").pop();

function teamShortNames(meets) {
    const opponents = meets.filter(m => m.meetType !== "championship" && m.opponent && m.shortName);
    const byName = new Map(opponents.map(m => [normalize(m.opponent), m.shortName]));
    const byMascot = new Map();
    for (const m of opponents) {
        if (normalize(m.opponent).split(" ").length < 2) continue;
        const mascot = lastWord(m.opponent);
        const known = byMascot.get(mascot);
        // Two different teams with one mascot can't tell the sheet's team apart.
        byMascot.set(mascot, known === undefined || known === m.shortName ? m.shortName : null);
    }
    return function shortTeam(team) {
        if (!team) return "";
        if (isSpotswoodTeam(team)) return "Spotswood";
        const name = normalize(team);
        if (byName.has(name)) return byName.get(name);
        const words = String(team).trim().split(/\s+/);
        if (words.length > 1 && byMascot.get(lastWord(team))) return byMascot.get(lastWord(team));
        return words.length > 1 && /s$/i.test(words[words.length - 1]) ? words.slice(0, -1).join(" ") : String(team).trim();
    };
}

module.exports = { teamShortNames };
