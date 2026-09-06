const { getResultsTable, getRelayResultsTable, toResultDto, toRelayResultDto } = require("../shared/resultsTable");

// Reachable at /api/resultsByMeet?meetId=... Public -- Spotswood results
// (individual + relay) for one meet.
module.exports = async function (context, req) {
    const meetId = (req.query.meetId || "").trim();
    if (!meetId) {
        context.res = { status: 400, body: "Missing meetId." };
        return;
    }
    const escapedMeetId = meetId.replace(/'/g, "''");

    try {
        const resultsTable = getResultsTable();
        const individual = [];
        for await (const entity of resultsTable.listEntities({ queryOptions: { filter: `meetId eq '${escapedMeetId}'` } })) {
            individual.push(toResultDto(entity));
        }
        individual.sort((a, b) => a.eventNumber - b.eventNumber || a.name.localeCompare(b.name));

        const relayTable = getRelayResultsTable();
        const relays = [];
        for await (const entity of relayTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${escapedMeetId}'` } })) {
            relays.push(toRelayResultDto(entity));
        }
        relays.sort((a, b) => a.eventNumber - b.eventNumber || a.relayLetter.localeCompare(b.relayLetter));

        context.res = { status: 200, body: { individual, relays } };
    } catch (e) {
        context.log.error("Failed to load meet results:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
