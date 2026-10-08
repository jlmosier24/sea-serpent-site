// The numbers behind the meet results popup and the swimmer pages, as plain
// functions over result rows (from meetResultsParser.js or the Results
// tables). Definitions follow design/HANDOFF.md, "Stat definitions"; the
// pages show Spotswood swimmers only, so meet numbers count only theirs.
const { isSpotswoodTeam } = require("./meetResultsParser");
const { hasRealSeed } = require("./seeds");

// Seeds for the youngest swimmers are often stale or placeholders, so the
// meet's "Biggest drop" only looks at swimmers this age and up.
const BIGGEST_DROP_MIN_AGE = 7;

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
const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];

/* ---------- Points by (design/update-4/UPDATE.md, B.4) ---------- */
// Points come from the sheet's points column, never worked out again:
// individual places score 6/4/3/2/1 and relays 8/4/2, ties as printed. Each
// split adds up to the same total, the team's score.
const AGE_GROUPS = ["8 & under", "9-10", "11-12", "13-14", "15-18"];
const MIXED_RELAYS = "Mixed relays";
const STROKES = ["Freestyle", "Backstroke", "Breaststroke", "Butterfly", "IM"];
const RELAYS = "Relays";

function ageGroupOf(age) {
    if (age == null) return null;
    if (age <= 8) return "8 & under";
    if (age <= 10) return "9-10";
    if (age <= 12) return "11-12";
    if (age <= 14) return "13-14";
    return "15-18";
}

// A relay counts toward its own age group, or Mixed relays when it spans
// several ("Girls 12 & Under 100m Medley Relay", "Boys 18 & Under 125m
// Freestyle Relay", "Girls 13-18 100m Medley Relay").
function relayAgeGroup(eventName) {
    const under = /(\d+)\s*&\s*Under/i.exec(eventName || "");
    if (under) return Number(under[1]) <= 8 ? "8 & under" : MIXED_RELAYS;
    const range = /(\d+)-(\d+)/.exec(eventName || "");
    return range && AGE_GROUPS.includes(`${range[1]}-${range[2]}`) ? `${range[1]}-${range[2]}` : MIXED_RELAYS;
}

function strokeOf(eventName) {
    if (/\bIM\b|Individual Medley/i.test(eventName || "")) return "IM";
    return STROKES.find(stroke => new RegExp(stroke, "i").test(eventName || "")) || null;
}

// Each tab's rows in a fixed order, so every meet shows the same ones:
// { label, individual, relay } points.
function pointsBy(swims, relays) {
    const tab = labels => labels.map(label => ({ label, individual: 0, relay: 0 }));
    const split = { ageGroup: tab([...AGE_GROUPS, MIXED_RELAYS]), stroke: tab([...STROKES, RELAYS]), place: tab(ORDINALS) };
    const add = (rows, label, kind, points) => {
        const row = rows.find(r => r.label === label);
        if (row) row[kind] = round2(row[kind] + points);
    };
    for (const swim of swims) {
        if (!swim.points) continue;
        add(split.ageGroup, ageGroupOf(swim.age), "individual", swim.points);
        add(split.stroke, strokeOf(swim.eventName), "individual", swim.points);
        add(split.place, ORDINALS[swim.place - 1], "individual", swim.points);
    }
    for (const relay of relays) {
        if (!relay.points) continue;
        add(split.ageGroup, relayAgeGroup(relay.eventName), "relay", relay.points);
        add(split.stroke, RELAYS, "relay", relay.points);
        add(split.place, ORDINALS[relay.place - 1], "relay", relay.points);
    }
    return split;
}

/* ---------- Meet highlights (design/update-4/UPDATE.md, B.5) ---------- */
// Every list shows ties in full, with no cap.

// Swimmers who won every individual event they entered, at least three.
function tripleWinners(swims) {
    return [...groupBy(swims, s => s.name)]
        .filter(([, entries]) => entries.length >= 3 && entries.every(s => isScored(s) && s.place === 1))
        .map(([name, entries]) => ({ name, age: entries[0].age, points: sum(entries.map(s => s.points || 0)) }))
        .sort((a, b) => (a.age - b.age) || a.name.localeCompare(b.name));
}

