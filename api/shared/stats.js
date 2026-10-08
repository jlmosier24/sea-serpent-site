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
// in that event. A first swim in an event is never one, even when it beats
// the seed time.
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

// The season totals behind the swimmer header's stat strip.
function swimmerTotals(swims) {
    const scored = swims.filter(isScored);
    return {
        personalBests: swimmerEvents(swims).reduce((n, e) => n + e.swims.filter(s => s.personalBest).length, 0),
        // Tied places split their points, so a total can end in .5.
        points: Math.round(scored.reduce((n, s) => n + (s.points || 0), 0) * 10) / 10,
        // A no-show never got in the water.
        meetsSwum: new Set(swims.filter(s => s.status !== "NS").map(s => s.meetId)).size,
        mostImproved: mostImproved(swims)
    };
}

// The slim strip under the swimmer's badges (design/update-2/UPDATE.md,
// section 2): the first three of these that apply. With fewer than two the
// strip is left out, and the page shows a friendly line instead.
function statStrip(totals, relayLegs) {
    const items = [
        totals.mostImproved && { key: "mostImproved", seconds: totals.mostImproved.seconds, eventName: totals.mostImproved.eventName, meetDate: totals.mostImproved.meetDate },
        totals.points > 0 && { key: "points", value: totals.points },
        totals.personalBests > 0 && { key: "personalBests", value: totals.personalBests },
        relayLegs > 0 && { key: "relayLegs", value: relayLegs }
    ].filter(Boolean).slice(0, 3);
    return items.length >= 2 ? items : [];
}

// Everything the swimmer page shows, from one swimmer's swims (each with its
// meet's date) and their saved badges (shared/badgeStore.js): their age and
// season, badges, stat strip, and each event's swims in order.
function swimmerSeason(name, swims, earned = {}) {
    const latest = [...swims].sort(byMeetThenEvent).pop();
    const totals = swimmerTotals(swims);
    const badgeTotals = earned.totals || {};
    return {
        name,
        age: latest ? latest.age : null,
        season: latest && latest.meetDate ? latest.meetDate.slice(0, 4) : "",
        // Relays count as meets swum too, so a meet with only a relay leg still counts.
        meetsSwum: Math.max(totals.meetsSwum, badgeTotals.meetsSwum || 0),
        badges: earned.badges || [],
        strip: statStrip(totals, badgeTotals.relayLegs || 0),
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
    meetSummary, teamScore, swimmerEvents, mostImproved, swimmerTotals, statStrip, swimmerSeason, dropBelowSeed,
    BIGGEST_DROP_MIN_AGE, MOST_IMPROVED_MIN_PERCENT
};
