// Seed times converted between yards and meters (design/update-4/UPDATE.md,
// rule A). Meet Maestro seeds a meters event from a swimmer's yards time
// x 1.11 when that's their best on record, and prints it like any other
// time. A converted seed isn't a real time in that pool, so a swim with one is
// left out of every comparison with its seed.
//
// The sheets don't mark converted seeds, so they're recognised instead: a
// seed that equals the swimmer's own earlier time in the other course,
// converted, was converted. (Each 2026 meters seed from the June 10 yards meet
// matches this exactly.) A conversion from a time the site doesn't have, like
// last summer's, can't be recognised.

const YARDS_TO_METERS = 1.11;

// "Girls 7-8 25yd Backstroke" -> { yards: true, race: "25 Backstroke" }, or null.
function course(eventName) {
    const m = /(\d+)\s*(yd|m)\s+(.+)$/.exec(eventName || "");
    return m ? { yards: m[2] === "yd", race: `${m[1]} ${m[3]}` } : null;
}

// Converted times are rounded or cut off at hundredths, so either counts.
function isConversionOf(seedSeconds, time, factor) {
    const exact = time * factor;
    return [Math.round(exact * 100) / 100, Math.floor(exact * 100 + 1e-6) / 100]
        .some(converted => Math.abs(converted - seedSeconds) < 0.005);
}

const swimmerKey = (swim, yards, race) => `${swim.name}\u0000${swim.team}\u0000${yards ? "yd" : "m"}\u0000${race}`;

// rows: one meet's individual rows. earlier: individual results from meets
// before it (any team; only each swimmer's own times are compared). Returns
// the rows, each with seedConverted true or false.
function markConvertedSeeds(rows, earlier) {
    const times = new Map();
    for (const swim of earlier) {
        const c = course(swim.eventName);
        if (!c || swim.officialSeconds == null) continue; // a DQ or no-show has no time
        const key = swimmerKey(swim, c.yards, c.race);
        if (!times.has(key)) times.set(key, []);
        times.get(key).push(swim.officialSeconds);
    }
    return rows.map(row => {
        const c = course(row.eventName);
        const other = c && row.seedSeconds != null ? times.get(swimmerKey(row, !c.yards, c.race)) || [] : [];
        const factor = c && c.yards ? 1 / YARDS_TO_METERS : YARDS_TO_METERS;
        return { ...row, seedConverted: other.some(time => isConversionOf(row.seedSeconds, time, factor)) };
    });
}

// A seed a swim can be compared with: there is one, and it wasn't converted.
function hasRealSeed(swim) {
    return swim.seedSeconds != null && !swim.seedConverted;
}

module.exports = { markConvertedSeeds, hasRealSeed, course, YARDS_TO_METERS };
