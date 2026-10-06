// Azure Maps address lookups. The key (AZURE_MAPS_KEY app setting) stays on
// the server; the browser only ever talks to this site's own API.
//
// Fuzzy search (rather than plain address search) also matches points of
// interest, so a landmark's name comes back as poi.name when the query
// resolves to one -- letting the admin form fill in a venue name too.
async function searchAddress(query, limit = 5) {
    const key = process.env.AZURE_MAPS_KEY;
    if (!key || !query) return [];
    const url = `https://atlas.microsoft.com/search/fuzzy/json?api-version=1.0&subscription-key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&typeahead=true&limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) {
        const err = new Error(`Maps lookup failed (${response.status}).`);
        err.status = response.status;
        throw err;
    }
    const data = await response.json();
    return (data.results || [])
        .filter(r => r.address && r.position)
        .map(r => ({
            address: r.address.freeformAddress,
            lat: r.position.lat,
            lon: r.position.lon,
            placeName: (r.poi && r.poi.name) || ""
        }));
}

// Map coordinates for an address typed in by hand, so its meet still gets a
// weather forecast. Best effort: any failure just means no coordinates.
async function coordinatesFor(address) {
    try {
        const [best] = await searchAddress(address, 1);
        return best ? { lat: best.lat, lon: best.lon } : null;
    } catch (e) {
        return null;
    }
}

module.exports = { searchAddress, coordinatesFor };
