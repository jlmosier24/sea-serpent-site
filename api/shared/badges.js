// Badges (design/update-2/UPDATE.md, section 3), worked out from one
// swimmer's season: their individual swims, and the relays they swam a leg of.
//
// Only legal, timed swims count: DQs, no-shows, and scratches never earn or
// remove anything. A badge is New when it was earned, went up a count, or
// passed a milestone at the swimmer's latest meet. Counts and totals are the
// swimmer's real numbers; milestones only decide when a badge is earned and
// when it's New again.

const RELAY_LEG_METERS = 25;
const YARD_METERS = 0.9144;
const BARRIERS = [60, 40, 30, 20]; // seconds: under 1:00, 40s, 30s, 20s
const DISTANCE_LEVELS = [500, 1000, 2500]; // meters
const POINTS_LEVELS = [10, 25, 50, 100];
const DROP_LEVELS = [10, 30, 60]; // seconds dropped below seed times

// Catalog order also breaks ties when two badges are equally rare.
const BADGE_INFO = {
    splash: { name: "First Splash", description: "Swam in a first meet with the Sea Serpents." },
    pb: { name: "Personal Best", description: "Swam faster than any earlier time in an event." },
    streak: { name: "PB Streak", description: "Set a personal best at meet after meet." },
    barrier: { name: "Barrier Breaker", description: "Broke a big round-number barrier for the first time." },
    distance: { name: "Distance Dynamo", description: "Raced a lot of meters this season." },
    podium: { name: "Podium", description: "Finished in the top three." },
    champion: { name: "Champion", description: "Won an event." },
    scorer: { name: "Point Scorer", description: "Scored points for the team." },
    triple: { name: "Triple Winner", description: "Won every individual event at a meet." },
    relay: { name: "Relay Ready", description: "Swam legs of relays for the team." },
    anchor: { name: "Anchor", description: "Swam the final leg of a relay." },
    rounded: { name: "Well-Rounded", description: "Swam all four strokes." },
    dropper: { name: "Time Dropper", description: "Total time dropped across the season." }
};
const BADGE_ORDER = Object.keys(BADGE_INFO);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(isoDate) {
    const [, month, day] = (isoDate || "").split("-").map(Number);
    return month ? `${MONTHS[month - 1]} ${day}` : "";
}

// "Girls 12 & Under 100yd Freestyle" -> "100yd Freestyle"
function shortEventName(eventName) {
    const m = /^.+?\s+(\d+(?:yd|m)\s+.+)$/.exec(eventName || "");
    return m ? m[1] : eventName;
}

// An event's length as written ("100yd" -> 100, in yards), or null.
function eventDistance(eventName) {
    const m = /(\d+)\s*(yd|m)\b/.exec(eventName || "");
    return m ? { length: Number(m[1]), yards: m[2] === "yd" } : null;
}

// Meters raced in one swim of this event, or on one relay leg; yards are converted.
function eventMeters(eventName) {
    const d = eventDistance(eventName);
    return d ? d.length * (d.yards ? YARD_METERS : 1) : 0;
}
function legMeters(eventName) {
    const d = eventDistance(eventName);
    return RELAY_LEG_METERS * (d && d.yards ? YARD_METERS : 1);
}

function stroke(eventName) {
    if (/\bIM\b|medley/i.test(eventName)) return null;
    if (/free/i.test(eventName)) return "freestyle";
    if (/back/i.test(eventName)) return "backstroke";
    if (/breast/i.test(eventName)) return "breaststroke";
    if (/fly|butterfly/i.test(eventName)) return "butterfly";
    return null;
}

const ORDINALS = { 1: "1st", 2: "2nd", 3: "3rd" };
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const commas = n => Math.round(n).toLocaleString("en-US");
// Tied places split their points, so a total can end in .5 (or .33 for three).
const tenths = n => (Math.round(n * 10) / 10).toLocaleString("en-US");
const seconds = n => `${(Math.round(n * 100) / 100).toFixed(2)}`;
// The highest level passed going from `before` to `after`, or null.
const levelPassed = (levels, before, after) => [...levels].reverse().find(level => before < level && after >= level) || null;
const nextLevel = (levels, total) => levels.find(level => level > total) || null;

