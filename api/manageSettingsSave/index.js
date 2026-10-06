const { getSettingsTable, getHomePool, PARTITION_KEY, HOME_POOL_KEY } = require("../shared/settingsTable");

function text(value) {
    return value == null ? "" : String(value).trim();
}

// Reachable at /api/manageSettingsSave. Admin only (the /api/manage* rule in
// staticwebapp.config.json). Saves the home pool: { homePool: { name, address, lat, lon } }.
// The address is optional (without it, Directions has nothing to open).
module.exports = async function (context, req) {
    const pool = (req.body || {}).homePool || {};
    const name = text(pool.name);
    if (!name) {
        context.res = { status: 400, body: "Enter a name for the pool." };
        return;
    }

    const entity = { partitionKey: PARTITION_KEY, rowKey: HOME_POOL_KEY, name, address: text(pool.address) };
    // Coordinates only come with an address picked from the suggestions.
    const lat = Number(pool.lat);
    const lon = Number(pool.lon);
    if (entity.address && text(pool.lat) && text(pool.lon) && Number.isFinite(lat) && Number.isFinite(lon)) {
        entity.lat = lat;
        entity.lon = lon;
    }

    try {
        const table = getSettingsTable();
        await table.upsertEntity(entity, "Replace");
        context.res = { status: 200, body: { homePool: await getHomePool(table) } };
    } catch (e) {
        context.log.error("Failed to save the home pool:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
