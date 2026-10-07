const { odata } = require("@azure/data-tables");
const { getResultsTable, toResultDto, listSwimmerNames } = require("../shared/resultsTable");
const { getMeetsTable, toMeetDto, PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");
const { isSpotswoodTeam } = require("../shared/meetResultsParser");
const { swimmerSeason } = require("../shared/stats");
const { getBadgesTable, readSwimmerBadges } = require("../shared/badgeStore");

// Reachable at /api/swimmerStats. Public, and Spotswood swimmers only.
// - No ?name= : { swimmers: [...] }, every Spotswood swimmer's name
//   ("Last, First"), for the swimmer pickers.
// - ?name=... : that swimmer's season for the Stats page (shared/stats.js
//   swimmerSeason): their badges (saved by shared/badgeStore.js), the stat
//   strip, and each event's swims with their changes and personal bests.
module.exports = async function (context, req) {
    const name = (req.query.name || "").trim();

    try {
        const resultsTable = getResultsTable();
        if (!name) {
            context.res = { status: 200, body: { swimmers: await listSwimmerNames(resultsTable) } };
            return;
        }

        const meetDates = new Map();
        for await (const entity of getMeetsTable().listEntities({ queryOptions: { filter: `PartitionKey eq '${MEET_PARTITION_KEY}'` } })) {
            const meet = toMeetDto(entity);
            meetDates.set(meet.id, meet.date);
        }

        // Results also hold the opposing team's rows, so a name in the URL
        // that matches an opposing swimmer still finds nothing here.
        const swims = [];
        for await (const entity of resultsTable.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${name}` } })) {
            if (!isSpotswoodTeam(entity.team)) continue;
            const swim = toResultDto(entity);
            swims.push({ ...swim, meetDate: meetDates.get(swim.meetId) || "" });
        }
        if (!swims.length) {
            context.res = { status: 404, body: "No results on record for that swimmer." };
            return;
        }

        context.res = { status: 200, body: swimmerSeason(name, swims, await readSwimmerBadges(getBadgesTable(), name)) };
    } catch (e) {
        context.log.error("Failed to load swimmer stats:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
