const { TableClient } = require("@azure/data-tables");

// Site-wide settings the admin sets once. Today that's just the home pool,
// whose name and address fill in home meets.
const PARTITION_KEY = "settings";
const HOME_POOL_KEY = "homePool";

function getSettingsTable() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    return TableClient.fromConnectionString(connectionString, "Settings");
}

// The saved home pool, or null if it hasn't been set yet.
async function getHomePool(table) {
    try {
        const entity = await table.getEntity(PARTITION_KEY, HOME_POOL_KEY);
        return {
            name: entity.name || "",
            address: entity.address || "",
            lat: entity.lat == null ? null : entity.lat,
            lon: entity.lon == null ? null : entity.lon
        };
    } catch (e) {
        const status = e.statusCode || (e.response && e.response.status);
        if (status === 404) return null;
        throw e;
    }
}

module.exports = { getSettingsTable, getHomePool, PARTITION_KEY, HOME_POOL_KEY };