const scored = swim => swim.status === "OK" && swim.officialSeconds != null;
// Exhibition swims are legal and timed, just not scored.
const legalRelay = leg => leg.status === "OK" || leg.status === "EXH";
const byEvent = (a, b) => a.eventNumber - b.eventNumber;

// swims: the swimmer's individual rows (meetId, meetDate, eventNumber,
// eventName, status, place, seedTime, seedSeconds, officialTime,
// officialSeconds, points). legs: one per relay they're listed on (meetId,
// meetDate, eventNumber, eventName, status, leg as 1-4, and listed: how many
// swimmers the sheet lists). Returns { badges, totals }.
function swimmerBadges(swims, legs) {
    const meetDates = new Map();
    for (const row of [...swims, ...legs]) meetDates.set(row.meetId, row.meetDate || "");
    const meets = [...meetDates.keys()].sort((a, b) => meetDates.get(a).localeCompare(meetDates.get(b)) || a.localeCompare(b));

    const best = new Map(); // event name -> fastest time so far, seed times included
    const earned = {};      // badge id -> { meetId, ...details }
    const totals = { personalBests: 0, points: 0, relayLegs: 0, meters: 0, individualMeters: 0, relayMeters: 0, timeDropped: 0, podiums: 0, wins: 0, triples: 0, anchors: 0 };
    const strokes = new Set();
    const relayLegsByMeet = [];
    let streak = 0;
    let longestStreak = 0;
    let latestMeet = null;

    for (const meetId of meets) {
        const meetSwims = swims.filter(s => s.meetId === meetId).sort(byEvent);
        const meetLegs = legs.filter(l => l.meetId === meetId && legalRelay(l)).sort(byEvent);
        const swamHere = meetSwims.some(scored) || meetLegs.length > 0;
        if (!swamHere) continue;
        latestMeet = meetId;
        const before = { ...totals };
        if (!earned.splash) earned.splash = { meetId, detail: "First meet of the season" };

        let pbHere = false;
        for (const swim of meetSwims.filter(scored)) {
            const previous = Math.min(best.has(swim.eventName) ? best.get(swim.eventName).seconds : Infinity, swim.seedSeconds != null ? swim.seedSeconds : Infinity);
            const previousTime = best.has(swim.eventName) && best.get(swim.eventName).seconds <= (swim.seedSeconds ?? Infinity) ? best.get(swim.eventName).time : swim.seedTime;
            const event = shortEventName(swim.eventName);
            if (previous !== Infinity && swim.officialSeconds < previous) {
                totals.personalBests++;
                pbHere = true;
                if (!earned.pb) earned.pb = { meetId, detail: `${event}: ${previousTime} → ${swim.officialTime}` };
                const broken = BARRIERS.filter(b => previous >= b && swim.officialSeconds < b);
                if (broken.length) {
                    const barrier = Math.min(...broken);
                    earned.barrier = { meetId, sub: barrier === 60 ? "Under 1:00" : `Under ${barrier}s`, detail: `${event}: ${previousTime} → ${swim.officialTime}` };
                }
            }
            if (!best.has(swim.eventName) || swim.officialSeconds < best.get(swim.eventName).seconds) best.set(swim.eventName, { seconds: swim.officialSeconds, time: swim.officialTime });
            if (swim.seedSeconds != null && swim.officialSeconds < swim.seedSeconds) totals.timeDropped += swim.seedSeconds - swim.officialSeconds;
            totals.points += swim.points || 0;
            totals.individualMeters += eventMeters(swim.eventName);
            const style = stroke(swim.eventName);
            if (style) strokes.add(style);
            if (swim.place != null && swim.place <= 3) {
                totals.podiums++;
                earned.podium = { meetId, latest: `${ORDINALS[swim.place]} · ${event} (${swim.officialTime})` };
            }
            if (swim.place === 1) {
                totals.wins++;
                earned.champion = { meetId, latest: `${event} (${swim.officialTime})` };
            }
        }

        // Triple Winner: exactly three individual events entered here, and 1st in all three.
        if (meetSwims.length === 3 && meetSwims.every(s => scored(s) && s.place === 1)) {
            totals.triples++;
            earned.triple = { meetId };
        }

        if (meetLegs.length) {
            totals.relayLegs += meetLegs.length;
            relayLegsByMeet.push({ date: meetDates.get(meetId), count: meetLegs.length });
            earned.relay = { meetId };
            for (const leg of meetLegs) {
                totals.relayMeters += legMeters(leg.eventName);
                // The final leg of a complete lineup (four 25-length legs on a 100 relay).
                // A 125 relay lists only four of its five swimmers, so its 4th isn't the anchor.
                const distance = eventDistance(leg.eventName);
                if (leg.leg === leg.listed && distance && distance.length === leg.listed * 25) {
                    totals.anchors++;
                    earned.anchor = { meetId, latest: leg.eventName };
                }
            }
        }
        totals.meters = totals.individualMeters + totals.relayMeters;

        if (pbHere) {
            streak++;
            if (streak > longestStreak) {
                longestStreak = streak;
                if (streak >= 2) earned.streak = { meetId };
            }
        } else if (meetSwims.some(scored)) {
            streak = 0; // a meet with individual swims and no personal best ends the run
        }

        if (!earned.rounded && strokes.size === 4) earned.rounded = { meetId, detail: "Swam freestyle, backstroke, breaststroke and butterfly" };
        if (levelPassed(DISTANCE_LEVELS, before.meters, totals.meters)) earned.distance = { meetId };
        if (levelPassed(POINTS_LEVELS, before.points, totals.points)) earned.scorer = { meetId };
        if (levelPassed(DROP_LEVELS, before.timeDropped, totals.timeDropped)) earned.dropper = { meetId };
    }

    totals.timeDropped = Math.round(totals.timeDropped * 100) / 100;
    totals.points = Math.round(totals.points * 10) / 10;
    for (const key of ["meters", "individualMeters", "relayMeters"]) totals[key] = Math.round(totals[key]);

    // The pill shows a real count or total; a count of 1 needs no pill.
    const count = n => (n > 1 ? `×${n}` : null);
    const pills = {
        streak: `×${longestStreak}`,
        distance: `${commas(totals.meters)} m`,
        podium: count(totals.podiums),
        champion: count(totals.wins),
        scorer: `${tenths(totals.points)} pts`,
        triple: count(totals.triples),
        relay: count(totals.relayLegs),
        anchor: count(totals.anchors),
        dropper: `${seconds(totals.timeDropped)}s`
    };
    // " Next level at 1,000 m, 275 m to go." (nothing once the top level is passed)
    const toGo = (levels, total, unit, leftUnit, format = commas) => {
        const next = nextLevel(levels, total);
        return next ? ` Next level at ${commas(next)}${unit}, ${format(next - total)}${leftUnit} to go.` : "";
    };
    const withLatest = (count, total, latest) => (count > 1 ? `${total}. Latest: ${latest}` : latest);
    const details = {
        streak: `Personal bests at ${longestStreak} meets in a row`,
        distance: `${commas(totals.meters)} meters raced: ${commas(totals.individualMeters)} m in individual events and ${commas(totals.relayMeters)} m on ${plural(totals.relayLegs, "relay leg", "relay legs")}. DQ swims don't count.${toGo(DISTANCE_LEVELS, totals.meters, " m", " m")}`,
        podium: earned.podium && withLatest(totals.podiums, plural(totals.podiums, "top-3 finish", "top-3 finishes"), earned.podium.latest),
        champion: earned.champion && (totals.wins > 1 ? `${totals.wins} wins. Latest: ${earned.champion.latest}` : `Won ${earned.champion.latest}`),
        scorer: `${tenths(totals.points)} team points so far.${toGo(POINTS_LEVELS, totals.points, " points", "", tenths)}`,
        triple: `Won all 3 individual events at ${plural(totals.triples, "meet", "meets")}`,
        relay: totals.relayLegs === 1
            ? "Swam a relay leg"
            : `Swam ${totals.relayLegs} relay legs: ${relayLegsByMeet.map(m => `${m.count} on ${longDate(m.date)}`).join(", ")}`,
        anchor: earned.anchor && (totals.anchors > 1 ? `Anchored ${totals.anchors} relays. Latest: ${earned.anchor.latest}` : `Anchored the ${earned.anchor.latest}`),
        dropper: `Total time dropped: ${seconds(totals.timeDropped)} s.${toGo(DROP_LEVELS, totals.timeDropped, " s", " s", seconds)}`
    };
    // Champion covers every podium a winner has, so Podium only shows without it.
    if (earned.champion) delete earned.podium;

    const badges = BADGE_ORDER.filter(id => earned[id]).map(id => ({
        id,
        name: BADGE_INFO[id].name,
        description: BADGE_INFO[id].description,
        pill: pills[id] || null,
        sub: earned[id].sub || null,
        detail: earned[id].detail || details[id] || "",
        meetId: earned[id].meetId,
        meetDate: meetDates.get(earned[id].meetId) || "",
        isNew: earned[id].meetId === latestMeet
    }));
    return { badges, totals: { ...totals, meetsSwum: meets.filter(m => swims.some(s => s.meetId === m && scored(s)) || legs.some(l => l.meetId === m && legalRelay(l))).length } };
}

