// The numbers behind the meet results popup and the swimmer pages, as plain
// functions over result rows (from meetResultsParser.js or the Results
// tables). Definitions follow design/HANDOFF.md, "Stat definitions"; the
// pages show Spotswood swimmers only, so meet numbers count only theirs.
const { isSpotswoodTeam } = require("./meetResultsParser");

// Seeds for the youngest swimmers are often stale or placeholders, so the
// meet's "Biggest drop" only looks at swimmers this age and up.
const BIGGEST_DROP_MIN_AGE = 7;
// "Most improved" needs at least this much of a drop below seed to show.
const MOST_IMPROVED_MIN_PERCENT = 0.02;

function isScored(swim) {
    return swim.status === "OK";
}

// How far a swim came in under its seed time, or null when it didn't (or
// there's no seed or time to compare).
function dropBelowSeed(swim) {
    if (!isScored(swim) || swim.seedSeconds == null || swim.officialSeconds == null) return null;
    const seconds = swim.seedSeconds - swim.officialSeconds;
    if (seconds <= 0) return null;
    return { seconds, percent: seconds / swim.seedSeconds };
}

function describeDrop(swim, drop) {
    return {
        name: swim.name,
        age: swim.age,
        eventName: swim.eventName,
        meetId: swim.meetId,
        meetDate: swim.meetDate,
        seedTime: swim.seedTime,
        officialTime: swim.officialTime,
        seconds: Math.round(drop.seconds * 100) / 100,
        percent: drop.percent
    };
}

// One meet, from its individual and relay rows (both teams'; only
// Spotswood's are counted).
function meetSummary(individual, relays) {
    const swims = individual.filter(r => isSpotswoodTeam(r.team));
    const scored = swims.filter(isScored);
    const ourRelays = relays.filter(r => isSpotswoodTeam(r.team));
    const timedWithSeed = scored.filter(r => r.seedSeconds != null && r.officialSeconds != null);

    let biggestDrop = null;
    for (const swim of scored) {
        if (swim.age == null || swim.age < BIGGEST_DROP_MIN_AGE) continue;
        const drop = dropBelowSeed(swim);
        if (drop && (!biggestDrop || drop.percent > biggestDrop.percent)) biggestDrop = describeDrop(swim, drop);
    }

    return {
        swims: swims.length, // every Spotswood entry, including DQs and no-shows
        relays: ourRelays.length, // A, B, C, and exhibition
        swimmers: new Set(swims.map(r => r.name)).size, // entered, including no-shows
        // A tie for first is still a first ("1*" is stored as place 1).
        firstPlaces: scored.filter(r => r.place === 1).length,
        topThree: scored.filter(r => r.place != null && r.place <= 3).length,
        // Only A and B relays score; exhibition relays (C, and "X" places) don't count.
        relayWins: ourRelays.filter(r => isScored(r) && r.place === 1 && (r.relayLetter === "A" || r.relayLetter === "B")).length,
        relayEvents: new Set(relays.map(r => r.eventNumber)).size,
        firstTimeSwims: scored.filter(r => r.seedTime === "NT" && r.officialSeconds != null).length,
        fasterThanSeed: timedWithSeed.filter(r => r.officialSeconds < r.seedSeconds).length,
        timedWithSeed: timedWithSeed.length,
        dqs: swims.filter(r => r.status === "DQ").length,
        noShows: swims.filter(r => r.status === "NS").length,
        biggestDrop
    };
}

// The meet's final score: the sheet's own Team Scores page when it has one,
// otherwise every team's points added up. Spotswood on one side, every other
// team on the other.
function teamScore(parsed) {
    const totals = parsed.sheetTeamScores && Object.keys(parsed.sheetTeamScores).length ? parsed.sheetTeamScores : parsed.teamPoints;
    if (!totals || !Object.keys(totals).length) return null;
    let us = 0;
    let them = 0;
    for (const [team, points] of Object.entries(totals)) {
        if (isSpotswoodTeam(team)) us += points;
        else them += points;
    }
    return { us, them, source: totals === parsed.sheetTeamScores ? "sheet" : "points" };
}

function byMeetThenEvent(a, b) {
    return (a.meetDate || "").localeCompare(b.meetDate || "") || a.eventNumber - b.eventNumber;
}

// One swimmer's season, event by event, oldest swim first. Each scored swim
// gets its change from the previous scored swim in that event (lower is
// faster) and whether it's a personal best: faster than every earlier swim
// in that event. A first swim in an event has nothing to beat, so it isn't one.
function swimmerEvents(swims) {
    const byEvent = new Map();
    for (const swim of [...swims].sort(byMeetThenEvent)) {
        if (!byEvent.has(swim.eventName)) byEvent.set(swim.eventName, []);
        byEvent.get(swim.eventName).push(swim);
    }
    const events = [];
    for (const [eventName, list] of byEvent) {
        let best = null;
        let previous = null;
        const rows = list.map(swim => {
            const timed = isScored(swim) && swim.officialSeconds != null;
            const change = timed && previous != null ? Math.round((swim.officialSeconds - previous) * 100) / 100 : null;
            const personalBest = timed && best != null && swim.officialSeconds < best;
            if (timed) {
                previous = swim.officialSeconds;
                best = best == null ? swim.officialSeconds : Math.min(best, swim.officialSeconds);
            }
            return { ...swim, change, personalBest };
        });
        events.push({ eventName, swims: rows, seasonBestSeconds: best });
    }
    return events;
}

