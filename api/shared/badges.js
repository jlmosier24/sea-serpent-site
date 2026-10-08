// Badges (design/update-2/UPDATE.md, section 3, as changed by update 4,
// sections C to E), worked out from one swimmer's season: their individual
// swims, and the relays they swam a leg of.
//
// Only legal, timed swims count: DQs, no-shows, and scratches never earn or
// remove anything. Meet Attendance is the one exception: it counts every meet
// the swimmer swam in, DQs included. A badge that counts something lists every
// instance, and its pill is that list's count or total. A badge is New at the
// meet where it was first earned, and at any later meet that changes its pill.

const { hasRealSeed } = require("./seeds");

const RELAY_LEG_METERS = 25;
const YARD_METERS = 0.9144;
const BARRIERS = [60, 40, 30, 20]; // seconds: under 1:00, 40s, 30s, 20s
// What the badges that add something up need before they're earned.
const DISTANCE_METERS = 500;
const SCORER_POINTS = 10;
const DROPPER_SECONDS = 10; // dropped below seed times
const ATTENDANCE_MEETS = 2; // the first meet is First Splash's

// Each badge's name and description, and for a badge that counts something,
// the label over its list (the others say how they were earned instead).
const BADGE_INFO = {
    splash: { name: "First Splash", description: "Swam in a first meet with the Sea Serpents." },
    pb: { name: "Personal Best", description: "Swam faster than any earlier time in an event.", listLabel: "Personal bests" },
    streak: { name: "PB Streak", description: "Set a personal best at meet after meet.", listLabel: "Meets" },
    barrier: { name: "Barrier Breaker", description: "Broke a big round-number barrier for the first time." },
    distance: { name: "Distance Dynamo", description: "Raced a lot of meters this season.", listLabel: "Meters by meet" },
    podium: { name: "Podium", description: "Finished in the top three.", listLabel: "Finishes" },
    champion: { name: "Champion", description: "Won an event.", listLabel: "Wins" },
    scorer: { name: "Point Scorer", description: "Scored points for the team.", listLabel: "Points by meet" },
    triple: { name: "Triple Winner", description: "Won every individual event at a meet.", listLabel: "Meets" },
    relay: { name: "Relay Ready", description: "Swam legs of relays for the team.", listLabel: "Relays" },
    anchor: { name: "Anchor", description: "Swam the final leg of a relay.", listLabel: "Relays" },
    rounded: { name: "Well-Rounded", description: "Swam all four strokes." },
    attendance: { name: "Meet Attendance", description: "Showed up and swam at meets.", listLabel: "Meets" },
    dropper: { name: "Time Dropper", description: "Total time dropped across the season.", listLabel: "Drops" }
};

// Display order (update 4, section E): New ones first, then this fixed
// ranking, rarest first, with First Splash always last.
const BADGE_RANK = ["triple", "champion", "barrier", "podium", "scorer", "dropper", "streak", "anchor", "distance", "relay", "rounded", "pb", "attendance", "splash"];

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

const SHORT_STROKES = { Freestyle: "Free", Backstroke: "Back", Breaststroke: "Breast", Butterfly: "Fly" };
// A meet's events in short, a repeated distance written once:
// "50m Freestyle", "50m Butterfly", "100m IM" -> "50m Free, Fly, 100m IM"
function eventList(eventNames) {
    let lastDistance = null;
    return eventNames.map(eventName => {
        const m = /^(\d+(?:yd|m))\s+(.+)$/.exec(shortEventName(eventName));
        if (!m) return eventName;
        const stroke = SHORT_STROKES[m[2]] || m[2];
        const text = m[1] === lastDistance ? stroke : `${m[1]} ${stroke}`;
        lastDistance = m[1];
        return text;
    }).join(", ");
}

