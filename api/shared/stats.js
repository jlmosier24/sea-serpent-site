// The numbers behind the meet results popup and the swimmer pages, as plain
// functions over result rows (from meetResultsParser.js or the Results
// tables). Definitions follow design/HANDOFF.md, "Stat definitions"; the
// pages show Spotswood swimmers only, so meet numbers count only theirs.
const { isSpotswoodTeam } = require("./meetResultsParser");
const { hasRealSeed } = require("./seeds");

function isScored(swim) {
    return swim.status === "OK";
}

// How far a swim came in under its seed time, or null when it didn't (or
// there's no seed or time to compare, or the seed was converted from the
// other course; see seeds.js).
function dropBelowSeed(swim) {
    if (!isScored(swim) || !hasRealSeed(swim) || swim.officialSeconds == null) return null;
    const seconds = swim.seedSeconds - swim.officialSeconds;
    if (seconds <= 0) return null;
    return { seconds, percent: seconds / swim.seedSeconds };
}

const round2 = n => Math.round(n * 100) / 100;
const sum = numbers => round2(numbers.reduce((total, n) => total + n, 0));
function groupBy(rows, keyOf) {
    const groups = new Map();
    for (const row of rows) {
        const key = keyOf(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    return groups;
}
/* ---------- Points by age group (design/update-5/UPDATE.md, section 5) ---------- */
// Points come from the sheet's points column, never worked out again:
// individual places score 6/4/3/2/1 and relays 8/4/2, ties as printed. The
// All tab adds up to the team's score, and so do Boys and Girls together.
const AGE_GROUPS = ["6 & under", "7-8", "9-10", "11-12", "13-14", "15-18"];
const MIXED_RELAYS = "Mixed relays";
const POINTS_ROWS = [...AGE_GROUPS, MIXED_RELAYS];

function ageGroupOf(age) {
    if (age == null) return null;
    if (age <= 6) return "6 & under";
    if (age <= 8) return "7-8";
    if (age <= 10) return "9-10";
    if (age <= 12) return "11-12";
    if (age <= 14) return "13-14";
    return "15-18";
}

// "Girls 9-10 50m Freestyle" -> "girls"; "Men 15-18 ..." -> "boys".
function genderOf(eventName) {
    if (/^(Girls|Women)\b/i.test(eventName || "")) return "girls";
    if (/^(Boys|Men)\b/i.test(eventName || "")) return "boys";
    return null;
}

// Where a relay's points go: an 8 & under relay's are shared by its swimmers,
// each to their own age group (null here); a relay for one age group counts
// there; the ones spanning several (12 & under, 13-18, 18 & under) are Mixed.
function relayAgeGroup(eventName) {
    const under = /(\d+)\s*&\s*Under/i.exec(eventName || "");
    if (under) return Number(under[1]) <= 8 ? null : MIXED_RELAYS;
    const range = /(\d+)-(\d+)/.exec(eventName || "");
    return range && AGE_GROUPS.includes(`${range[1]}-${range[2]}`) ? `${range[1]}-${range[2]}` : MIXED_RELAYS;
}

// { all, boys, girls }: each a row per group in a fixed order, { label, points }.
// Shared relay points can come to halves (2 points among four swimmers).
function pointsBy(swims, relays) {
    const tabs = { all: {}, boys: {}, girls: {} };
    const add = (eventName, label, points) => {
        for (const tab of ["all", genderOf(eventName)]) {
            if (tab && label) tabs[tab][label] = (tabs[tab][label] || 0) + points;
        }
    };
    for (const swim of swims) {
        if (swim.points) add(swim.eventName, ageGroupOf(swim.age), swim.points);
    }
    for (const relay of relays) {
        if (!relay.points) continue;
        const group = relayAgeGroup(relay.eventName);
        if (group) add(relay.eventName, group, relay.points);
        // Split among the swimmers the sheet lists, so the points all land somewhere.
        else for (const swimmer of relay.swimmers || []) add(relay.eventName, ageGroupOf(swimmer.age), relay.points / relay.swimmers.length);
    }
    const rows = tab => POINTS_ROWS.map(label => ({ label, points: round2(tabs[tab][label] || 0) }));
    return { all: rows("all"), boys: rows("boys"), girls: rows("girls") };
}

/* ---------- Highlight cards (design/update-5/UPDATE.md, sections 2 to 4) ---------- */
// Every list shows ties in full.

const SHORT_STROKES = { Freestyle: "Free", Backstroke: "Back", Breaststroke: "Breast", Butterfly: "Fly" };
// "Girls 13-14 50m Butterfly" -> "50 Fly"; a meet is all one course, so the unit goes.
function shortEvent(eventName) {
    const m = /(\d+)\s*(?:yd|m)\s+(.+)$/.exec(eventName || "");
    return m ? `${m[1]} ${SHORT_STROKES[m[2]] || m[2]}` : eventName;
}

// Swimmers who won every individual event they entered, at least three:
// { name, age, events } with the events in meet order.
function tripleWinners(swims) {
    return [...groupBy(swims, s => s.name)]
        .filter(([, entries]) => entries.length >= 3 && entries.every(s => isScored(s) && s.place === 1))
        .map(([name, entries]) => ({ name, age: entries[0].age, events: [...entries].sort((a, b) => a.eventNumber - b.eventNumber).map(s => shortEvent(s.eventName)) }))
        .sort((a, b) => (a.age - b.age) || a.name.localeCompare(b.name));
}

// Individual points by swimmer: { name, age, points } for each who scored.
function individualScorers(swims) {
    return [...groupBy(swims.filter(s => s.points > 0), s => s.name)]
        .map(([name, entries]) => ({ name, age: entries[0].age, points: sum(entries.map(s => s.points)) }));
}

// The top 3 by individual points, with everyone tied at the cut-off.
const TOP_SCORERS = 3;
function topScorers(swims) {
    const scorers = individualScorers(swims).sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name));
    if (!scorers.length) return [];
    const cutoff = scorers[Math.min(TOP_SCORERS, scorers.length) - 1].points;
    return scorers.filter(s => s.points >= cutoff).map(({ name, points }) => ({ name, points }));
}