// The most places gained in one event, from the swimmer's place in the seed
// order to where they finished. The seed order ranks the event's real seeds
// (no NT or converted seeds) fastest first; exhibition swims aren't placed,
// so they're left out of it.
function biggestClimb(individual) {
    let most = 0;
    let climbs = [];
    for (const rows of groupBy(individual, r => r.eventNumber).values()) {
        const seeds = rows.filter(r => hasRealSeed(r) && r.status !== "EXH").map(r => r.seedSeconds).sort((a, b) => a - b);
        for (const swim of rows) {
            if (!isSpotswoodTeam(swim.team) || !isScored(swim) || swim.place == null || !hasRealSeed(swim)) continue;
            const seedRank = seeds.indexOf(swim.seedSeconds) + 1; // a tied seed shares the higher rank
            const gained = seedRank - swim.place;
            if (gained <= 0 || gained < most) continue;
            if (gained > most) {
                most = gained;
                climbs = [];
            }
            climbs.push({ name: swim.name, age: swim.age, eventName: swim.eventName, eventNumber: swim.eventNumber, seedRank, place: swim.place });
        }
    }
    return climbs.sort((a, b) => a.eventNumber - b.eventNumber);
}

// The closest individual races Spotswood won against the other team: a
// Spotswood winner with the other team's swimmer next, in 2nd. A tie for
// first wasn't won, and a Spotswood 1-2 isn't a race against them.
function photoFinishes(individual) {
    let closest = Infinity;
    let races = [];
    for (const rows of groupBy(individual, r => r.eventNumber).values()) {
        const placed = rows.filter(r => isScored(r) && r.place != null && r.officialSeconds != null);
        const winners = placed.filter(r => r.place === 1);
        const second = placed.filter(r => r.place === 2);
        if (winners.length !== 1 || !isSpotswoodTeam(winners[0].team)) continue;
        if (!second.length || second.some(r => isSpotswoodTeam(r.team))) continue;
        const winner = winners[0];
        const margin = round2(Math.min(...second.map(r => r.officialSeconds)) - winner.officialSeconds);
        if (margin <= 0 || margin > closest) continue;
        if (margin < closest) {
            closest = margin;
            races = [];
        }
        races.push({ name: winner.name, age: winner.age, eventName: winner.eventName, eventNumber: winner.eventNumber, margin });
    }
    return races.sort((a, b) => a.eventNumber - b.eventNumber);
}

// Individual points by swimmer: { name, age, points } for each who scored.
function individualScorers(swims) {
    return [...groupBy(swims.filter(s => s.points > 0), s => s.name)]
        .map(([name, entries]) => ({ name, age: entries[0].age, points: sum(entries.map(s => s.points)) }));
}

// Every swimmer of the youngest age to score individual points, most points first.
function youngestScorers(swims) {
    const scorers = individualScorers(swims).filter(s => s.age != null);
    if (!scorers.length) return [];
    const youngest = Math.min(...scorers.map(s => s.age));
    return scorers.filter(s => s.age === youngest).sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name));
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
        ...meetPersonalBests(scored, earlier),
        // Individual points only, like the Point Scorer badge.
        pointScorers: individualScorers(swims).length,
        swimmersRaced: new Set(swims.filter(r => r.status !== "NS").map(r => r.name)).size,
        timeDropped: sum(timedWithSeed.filter(r => r.officialSeconds < r.seedSeconds).map(r => r.seedSeconds - r.officialSeconds)),
        dqs: swims.filter(r => r.status === "DQ").length,
        noShows: swims.filter(r => r.status === "NS").length,
        biggestDrop,
        pointsBy: pointsBy(swims, ourRelays),
        highlights: {
            tripleWinners: tripleWinners(swims),
            biggestClimb: biggestClimb(individual),
            photoFinishes: photoFinishes(individual),
            youngestScorers: youngestScorers(swims)
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
    meetSummary, teamScore, swimmerEvents, swimmerSeason, dropBelowSeed, BIGGEST_DROP_MIN_AGE
};
