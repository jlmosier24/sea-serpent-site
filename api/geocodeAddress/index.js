const { searchAddress } = require("../shared/maps");

// Reachable at /api/geocodeAddress?q=... Protected by an explicit route rule
// in staticwebapp.config.json (requires the "administrator" role). Address
// suggestions for the admin's meet and home pool forms, through Azure Maps
// (see shared/maps.js) so the subscription key never reaches the browser.
module.exports = async function (context, req) {
    const query = (req.query.q || "").trim();
    if (!query) {
        context.res = { status: 200, body: [] };
        return;
    }
    try {
        context.res = { status: 200, body: await searchAddress(query) };
    } catch (e) {
        if (e.status) {
            context.res = { status: 502, body: "Maps lookup failed." };
            return;
        }
        context.log.error("Geocode lookup failed:", e);
        context.res = { status: 500, body: "Error: " + (e.message || e.code || JSON.stringify(e)) };
    }
};