// How many swimmers hold each badge, for "rarer first".
function badgeRarity(allBadges) {
    const holders = {};
    for (const badges of allBadges) for (const b of badges) holders[b.id] = (holders[b.id] || 0) + 1;
    return holders;
}

// New badges first; then the rarest (fewest teammates hold it), with First
// Splash always last; ties in catalog order.
function rankBadges(badges, rarity = {}) {
    const rank = b => [b.isNew ? 0 : 1, b.id === "splash" ? 1 : 0, rarity[b.id] || 0, BADGE_ORDER.indexOf(b.id)];
    return [...badges].sort((a, b) => {
        const [x, y] = [rank(a), rank(b)];
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
        return 0;
    });
}

// The whole team's badges at once, since rarity compares teammates. swims are
// Spotswood's individual rows and relays its relay rows (with swimmers listed
// in leg order), each with its meet's meetDate. Returns one { name, badges,
// totals } per swimmer, badges in display order.
function teamBadges(swims, relays) {
    const swimsByName = new Map();
    const legsByName = new Map();
    const add = (map, name, row) => {
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(row);
    };
    for (const swim of swims) add(swimsByName, swim.name, swim);
    for (const relay of relays) {
        relay.swimmers.forEach((swimmer, i) => add(legsByName, swimmer.name, {
            meetId: relay.meetId,
            meetDate: relay.meetDate,
            eventNumber: relay.eventNumber,
            eventName: relay.eventName,
            status: relay.status,
            place: relay.place,
            leg: i + 1,
            listed: relay.swimmers.length
        }));
    }
    const names = [...new Set([...swimsByName.keys(), ...legsByName.keys()])];
    const everyone = names.map(name => ({ name, ...swimmerBadges(swimsByName.get(name) || [], legsByName.get(name) || []) }));
    const rarity = badgeRarity(everyone.map(e => e.badges));
    return everyone.map(e => ({ ...e, badges: rankBadges(e.badges, rarity) }));
}

module.exports = { swimmerBadges, badgeRarity, rankBadges, teamBadges, eventMeters, BADGE_INFO };