// "Girls 12 & Under 100m Medley Relay" -> "100m Medley Relay · 12 & under"
function relayTitle(eventName) {
    const m = /^(.*?)\s*(\d+(?:yd|m)\s+.+)$/.exec(eventName || "");
    if (!m) return eventName;
    const group = m[1].replace(/^(Girls|Boys|Women|Men|Mixed)\s*/i, "").replace(/\bUnder\b/, "under");
    return group ? `${m[2]} · ${group}` : m[2];
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
const round2 = n => Math.round(n * 100) / 100;
const seconds = n => round2(n).toFixed(2);

const scored = swim => swim.status === "OK" && swim.officialSeconds != null;
// Exhibition swims are legal and timed, just not scored.
const legalRelay = leg => leg.status === "OK" || leg.status === "EXH";
const byEvent = (a, b) => a.eventNumber - b.eventNumber;

// What a list row shows: a title, a small line under it, and a value on the
// right. A row with no small line of its own (Meet Attendance's) keeps its
// meet instead, and the Stats page shows the meet's title there ("at Curtis
// Park"), so a renamed opponent reads right without working badges out again.
function listRow({ meetId, title, sub, value }) {
    const row = { title };
    if (sub != null) row.sub = sub;
    else row.meetId = meetId;
    if (value) row.value = value;
    return row;
}

// swims: the swimmer's individual rows (meetId, meetDate, eventNumber,
// eventName, status, place, seedTime, seedSeconds, seedConverted,
// officialTime, officialSeconds, points). legs: one per relay they're listed
// on (meetId, meetDate, eventNumber, eventName, status, leg as 1-4, and
// listed: how many swimmers the sheet lists). Returns { badges, totals },
// badges in display order.
function swimmerBadges(swims, legs) {
    const meetDates = new Map();
    for (const row of [...swims, ...legs]) meetDates.set(row.meetId, row.meetDate || "");
    const meets = [...meetDates.keys()].sort((a, b) => meetDates.get(a).localeCompare(meetDates.get(b)) || a.localeCompare(b));

    const best = new Map(); // event name -> their fastest earlier swim in it ({ seconds, time })
    const strokes = new Set();
    // Every instance of each counting badge, oldest first ({ meetId, title,
    // sub, value }, and the amount added for the ones that add up). The badges
    // without a list keep only where and how they were earned, in `once`.
    const lists = Object.fromEntries(Object.keys(BADGE_INFO).filter(id => BADGE_INFO[id].listLabel).map(id => [id, []]));
    const once = {};
    let run = []; // the meets in a row with a personal best, so far
    let individualMeters = 0;
    let relayMeters = 0;
    let latestMeet = null;

    for (const meetId of meets) {
        const date = longDate(meetDates.get(meetId));
        const meetSwims = swims.filter(s => s.meetId === meetId).sort(byEvent);
        const meetLegs = legs.filter(l => l.meetId === meetId).sort(byEvent);
        // Any swim or relay leg but a no-show means they swam at the meet, a DQ too.
        const swumHere = [...meetSwims, ...meetLegs].filter(row => row.status !== "NS").length;
        if (!swumHere) continue;
        latestMeet = meetId;
        lists.attendance.push({ meetId, title: date, value: plural(swumHere, "swim", "swims") });

        const timed = meetSwims.filter(scored);
        const relays = meetLegs.filter(legalRelay);
        if (!once.splash && (timed.length || relays.length)) once.splash = { meetId, detail: "First meet of the season" };

        const pbEvents = [];
        let points = 0;
        let firsts = 0;
        let scoringSwims = 0;
        let swimMeters = 0;
        for (const swim of timed) {
            const event = shortEventName(swim.eventName);
            const earlier = best.get(swim.eventName);
            // A personal best beats an earlier swim in the event; a first swim
            // never is one, even when it beats the seed time.
            if (earlier && swim.officialSeconds < earlier.seconds) {
                pbEvents.push(swim.eventName);
                lists.pb.push({ meetId, title: event, sub: `${date} · ${earlier.time} → ${swim.officialTime}`, value: `−${seconds(earlier.seconds - swim.officialSeconds)}s` });
            }
            // A barrier is broken the first time they're under it, so it's
            // measured against their best coming in: an earlier swim or the
            // seed, whichever is faster. A seed converted from the other course
            // doesn't count (seeds.js).
            const comingIn = hasRealSeed(swim) && (!earlier || swim.seedSeconds < earlier.seconds)
                ? { seconds: swim.seedSeconds, time: swim.seedTime }
                : earlier;
            const broken = comingIn ? BARRIERS.filter(b => comingIn.seconds >= b && swim.officialSeconds < b) : [];
            if (broken.length) {
                const barrier = Math.min(...broken);
                once.barrier = { meetId, sub: barrier === 60 ? "Under 1:00" : `Under ${barrier}s`, detail: `${event}: ${comingIn.time} → ${swim.officialTime}` };
            }
            if (!earlier || swim.officialSeconds < earlier.seconds) best.set(swim.eventName, { seconds: swim.officialSeconds, time: swim.officialTime });
            if (hasRealSeed(swim) && swim.officialSeconds < swim.seedSeconds) {
                const dropped = round2(swim.seedSeconds - swim.officialSeconds);
                lists.dropper.push({ meetId, title: event, sub: date, value: `−${seconds(dropped)}s`, amount: dropped });
            }
            points += swim.points || 0;
            if (swim.points > 0) scoringSwims++;
            swimMeters += eventMeters(swim.eventName);
            const style = stroke(swim.eventName);
            if (style) strokes.add(style);
            if (swim.place != null && swim.place <= 3) {
                const finish = { meetId, title: event, sub: `${date} · ${swim.officialTime}`, value: ORDINALS[swim.place] };
                lists.podium.push(finish);
                if (swim.place === 1) {
                    firsts++;
                    lists.champion.push(finish);
                }
            }
        }
        if (points > 0) {
            lists.scorer.push({
                meetId,
                title: date,
                sub: firsts ? plural(firsts, "first place", "first places") : `Scored in ${plural(scoringSwims, "event", "events")}`,
                value: `${tenths(points)} ${points === 1 ? "pt" : "pts"}`,
                amount: points
            });
        }

        // Triple Winner: exactly three individual events entered here, and 1st in all three.
        if (meetSwims.length === 3 && meetSwims.every(s => scored(s) && s.place === 1)) {
            lists.triple.push({ meetId, title: date, sub: eventList(meetSwims.map(s => s.eventName)), value: "3 of 3" });
        }

        let legMetersHere = 0;
        for (const leg of relays) {
            legMetersHere += legMeters(leg.eventName);
            const row = { meetId, title: relayTitle(leg.eventName), sub: date };
            lists.relay.push(row);
            // The final leg of a complete lineup (four 25-length legs on a 100 relay).
            // A 125 relay lists only four of its five swimmers, so its 4th isn't the anchor.
            const distance = eventDistance(leg.eventName);
            if (leg.leg === leg.listed && distance && distance.length === leg.listed * 25) lists.anchor.push(row);
        }

        // Rounded meet by meet, so the rows add up to the pill exactly.
        const individual = Math.round(swimMeters);
        const relay = Math.round(legMetersHere);
        if (individual + relay > 0) {
            individualMeters += individual;
            relayMeters += relay;
            const parts = [individual && `${commas(individual)} m individual`, relay && `${commas(relay)} m relays`];
            lists.distance.push({ meetId, title: date, sub: parts.filter(Boolean).join(" · "), value: `${commas(individual + relay)} m`, amount: individual + relay });
        }

        if (pbEvents.length) {
            run.push({ meetId, title: date, sub: eventList(pbEvents), value: plural(pbEvents.length, "PB", "PBs") });
            // PB Streak lists the first of its longest runs; one only as long doesn't replace it.
            if (run.length > lists.streak.length) lists.streak = [...run];
        } else if (timed.length) {
            run = []; // a meet with individual swims and no personal best ends the run
        }

        if (!once.rounded && strokes.size === 4) once.rounded = { meetId, detail: "Swam freestyle, backstroke, breaststroke and butterfly" };
    }

    const sum = list => list.reduce((total, row) => total + row.amount, 0);
    const timeDropped = round2(sum(lists.dropper));
    const points = Math.round(sum(lists.scorer) * 10) / 10;
    const meters = sum(lists.distance);
    const count = list => (list.length > 1 ? `×${list.length}` : null); // a count of 1 needs no pill
    // Whether each counting badge is earned, and its pill.
    const counting = {
        pb: [lists.pb.length > 0, count(lists.pb)],
        streak: [lists.streak.length >= 2, `×${lists.streak.length}`],
        distance: [meters >= DISTANCE_METERS, `${commas(meters)} m`],
        // Champion covers every podium a winner has, so Podium only shows without it.
        podium: [lists.podium.length > 0 && !lists.champion.length, count(lists.podium)],
        champion: [lists.champion.length > 0, count(lists.champion)],
        scorer: [points >= SCORER_POINTS, `${tenths(points)} pts`],
        triple: [lists.triple.length > 0, count(lists.triple)],
        relay: [lists.relay.length > 0, count(lists.relay)],
        anchor: [lists.anchor.length > 0, count(lists.anchor)],
        attendance: [lists.attendance.length >= ATTENDANCE_MEETS, count(lists.attendance)],
        dropper: [timeDropped >= DROPPER_SECONDS, `${seconds(timeDropped)}s`]
    };

    const badge = (id, meetId, fields) => ({
        id,
        name: BADGE_INFO[id].name,
        description: BADGE_INFO[id].description,
        ...fields,
        meetId,
        meetDate: meetDates.get(meetId) || "",
        isNew: meetId === latestMeet
    });
    const badges = [];
    for (const id of BADGE_RANK) {
        if (once[id]) {
            badges.push(badge(id, once[id].meetId, { pill: null, sub: once[id].sub || null, detail: once[id].detail }));
        } else if (counting[id] && counting[id][0]) {
            const rows = lists[id];
            // Its pill last changed at its newest row's meet, or it was earned there.
            badges.push(badge(id, rows[rows.length - 1].meetId, {
                pill: counting[id][1],
                sub: null,
                list: { label: BADGE_INFO[id].listLabel, rows: [...rows].reverse().map(listRow) }
            }));
        }
    }

    const totals = {
        personalBests: lists.pb.length,
        points,
        meters,
        individualMeters,
        relayMeters,
        timeDropped,
        podiums: lists.podium.length,
        wins: lists.champion.length,
        triples: lists.triple.length,
        relayLegs: lists.relay.length,
        anchors: lists.anchor.length,
        meetsSwum: lists.attendance.length
    };
    return { badges: rankBadges(badges), totals };
}

// New ones first, then the fixed ranking.
function rankBadges(badges) {
    const rank = b => BADGE_RANK.indexOf(b.id);
    return [...badges].sort((a, b) => Number(b.isNew) - Number(a.isNew) || rank(a) - rank(b));
}

// The whole team's badges. swims are Spotswood's individual rows and relays
// its relay rows (with swimmers listed in leg order), each with its meet's
// meetDate. Returns one { name, badges, totals } per swimmer.
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
    return names.map(name => ({ name, ...swimmerBadges(swimsByName.get(name) || [], legsByName.get(name) || []) }));
}

module.exports = { swimmerBadges, rankBadges, teamBadges, eventMeters, BADGE_INFO, BADGE_RANK };
