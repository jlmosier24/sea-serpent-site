const { getResultsTable, getRelayResultsTable, toResultDto, toRelayResultDto } = require("../shared/resultsTable");
const { getMeetsTable, listMeets, PARTITION_KEY: MEET_PARTITION_KEY } = require("../shared/meetsTable");
const { getBadgesTable, recomputeBadges } = require("../shared/badgeStore");
const { isSpotswoodTeam } = require("../shared/meetResultsParser");
const {
    getRecordsTable, listRecords, toRecordEntity, keyForEvent, describeKey, compareKeys, recordSummary, sameTime, holderOf
} = require("../shared/teamRecords");

// Reachable at /api/manageRecordsMatch. Admin only (the /api/manage* rule in
// staticwebapp.config.json). For records loaded from SwimTopia after the
// meets that set them were imported: each record from the latest season
// with results is matched to the Spotswood swim or relay that season with
// exactly its time (the earliest, if more than one), which is then marked as
// a team record, with the meet's card and popup and everyone's badges
// updated. Nothing is known of the record each one replaced. A record
// converted from yards has no meters swim to match. Safe to run again.
module.exports = async function (context) {
    try {
        const meetsTable = getMeetsTable();
        const resultsTable = getResultsTable();
        const relayTable = getRelayResultsTable();
        const recordsTable = getRecordsTable();

        const meets = new Map((await listMeets(meetsTable)).filter(m => m.resultsImported).map(m => [m.id, m]));
        const season = Math.max(0, ...[...meets.values()].map(m => Number(m.date.slice(0, 4))));
        const seasonMeets = new Map([...meets].filter(([, m]) => Number(m.date.slice(0, 4)) === season));
        const records = [...(await listRecords(recordsTable)).values()]
            .filter(r => r.year === season)
            .sort((a, b) => compareKeys(a.key, b.key));

        const result = { season: season || null, matched: [], alreadyMarked: [], notMatched: [] };
        const wanted = new Map();
        for (const record of records) {
            const label = describeKey(record.key);
            if (record.setAtMeet) result.alreadyMarked.push({ label, time: record.time });
            else if (record.converted) result.notMatched.push({ label, time: record.time, reason: "Converted from a yards time" });
            else wanted.set(record.key, record);
        }

        // The earliest Spotswood swim or relay with each record's time.
        const found = new Map();
        const consider = (entity, dto, kind, table) => {
            const meet = seasonMeets.get(dto.meetId);
            if (!meet || dto.status !== "OK" || dto.officialSeconds == null || !isSpotswoodTeam(dto.team)) return;
            const key = keyForEvent(dto.eventName);
            const record = key && wanted.get(key);
            if (!record || !sameTime(dto.officialSeconds, record.seconds)) return;
            const current = found.get(key);
            if (!current || meet.date < current.meet.date || (meet.date === current.meet.date && dto.eventNumber < current.dto.eventNumber)) {
                found.set(key, { key, record, meet, dto, kind, entity, table });
            }
        };
        for await (const entity of resultsTable.listEntities()) consider(entity, toResultDto(entity), "swim", resultsTable);
        for await (const entity of relayTable.listEntities()) consider(entity, toRelayResultDto(entity), "relay", relayTable);

        const summaries = new Map(); // meet id -> its updated summary
        for (const f of found.values()) {
            await f.table.updateEntity({ partitionKey: f.entity.partitionKey, rowKey: f.entity.rowKey, teamRecord: true }, "Merge");
            await recordsTable.upsertEntity(toRecordEntity({ ...f.record, holder: holderOf(f.kind, { ...f.dto, name: f.entity.partitionKey }), setAtMeet: f.meet.id, previous: null }), "Replace");
            const summary = summaries.get(f.meet.id) || { ...(f.meet.summary || {}) };
            const added = recordSummary({ key: f.key, kind: f.kind, row: { ...f.dto, name: f.entity.partitionKey }, old: null });
            summary.newRecords = [...(summary.newRecords || []).filter(r => r.key !== f.key), added];
            summaries.set(f.meet.id, summary);
            result.matched.push({ label: describeKey(f.key), time: f.record.time, meetDate: f.meet.date });
        }
        for (const [meetId, summary] of summaries) {
            if (!meets.get(meetId).summary) continue; // a meet without its numbers saved has no card stats to add to
            await meetsTable.updateEntity({ partitionKey: MEET_PARTITION_KEY, rowKey: meetId, summaryJson: JSON.stringify(summary) }, "Merge");
        }
        for (const [key, record] of wanted) {
            if (!found.has(key)) result.notMatched.push({ label: describeKey(key), time: record.time, reason: "No swim this season with this time" });
        }

        result.badgesUpdated = true;
        if (found.size) {
            try {
                await recomputeBadges({ resultsTable, relayTable, meetsTable, badgesTable: getBadgesTable() });
            } catch (e) {
                result.badgesUpdated = false;
                context.log.error("Failed to update badges:", e);
            }
        }
        context.res = { status: 200, body: result };
    } catch (e) {
        context.log.error("Failed to match team records:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
