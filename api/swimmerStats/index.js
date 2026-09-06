const { getResultsTable, toResultDto, listSwimmerNames } = require("../shared/resultsTable");
const { getMeetsTable, toMeetDto, PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");

// Reachable at /api/swimmerStats. Public.
// - No ?name= : returns { swimmers: [...] }, every distinct swimmer name in
//   Results, for the picker on stats.html.
// - ?name=... : returns that swimmer's results across every meet, enriched
//   with each meet's date/title so the front end can chart times over the
//   season without a second round-trip per row.
module.exports = async function (context, req) {
    const name = (req.query.name || "").trim();

    try {
        if (!name) {
            const swimmers = await listSwimmerNames();
            context.res = { status: 200, body: { swimmers } };
            return;
        }

        const resultsTable = getResultsTable();
        const results = [];
        const escapedName = name.replace(/'/g, "''");
        for await (const entity of resultsTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${escapedName}'` } })) {
            results.push(toResultDto(entity));
        }

        const meetsTable = getMeetsTable();
        const meetsById = new Map();
        for await (const entity of meetsTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${MEET_PARTITION_KEY}'` } })) {
            const dto = toMeetDto(entity);
            meetsById.set(dto.id, dto);
        }

        const enriched = results.map(r => {
            const meet = meetsById.get(r.meetId);
            return { ...r, meetDate: meet ? meet.date : "", meetTitle: meet ? meet.title : r.meetId };
        });
        enriched.sort((a, b) => (a.meetDate || "").localeCompare(b.meetDate || "") || a.eventNumber - b.eventNumber);

        context.res = { status: 200, body: enriched };
    } catch (e) {
        context.log.error("Failed to load swimmer stats:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
