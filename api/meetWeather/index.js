// Reachable at /api/meetWeather?lat=..&lon=..&date=YYYY-MM-DD. Public --
// proxies the free, keyless National Weather Service API server-side (no
// subscription key to protect, but keeping it server-side avoids CORS and
// keeps the two-step points->forecast lookup off the client).
//
// NWS only forecasts about 7 days out. A meet further out than that isn't
// an error -- it just has no forecast yet, so this always responds 200
// with { available: false } rather than a failure status, and the front
// end shows "forecast available closer to the meet" for that case.
module.exports = async function (context, req) {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const date = (req.query.date || "").trim();

    if (!isFinite(lat) || !isFinite(lon)) {
        context.res = { status: 400, body: "lat and lon are required." };
        return;
    }

    const headers = { "User-Agent": "sea-serpent-site (meet weather lookup)" };

    try {
        const pointsResp = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers });
        if (!pointsResp.ok) {
            context.res = { status: 200, body: { available: false } };
            return;
        }
        const points = await pointsResp.json();
        const forecastUrl = points.properties && points.properties.forecast;
        if (!forecastUrl) {
            context.res = { status: 200, body: { available: false } };
            return;
        }

        const forecastResp = await fetch(forecastUrl, { headers });
        if (!forecastResp.ok) {
            context.res = { status: 200, body: { available: false } };
            return;
        }
        const forecast = await forecastResp.json();
        const periods = (forecast.properties && forecast.properties.periods) || [];

        // Periods are day/night halves keyed by a start/end timestamp, not a
        // bare date -- match on the calendar date portion of startTime, and
        // prefer the daytime half when both match.
        const dayMatches = date ? periods.filter(p => (p.startTime || "").slice(0, 10) === date) : periods.slice(0, 1);
        const match = dayMatches.find(p => p.isDaytime) || dayMatches[0];

        if (!match) {
            context.res = { status: 200, body: { available: false } };
            return;
        }

        context.res = {
            status: 200,
            body: {
                available: true,
                name: match.name,
                shortForecast: match.shortForecast,
                temperature: match.temperature,
                temperatureUnit: match.temperatureUnit,
                windSpeed: match.windSpeed,
                icon: match.icon
            }
        };
    } catch (e) {
        context.log.error("Weather lookup failed:", e);
        context.res = { status: 200, body: { available: false } };
    }
};
