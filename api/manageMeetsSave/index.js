const { getMeetsTable, buildMeetEntity, toMeetDto, slugify, PARTITION_KEY } = require("../shared/meetsTable");

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

async function getExisting(table, id) {
    try {
        return await table.getEntity(PARTITION_KEY, id);
    } catch (e) {
        const status = e.statusCode || (e.response && e.response.status);
        if (status === 404) return null;
        throw e;
    }
}

// Reachable at /api/manageMeetsSave. Admin only (the /api/manage* rule in
// staticwebapp.config.json). Creates a meet when no id is given, otherwise
// replaces that meet's details -- see buildMeetEntity for what's checked and
// what's carried over from the existing record.
module.exports = async function (context, req) {
    const body = req.body || {};

    try {
        const table = getMeetsTable();
        const existing = body.id ? await getExisting(table, String(body.id)) : null;
        if (body.id && !existing) {
            context.res = { status: 404, body: "That meet no longer exists." };
            return;
        }

        const { entity, error } = buildMeetEntity(body, existing ? existing.rowKey : "", existing);
        if (error) {
            context.res = { status: 400, body: error };
            return;
        }
        if (!existing) entity.rowKey = await generateUniqueId(table, slugify(`${entity.date}-${entity.opponent}`));

        await table.upsertEntity(entity, "Replace");
        context.res = { status: 200, body: toMeetDto(entity) };
    } catch (e) {
        context.log.error("Failed to save meet:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
