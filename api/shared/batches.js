const CONCURRENCY = 20;

// Runs fn over items 20 at a time. One at a time, a meet's ~700 result rows
// can outrun Static Web Apps' 45-second API request limit.
async function forEachInBatches(items, fn) {
    for (let i = 0; i < items.length; i += CONCURRENCY) {
        await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
    }
}

module.exports = { forEachInBatches };