// Each age group's biggest drop below a seed time: chosen by percent, shown
// in seconds, every tie listed. A group with no drop is left out.
function biggestDrops(scored) {
    const drops = [];
    for (const group of AGE_GROUPS) {
        const inGroup = scored
            .filter(s => ageGroupOf(s.age) === group)
            .map(s => ({ swim: s, drop: dropBelowSeed(s) }))
            .filter(d => d.drop);
        if (!inGroup.length) continue;
        const best = Math.max(...inGroup.map(d => d.drop.percent));
        inGroup
            .filter(d => best - d.drop.percent < 1e-9)
            .sort((a, b) => a.swim.eventNumber - b.swim.eventNumber)
            .forEach(({ swim, drop }) => drops.push({ group, name: swim.name, age: swim.age, eventName: swim.eventName, seconds: round2(drop.seconds), percent: drop.percent }));
    }
    return drops;
}

// Swims faster than the swimmer's best earlier swim in the event, by the
// site's rule: a first swim in an event never counts, so comparable is how
// many swims had an earlier time to beat.
function meetPersonalBests(scored, earlier) {
    const best = new Map();
    for (const r of earlier) {
        if (!isSpotswoodTeam(r.team) || !isScored(r) || r.officialSeconds == null) continue;
        const key = `${r.name}\u0000${r.eventName}`;
        if (!best.has(key) || r.officialSeconds < best.get(key)) best.set(key, r.officialSeconds);
    }
    const comparable = scored.filter(s => s.officialSeconds != null && best.has(`${s.name}\u0000${s.eventName}`));
    const bests = comparable.filter(s => s.officialSeconds < best.get(`${s.name}\u0000${s.eventName}`));
    return { personalBests: bests.length, personalBestSwimmers: new Set(bests.map(s => s.name)).size, comparableSwims: comparable.length };
}

// One meet, from its individual and relay rows (both teams'; only
// Spotswood's are counted) and the results from meets before it (for
// personal bests).
function meetSummary(individual, relays, earlier = []) {
    const swims = individual.filter(r => isSpotswoodTeam(r.team));
    const scored = swims.filter(isScored);
    const ourRelays = relays.filter(r => isSpotswoodTeam(r.team));
    // A converted seed isn't a real time in this pool, so it's left out of both counts.
    const timedWithSeed = scored.filter(r => hasRealSeed(r) && r.officialSeconds != null);
    const triples = tripleWinners(swims);

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
        ...meetPersonalBests(scored, earlier),
        // Individual points only, like the Point Scorer badge.
        pointScorers: individualScorers(swims).length,
        swimmersRaced: new Set(swims.filter(r => r.status !== "NS").map(r => r.name)).size,
        timeDropped: sum(timedWithSeed.filter(r => r.officialSeconds < r.seedSeconds).map(r => r.seedSeconds - r.officialSeconds)),
        dqs: swims.filter(r => r.status === "DQ").length,
        noShows: swims.filter(r => r.status === "NS").length,
        pointsBy: pointsBy(swims, ourRelays),
        highlights: {
            tripleWinners: triples,
            // Shown only when nobody won every event they entered.
            topScorers: triples.length ? [] : topScorers(swims),
            biggestDrops: biggestDrops(scored)
        }
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

// Everything the swimmer page shows, from one swimmer's swims (each with its
// meet's date) and their saved badges (shared/badgeStore.js): their age and
// season, how many meets they've swum (for the first-meet welcome), badges,
// and each event's swims in order.
function swimmerSeason(name, swims, earned = {}) {
    const latest = [...swims].sort(byMeetThenEvent).pop();
    const badgeTotals = earned.totals || {};
    // A no-show never got in the water; a DQ did.
    const meetsWithSwims = new Set(swims.filter(s => s.status !== "NS").map(s => s.meetId)).size;
    return {
        name,
        age: latest ? latest.age : null,
        season: latest && latest.meetDate ? latest.meetDate.slice(0, 4) : "",
        // Relays count as meets swum too, so a meet with only a relay leg still counts.
        meetsSwum: Math.max(meetsWithSwims, badgeTotals.meetsSwum || 0),
        badges: earned.badges || [],
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
    meetSummary, teamScore, swimmerEvents, swimmerSeason, dropBelowSeed
};
