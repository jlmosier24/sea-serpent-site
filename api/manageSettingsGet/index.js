const { getSettingsTable, getHomePool } = require("../shared/settingsTable");

// Reachable at /api/manageSettingsGet. Admin only (the /api/manage* rule in
// staticwebapp.config.json). Returns { homePool: {...} or null }.
module.exports = async function (context, req) {
    try {
        context.res = { status: 200, body: { homePool: await getHomePool(getSettingsTable()) } };
    } catch (e) {
        context.log.error("Failed to load settings:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
