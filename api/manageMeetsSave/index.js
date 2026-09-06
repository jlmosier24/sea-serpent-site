const { getMeetsTable, toMeetDto, slugify, PARTITION_KEY } = require("../shared/meetsTable");

async function generateUniqueId(table, base) {
    let candidate = base;
    let suffix = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await table.getEntity(PARTITION_KEY, candidate);
            suffix += 1;
            candidate = `${base}-${suffix}`;
        } catch (e) {
            const status = e.statusCode || (e.response && e.response.status);
            if (status === 404) return candidate;
            throw e;
        }
    }
}

// Reachable at /api/manageMeetsSave. Protected by an explicit route rule in
// staticwebapp.config.json (requires the "administrator" role). Creates a
// meet if no id is given, otherwise updates the existing one in place.
module.exports = async function (context, req) {
    const body = req.body || {};
    const { id, title, opponent, address, placeName, lat, lon, date, time, hidden } = body;

    if (!title || !date) {
        context.res = { status: 400, body: "Missing required fields (title, date)." };
        return;
    }

    try {
        const table = getMeetsTable();
        const rowKey = id || await generateUniqueId(table, slugify(`${date}-${opponent || title}`));

        const entity = {
            partitionKey: PARTITION_KEY,
            rowKey,
            title,
            opponent: opponent || "",
            address: address || "",
            placeName: placeName || "",
            date,
            time: time || "",
            hidden: !!hidden
        };
        if (lat != null && lat !== "") entity.lat = Number(lat);
        if (lon != null && lon !== "") entity.lon = Number(lon);

        await table.upsertEntity(entity, "Replace");
        context.res = { status: 200, body: toMeetDto(entity) };
    } catch (e) {
        context.log.error("Failed to save meet:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
