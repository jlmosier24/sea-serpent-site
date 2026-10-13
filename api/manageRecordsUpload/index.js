const { getRecordsTable, listRecords, parseRecordsPage, toRecordEntity, describeKey } = require("../shared/teamRecords");
const { forEachInBatches } = require("../shared/batches");

const MAX_PAGE_BYTES = 3 * 1024 * 1024;

// Reachable at /api/manageRecordsUpload. Admin only (the /api/manage* rule
// in staticwebapp.config.json). Body: { html, save }. Reads the team records
// from a saved SwimTopia "Team Records" page -- events, times, years, the
// converted-time mark, and holders (shown on the admin page only) -- and
// says what saving would change; with save, it saves them. A record set here at an import that's faster
// than the page's (SwimTopia may not have it yet), or the same, is kept, and
// so is any stored record the page doesn't list.
module.exports = async function (context, req) {
    const { html, save } = req.body || {};
    if (typeof html !== "string" || !html || html.length > MAX_PAGE_BYTES) {
        context.res = { status: 400, body: "Choose the saved Team Records page." };
        return;
    }
    const parsed = parseRecordsPage(html);
    if (!parsed.records.length) {
        context.res = { status: 400, body: parsed.problem };
        return;
    }
    try {
        const table = getRecordsTable();
        const stored = await listRecords(table);
        const changes = { added: 0, changed: 0, unchanged: 0, keptFromSite: [] };
        const toSave = [];
        for (const record of parsed.records) {
            const current = stored.get(record.key);
            // A record set here stays when it's faster, or the same record
            // (so it stays tied to the meet that set it); the same record
            // takes the page's holder when it has none yet.
            if (current && current.setAtMeet && current.seconds <= record.seconds) {
                if (current.seconds < record.seconds) {
                    changes.keptFromSite.push({ label: describeKey(record.key), time: current.time, pageTime: record.time });
                } else if (!current.holder && record.holder) {
                    changes.changed++;
                    toSave.push({ ...current, holder: record.holder });
                } else {
                    changes.unchanged++;
                }
                continue;
            }
            if (!current) changes.added++;
            else if (current.seconds !== record.seconds || current.year !== record.year || current.converted !== record.converted || current.holder !== record.holder) changes.changed++;
            else changes.unchanged++;
            toSave.push(record);
        }
        if (save) {
            await table.createTable();
            await forEachInBatches(toSave, record => table.upsertEntity(toRecordEntity(record), "Replace"));
        }
        context.res = {
            status: 200,
            body: {
                course: parsed.course,
                records: parsed.records.map(r => ({ key: r.key, label: describeKey(r.key), time: r.time, year: r.year, converted: r.converted })),
                changes,
                saved: !!save
            }
        };
    } catch (e) {
        context.log.error("Failed to load team records:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
