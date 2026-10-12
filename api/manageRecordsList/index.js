const { getRecordsTable, listRecords, describeKey, compareKeys } = require("../shared/teamRecords");

// Reachable at /api/manageRecordsList. Admin only (the /api/manage* rule in
// staticwebapp.config.json). Every stored team record, for the admin page:
// [{ key, label, time, year, converted, setAtMeet }].
module.exports = async function (context) {
    try {
        const records = [...(await listRecords(getRecordsTable())).values()]
            .sort((a, b) => compareKeys(a.key, b.key))
            .map(r => ({ key: r.key, label: describeKey(r.key), time: r.time, year: r.year, converted: r.converted, setAtMeet: r.setAtMeet }));
        context.res = { status: 200, body: records };
    } catch (e) {
        context.log.error("Failed to list team records:", e);
        context.res = { status: 500, body: "Error: " + e.message };
    }
};
