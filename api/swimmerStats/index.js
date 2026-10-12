const { odata } = require("@azure/data-tables");
const { getResultsTable, toResultDto, listSwimmerNames } = require("../shared/resultsTable");
const { getMeetsTable, toMeetDto, PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");
const { isSpotswoodTeam } = require("../shared/meetResultsParser");
const { swimmerSeason } = require("../shared/stats");
const { getRecordsTable, listRecords, keyForEvent } = require("../shared/teamRecords");
const { getBadgesTable, readSwimmerBadges, readSwimmerList, saveSwimmerNames, countBadges } = require("../shared/badgeStore");

// Reachable at /api/swimmerStats. Public, and Spotswood swimmers only.
// - No ?name= : { swimmers: [...], ages: { name: age }, badgesEarned },
//   every Spotswood swimmer's name ("Last, First") and age, for the swimmer
//   pickers, and the team's badge count for the Stats page's season totals.
//   The list is saved with the badges after each import or meet delete
//   (shared/badgeStore.js); until the first one, the names, ages, and badge
//   count are gathered once and saved.
// - ?name=... : that swimmer's season for the Stats page (shared/stats.js
//   swimmerSeason): their badges (saved by shared/badgeStore.js) and each
//   event's swims with their changes and personal bests, plus the event's
//   team record ({ time, seconds, year, mine }; mine when this swimmer set it
//   here and still holds it).
module.exports = async function (context, req) {
    const name = (req.query.name || "").trim();

    try {
        const resultsTable = getResultsTable();
        if (!name) {
            const badgesTable = getBadgesTable();
            let list = await readSwimmerList(badgesTable);
            // A list saved before ages and the badge count were saved with it
            // is gathered again too.
            if (!list || (list.swimmers.length && !Object.keys(list.ages).length) || list.badgesEarned == null) {
                const { names, ages } = await listSwimmerNames(resultsTable);
                list = { swimmers: names, ages, badgesEarned: await countBadges(badgesTable) };
                try {
                    await saveSwimmerNames(badgesTable, names, { ages, badgesEarned: list.badgesEarned });
                } catch (e) {
                    context.log.error("Failed to save the swimmer list:", e);
                }
            }
            context.res = { status: 200, body: list };
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

        const season = swimmerSeason(name, swims, await readSwimmerBadges(getBadgesTable(), name));
        let records = new Map();
        try {
            records = await listRecords(getRecordsTable());
        } catch (e) {
            context.log.error("Failed to load the team records:", e); // the page still shows without them
        }
        season.events.forEach(event => {
            const record = records.get(keyForEvent(event.eventName));
            event.record = record ? {
                time: record.time,
                seconds: record.seconds,
                year: record.year,
                mine: event.swims.some(s => s.teamRecord && s.officialSeconds === record.seconds)
            } : null;
        });
        context.res = { status: 200, body: season };
    } catch (e) {
        context.log.error("Failed to load swimmer stats:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
