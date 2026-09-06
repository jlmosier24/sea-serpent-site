// Reachable at /api/geocodeAddress. Protected by an explicit route rule in
// staticwebapp.config.json (requires the "administrator" role). Proxies to
// Azure Maps' fuzzy search so the subscription key stays server-side and
// never reaches the browser. Fuzzy search (rather than plain address
// search) also matches points of interest, so a landmark's name comes back
// as poi.name when the query resolves to one -- letting the admin form
// auto-fill a venue name instead of requiring it to be typed separately.
//
// Copied from ad-astra-site/api/geocodeAddress -- same Azure Maps proxy,
// just needs its own AZURE_MAPS_KEY app setting on this Static Web App.
module.exports = async function (context, req) {
    const query = (req.query.q || "").trim();
    if (!query) {
        context.res = { status: 200, body: [] };
        return;
    }

    const key = process.env.AZURE_MAPS_KEY;
    const url = `https://atlas.microsoft.com/search/fuzzy/json?api-version=1.0&subscription-key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&typeahead=true&limit=5`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            context.res = { status: 502, body: "Maps lookup failed." };
            return;
        }
        const data = await response.json();
        const suggestions = (data.results || [])
            .filter(r => r.address && r.position)
            .map(r => ({
                address: r.address.freeformAddress,
                lat: r.position.lat,
                lon: r.position.lon,
                placeName: (r.poi && r.poi.name) || ""
            }));
        context.res = { status: 200, body: suggestions };
    } catch (e) {
        context.log.error("Geocode lookup failed:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