// The swimmer's biggest percent drop below a seed time, at least 2%, or null.
function mostImproved(swims) {
    let best = null;
    for (const swim of swims) {
        const drop = dropBelowSeed(swim);
        if (drop && drop.percent >= MOST_IMPROVED_MIN_PERCENT && (!best || drop.percent > best.percent)) best = describeDrop(swim, drop);
    }
    return best;
}

// The season totals behind a swimmer's header tiles, plus the dates and
// counts their captions use.
function swimmerTotals(swims) {
    const scored = swims.filter(isScored);
    const eventSwims = swims.filter(s => s.status === "OK" || s.status === "DQ");
    // A no-show never got in the water.
    const swum = swims.filter(s => s.status !== "NS");
    const meetDates = [...new Set(swum.map(s => s.meetDate).filter(Boolean))].sort();
    const bests = swimmerEvents(swims).flatMap(e => e.swims.filter(s => s.personalBest));
    const bestDates = bests.map(s => s.meetDate).filter(Boolean).sort();
    return {
        firstPlaces: scored.filter(s => s.place === 1).length,
        topThree: scored.filter(s => s.place != null && s.place <= 3).length,
        personalBests: bests.length,
        meetsSwum: new Set(swum.map(s => s.meetId)).size,
        eventsSwum: eventSwims.length,
        mostImproved: mostImproved(swims),
        differentEvents: new Set(eventSwims.map(s => s.eventName)).size,
        latestPersonalBestDate: bestDates.length ? bestDates[bestDates.length - 1] : null,
        firstMeetDate: meetDates.length ? meetDates[0] : null,
        lastMeetDate: meetDates.length ? meetDates[meetDates.length - 1] : null
    };
}

// The swimmer page's header tiles in ranked order (design/HANDOFF.md,
// "Swimmer header card: ranked highlights"). Only the first tile can be
// gold, and only when it's a celebration stat.
const HIGHLIGHTS = [
    { key: "mostImproved", celebration: true, applies: t => t.mostImproved != null },
    { key: "firstPlaces", celebration: true, applies: t => t.firstPlaces >= 1 },
    // When every podium was a win, Top-3 would only repeat 1st places.
    { key: "topThree", celebration: true, applies: (t, shown) => t.topThree >= 1 && !(shown.has("firstPlaces") && t.topThree === t.firstPlaces) },
    { key: "personalBests", celebration: true, applies: t => t.personalBests >= 1 },
    { key: "meetsSwum", celebration: false, applies: t => t.meetsSwum >= 2 },
    { key: "eventsSwum", celebration: false, applies: t => t.eventsSwum >= 1 }
];
const MAX_HIGHLIGHTS = 4;

// The first four tiles that apply, from swimmerTotals. With fewer than two,
// the page adds a "just getting started" line instead of padding with zeros.
function rankHighlights(totals) {
    const tiles = [];
    const shown = new Set();
    for (const highlight of HIGHLIGHTS) {
        if (tiles.length === MAX_HIGHLIGHTS) break;
        if (!highlight.applies(totals, shown)) continue;
        tiles.push({ key: highlight.key, gold: tiles.length === 0 && highlight.celebration });
        shown.add(highlight.key);
    }
    return { tiles, gettingStarted: tiles.length < 2 };
}

// Everything the swimmer page shows, from one swimmer's swims (each with its
// meet's date): their age and season, the header tiles, and each event's
// swims in order.
function swimmerSeason(name, swims) {
    const latest = [...swims].sort(byMeetThenEvent).pop();
    const totals = swimmerTotals(swims);
    return {
        name,
        age: latest ? latest.age : null,
        season: latest && latest.meetDate ? latest.meetDate.slice(0, 4) : "",
        totals,
        highlights: rankHighlights(totals),
        events: swimmerEvents(swims).map(e => ({
            eventName: e.eventName,
            seasonBestSeconds: e.seasonBestSeconds,
            swims: e.swims.map(s => ({
                meetId: s.meetId,
                meetDate: s.meetDate,
                status: s.status,
                place: s.place,
                officialTime: s.officialTime,
                officialSeconds: s.officialSeconds,
                change: s.change,
                personalBest: s.personalBest
            }))
        }))
    };
}

module.exports = {
    meetSummary, teamScore, swimmerEvents, mostImproved, swimmerTotals, rankHighlights, swimmerSeason, dropBelowSeed,
    BIGGEST_DROP_MIN_AGE, MOST_IMPROVED_MIN_PERCENT
};
