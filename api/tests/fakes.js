// In-memory stand-ins for Table and Blob storage, so the Functions' tests
// never touch real data, plus a way to call a Function directly.

function notFound() {
    const err = new Error("Not found");
    err.statusCode = 404;
    return err;
}

// Just enough of @azure/data-tables' TableClient for these Functions,
// including "<field> eq '<value>'" filters.
class FakeTable {
    constructor() { this.rows = new Map(); }
    key(pk, rk) { return `${pk}\u0000${rk}`; }
    async getEntity(pk, rk) {
        const row = this.rows.get(this.key(pk, rk));
        if (!row) throw notFound();
        return { ...row };
    }
    async createEntity(entity) {
        const k = this.key(entity.partitionKey, entity.rowKey);
        if (this.rows.has(k)) throw Object.assign(new Error("Already exists"), { statusCode: 409 });
        this.rows.set(k, { ...entity });
    }
    async upsertEntity(entity, mode = "Merge") {
        const k = this.key(entity.partitionKey, entity.rowKey);
        const prev = this.rows.get(k);
        this.rows.set(k, mode === "Replace" || !prev ? { ...entity } : { ...prev, ...entity });
    }
    async updateEntity(entity, mode = "Merge") {
        const k = this.key(entity.partitionKey, entity.rowKey);
        const prev = this.rows.get(k);
        if (!prev) throw notFound();
        this.rows.set(k, mode === "Replace" ? { ...entity } : { ...prev, ...entity });
    }
    async deleteEntity(pk, rk) {
        if (!this.rows.delete(this.key(pk, rk))) throw notFound();
    }
    async *listEntities(options = {}) {
        const filter = options.queryOptions && options.queryOptions.filter;
        const match = filter && filter.match(/^(\w+) eq '((?:[^']|'')*)'$/);
        for (const row of [...this.rows.values()]) {
            if (match) {
                const field = { PartitionKey: "partitionKey", RowKey: "rowKey" }[match[1]] || match[1];
                if (String(row[field]) !== match[2].replace(/''/g, "'")) continue;
            }
            yield { ...row };
        }
    }
    all() { return [...this.rows.values()]; }
}

class FakeContainer {
    constructor() { this.blobs = new Map(); }
    getBlockBlobClient(name) {
        return { url: `https://fake.blob.core.windows.net/container/${name}`, uploadData: async (data) => { this.blobs.set(name, data); } };
    }
    async *listBlobsFlat({ prefix = "" } = {}) {
        for (const name of [...this.blobs.keys()]) if (name.startsWith(prefix)) yield { name };
    }
    async deleteBlob(name) { this.blobs.delete(name); }
}

async function call(handler, { body, query = {} } = {}) {
    const log = () => {};
    log.error = () => {};
    const context = { res: null, log };
    await handler(context, { body, query });
    return context.res;
}

module.exports = { FakeTable, FakeContainer, call };
