// Run from api/: npm test
// The badge rules in design/update-2/UPDATE.md, section 3, as changed by
// update 4 (no levels, a list behind every count, Meet Attendance, a fixed
// order), one at a time, with made-up swimmers.
const test = require("node:test");
const assert = require("node:assert/strict");
const { timeToSeconds } = require("../shared/meetResultsParser");
const { swimmerBadges, rankBadges, eventMeters, BADGE_INFO, BADGE_RANK } = require("../shared/badges");
const { swimmerEvents } = require("../shared/stats");

const DATES = { m1: "2026-06-10", m2: "2026-06-17", m3: "2026-06-24", m4: "2026-07-01", m5: "2026-07-08", m6: "2026-07-13" };

// One individual swim, with times as the sheet writes them ("1:06.24", "NT").
function swim(meetId, eventNumber, eventName, { place = null, seed = "NT", time = null, status = "OK", points = 0 } = {}) {
    return {
        meetId, meetDate: DATES[meetId], eventNumber, eventName, status, place, points,
        seedTime: seed, seedSeconds: timeToSeconds(seed),
        officialTime: time || status, officialSeconds: time ? timeToSeconds(time) : null
    };
}
// One relay leg: which leg they swam (1-4), and how many swimmers the sheet lists.
function leg(meetId, eventNumber, eventName, legNumber, { status = "OK", place = 1, listed = 4 } = {}) {
    return { meetId, meetDate: DATES[meetId], eventNumber, eventName, status, place, leg: legNumber, listed };
}
const badge = (result, id) => result.badges.find(b => b.id === id);
const ids = result => result.badges.map(b => b.id);

// A count pill ("×3") is the number of rows, no pill means one row, and a
// total ("725 m", "36 pts", "24.42s") is the rows added up.
function assertPillMatchesList(b) {
    const number = text => Number(String(text).replace(/[^\d.]/g, ""));
    const rows = b.list.rows;
    if (b.pill == null) assert.equal(rows.length, 1, b.id);
    else if (b.pill.startsWith("×")) assert.equal(number(b.pill), rows.length, b.id);
    else assert.equal(Math.round(rows.reduce((total, row) => total + number(row.value), 0) * 100) / 100, number(b.pill), b.id);
}

test("First Splash: the first meet with a legal swim; DQs and no-shows don't earn it", () => {
    assert.deepEqual(swimmerBadges([swim("m1", 3, "Girls 9-10 25m Freestyle", { status: "DQ" })], []).badges, []);
    const result = swimmerBadges([
        swim("m1", 3, "Girls 9-10 25m Freestyle", { status: "DQ" }),
        swim("m1", 7, "Girls 9-10 25m Backstroke", { status: "NS" }),
        swim("m2", 3, "Girls 9-10 25m Freestyle", { place: 5, time: "24.10" })
    ], []);
    assert.deepEqual(badge(result, "splash"), {
        id: "splash", name: "First Splash", description: "Swam in a first meet with the Sea Serpents.",
        pill: null, sub: null, detail: "First meet of the season", meetId: "m2", meetDate: "2026-06-17", isNew: true
    });
    // The DQ at m1 still counts as a meet swum, for Meet Attendance.
    assert.deepEqual(ids(result), ["attendance", "splash"]);
    assert.equal(result.totals.meetsSwum, 2);
});

test("Personal Best: every swim faster than an earlier one in the event, newest first; a first swim never is one", () => {
    const swims = [
        // A first swim, well under its seed: not a personal best.
        swim("m1", 3, "Boys 11-12 50m Freestyle", { place: 4, seed: "43.00", time: "41.48" }),
        swim("m1", 7, "Boys 11-12 50m Backstroke", { place: 5, seed: "49.00", time: "50.30" }),
        swim("m2", 3, "Boys 11-12 50m Freestyle", { place: 4, seed: "41.48", time: "40.55" }),
        // Faster than the earlier swim, though not the seed: a personal best.
        swim("m2", 7, "Boys 11-12 50m Backstroke", { place: 4, seed: "49.00", time: "49.90" }),
        swim("m3", 3, "Boys 11-12 50m Freestyle", { place: 4, seed: "40.55", time: "40.80" })
    ];
    const result = swimmerBadges(swims, []);
    const pb = badge(result, "pb");
    assert.deepEqual([pb.pill, pb.meetId, pb.isNew, pb.detail], ["×2", "m2", false, undefined]);
    assert.deepEqual(pb.list, { label: "Personal bests", rows: [
        { title: "50m Backstroke", sub: "June 17 · 50.30 → 49.90", value: "−0.40s" },
        { title: "50m Freestyle", sub: "June 17 · 41.48 → 40.55", value: "−0.93s" }
    ] });
    assert.equal(result.totals.personalBests, 2);
    // The Stats page's swim tables tag the same swims.
    assert.equal(swimmerEvents(swims).flatMap(e => e.swims).filter(s => s.personalBest).length, 2);

    // One more at a later meet adds a row and makes it New again.
    const more = badge(swimmerBadges([...swims, swim("m4", 7, "Boys 11-12 50m Backstroke", { place: 3, time: "48.00" })], []), "pb");
    assert.deepEqual([more.pill, more.isNew, more.list.rows[0].sub], ["×3", true, "July 1 · 49.90 → 48.00"]);
});

test("PB Streak: lists the meets of the longest run; a relay-only meet doesn't break it, a meet without a PB does", () => {
    const free = (meetId, time) => swim(meetId, 3, "Girls 11-12 50m Freestyle", { place: 4, time });
    const back = (meetId, time) => swim(meetId, 5, "Girls 11-12 50m Backstroke", { place: 4, time });
    const result = swimmerBadges([
        free("m1", "39.50"), back("m1", "45.00"), // first swims: nothing earlier to beat
        free("m2", "39.00"), back("m2", "44.00"),
        free("m4", "38.80"),
        free("m5", "38.60"),
        free("m6", "38.90")
    ], [leg("m3", 11, "Girls 11-12 100m Freestyle Relay", 2)]);
    const streak = badge(result, "streak");
    assert.deepEqual([streak.pill, streak.meetId, streak.isNew], ["×3", "m5", false]);
    assert.deepEqual(streak.list, { label: "Meets", rows: [
        { title: "July 8", sub: "50m Free", value: "1 PB" },
        { title: "July 1", sub: "50m Free", value: "1 PB" },
        { title: "June 17", sub: "50m Free, Back", value: "2 PBs" }
    ] });

    // Two in a row earns it; one doesn't.
    assert.equal(badge(swimmerBadges([free("m1", "39.50"), free("m2", "39.00"), free("m3", "38.80")], []), "streak").pill, "×2");
    assert.equal(badge(swimmerBadges([free("m1", "39.50"), free("m2", "39.00")], []), "streak"), undefined);
    // A later run only as long leaves the first one listed, and isn't New.
    const twoRuns = badge(swimmerBadges([free("m1", "40.00"), free("m2", "39.50"), free("m3", "39.00"), free("m4", "39.20"), free("m5", "38.90"), free("m6", "38.70")], []), "streak");
    assert.deepEqual([twoRuns.pill, twoRuns.list.rows.map(r => r.title), twoRuns.isNew], ["×2", ["June 24", "June 17"], false]);
});

test("Barrier Breaker: the first time under 1:00, 40, 30 or 20 seconds, counting the seed time", () => {
    const fly = badge(swimmerBadges([swim("m1", 9, "Boys 11-12 50m Butterfly", { place: 2, seed: "1:06.24", time: "53.46" })], []), "barrier");
    assert.deepEqual([fly.sub, fly.pill, fly.detail, fly.list], ["Under 1:00", null, "50m Butterfly: 1:06.24 → 53.46", undefined]);

    // Two barriers at once shows the lower one; a later break replaces it.
    const free = swim("m1", 3, "Girls 9-10 50m Freestyle", { place: 1, seed: "41.00", time: "29.90" });
    assert.equal(badge(swimmerBadges([free], []), "barrier").sub, "Under 30s");
    const later = badge(swimmerBadges([free, swim("m2", 5, "Girls 9-10 25m Backstroke", { place: 1, seed: "20.40", time: "19.80" })], []), "barrier");
    assert.deepEqual([later.sub, later.meetId, later.isNew], ["Under 20s", "m2", true]);

    // Already under 40 (the seed), a first swim with no seed, and a DQ break nothing.
    const none = swimmerBadges([
        swim("m1", 3, "Girls 9-10 50m Freestyle", { place: 3, seed: "39.00", time: "38.00" }),
        swim("m1", 5, "Girls 9-10 50m Backstroke", { place: 3, time: "35.00" }),
        swim("m1", 7, "Girls 9-10 50m Breaststroke", { seed: "41.00", status: "DQ" })
    ], []);
    assert.equal(badge(none, "barrier"), undefined);
});

test("Distance Dynamo: meters by meet from legal swims and relay legs (25 m each), earned at 500", () => {
    const swims = [
        swim("m1", 3, "Girls 11-12 100m Freestyle", { place: 4, time: "1:30.00" }),
        swim("m1", 5, "Girls 11-12 100m IM", { place: 4, time: "1:50.00" }),
        swim("m1", 7, "Girls 11-12 50m Breaststroke", { status: "DQ" }),
        swim("m2", 3, "Girls 11-12 100m Freestyle", { place: 4, seed: "1:30.00", time: "1:31.00" }),
        swim("m2", 6, "Girls 11-12 100m Backstroke", { place: 4, time: "1:45.00" }),
        swim("m2", 9, "Girls 11-12 50m Butterfly", { place: 4, time: "55.00" })
    ];
    const legs = [
        leg("m1", 11, "Girls 11-12 100m Medley Relay", 1),
        leg("m2", 12, "Girls 11-12 100m Freestyle Relay", 3),
        leg("m2", 14, "Girls 11-12 125m Freestyle Relay", 2, { status: "EXH", place: null }),
        leg("m2", 15, "Mixed 11-12 100m Medley Relay", 1, { status: "DQ", place: null })
    ];
    assert.equal(badge(swimmerBadges(swims.slice(0, 3), legs.slice(0, 1)), "distance"), undefined, "225 m isn't enough");
    const result = swimmerBadges(swims, legs);
    const distance = badge(result, "distance");
    assert.deepEqual([distance.pill, distance.meetId, distance.isNew], ["525 m", "m2", true]);
    assert.deepEqual(distance.list, { label: "Meters by meet", rows: [
        { title: "June 17", sub: "250 m individual · 50 m relays", value: "300 m" },
        { title: "June 10", sub: "200 m individual · 25 m relays", value: "225 m" }
    ] });
    assert.deepEqual([result.totals.meters, result.totals.individualMeters, result.totals.relayMeters], [525, 450, 75]);

    // Any meters at the latest meet change the pill, so it's New; a meet with only a DQ adds none.
    const relayOnly = badge(swimmerBadges(swims, [...legs, leg("m3", 11, "Girls 11-12 100m Freestyle Relay", 2)]), "distance");
    assert.deepEqual([relayOnly.pill, relayOnly.isNew, relayOnly.list.rows[0]], ["550 m", true, { title: "June 24", sub: "25 m relays", value: "25 m" }]);
    assert.equal(badge(swimmerBadges([...swims, swim("m3", 3, "Girls 11-12 100m Freestyle", { status: "DQ" })], legs), "distance").isNew, false);

    // Yards are converted, rounded meet by meet: six 100-yard swims are 549 m.
    assert.equal(eventMeters("Boys 13-14 100yd Freestyle"), 91.44);
    const yards = badge(swimmerBadges(["m1", "m2", "m3"].flatMap(m => [
        swim(m, 3, "Boys 13-14 100yd Freestyle", { place: 4, time: "1:10.00" }),
        swim(m, 7, "Boys 13-14 100yd Backstroke", { place: 4, time: "1:20.00" })
    ]), []), "distance");
    assert.deepEqual([yards.pill, yards.list.rows[0].value], ["549 m", "183 m"]);
    assertPillMatchesList(yards);
});

test("Podium: every top-3 finish, until Champion (a win, ties included) takes its place", () => {
    const podiums = swimmerBadges([
        swim("m1", 3, "Boys 9-10 50m Freestyle", { place: 2, time: "40.00", points: 4 }),
        swim("m2", 5, "Boys 9-10 50m Backstroke", { place: 3, time: "45.00", points: 3 }),
        swim("m2", 7, "Boys 9-10 50m Butterfly", { place: 4, time: "50.00", points: 2 })
    ], []);
    const podium = badge(podiums, "podium");
    assert.deepEqual([podium.pill, podium.meetId, podium.isNew], ["×2", "m2", true]);
    assert.deepEqual(podium.list, { label: "Finishes", rows: [
        { title: "50m Backstroke", sub: "June 17 · 45.00", value: "3rd" },
        { title: "50m Freestyle", sub: "June 10 · 40.00", value: "2nd" }
    ] });
    assert.equal(badge(podiums, "champion"), undefined);

    const one = badge(swimmerBadges([swim("m1", 3, "Boys 9-10 50m Freestyle", { place: 2, time: "40.00", points: 4 })], []), "podium");
    assert.deepEqual([one.pill, one.list.rows.length], [null, 1]);

    // A tie for first (stored as place 1, with the points split) is a win,
    // and Champion covers the later 2nd place too.
    const winner = swimmerBadges([
        swim("m1", 3, "Boys 9-10 50m Freestyle", { place: 1, time: "38.00", points: 5 }),
        swim("m2", 5, "Boys 9-10 50m Backstroke", { place: 2, time: "44.00", points: 4 })
    ], []);
    assert.equal(badge(winner, "podium"), undefined);
    const champion = badge(winner, "champion");
    assert.deepEqual([champion.pill, champion.meetId, champion.isNew], [null, "m1", false]);
    assert.deepEqual(champion.list, { label: "Wins", rows: [{ title: "50m Freestyle", sub: "June 10 · 38.00", value: "1st" }] });
});

test("Point Scorer: earned at 10 points, New whenever a meet adds points; the pill is the real total", () => {
    const EVENTS = ["Girls 13-14 50m Freestyle", "Girls 13-14 50m Backstroke", "Girls 13-14 50m Butterfly"];
    const PLACES = { 6: 1, 4: 2, 3.5: 2, 3: 3, 2: 4 }; // 3.5: tied for 2nd
    const meet = (meetId, ...points) => points.map((p, i) => swim(meetId, i + 1, EVENTS[i], { place: PLACES[p], time: "40.00", points: p }));

    assert.equal(badge(swimmerBadges(meet("m1", 6, 3), []), "scorer"), undefined, "9 points isn't enough");
    const atTen = badge(swimmerBadges(meet("m1", 6, 4), []), "scorer");
    assert.deepEqual([atTen.pill, atTen.meetId, atTen.isNew], ["10 pts", "m1", true]);

    const result = swimmerBadges([...meet("m1", 6, 4), ...meet("m2", 6, 6, 3), ...meet("m3", 3.5)], []);
    const scorer = badge(result, "scorer");
    assert.deepEqual([scorer.pill, scorer.meetId, scorer.isNew], ["28.5 pts", "m3", true]);
    assert.deepEqual(scorer.list, { label: "Points by meet", rows: [
        { title: "June 24", sub: "Scored in 1 event", value: "3.5 pts" },
        { title: "June 17", sub: "2 first places", value: "15 pts" },
        { title: "June 10", sub: "1 first place", value: "10 pts" }
    ] });
    assert.equal(result.totals.points, 28.5);

    // A later meet without points leaves it as it was; one point is "1 pt".
    const quiet = badge(swimmerBadges([...meet("m1", 6, 4), swim("m2", 1, EVENTS[0], { place: 6, time: "41.00" })], []), "scorer");
    assert.deepEqual([quiet.pill, quiet.isNew], ["10 pts", false]);
    const onePoint = badge(swimmerBadges([...meet("m1", 6, 4), swim("m2", 1, EVENTS[0], { place: 5, time: "41.00", points: 1 })], []), "scorer");
    assert.deepEqual([onePoint.pill, onePoint.list.rows[0].value], ["11 pts", "1 pt"]);
});

test("Triple Winner: 1st in all three individual events entered at a meet, listed by meet", () => {
    const EVENTS = ["Girls 13-14 50m Freestyle", "Girls 13-14 50m Butterfly", "Girls 13-14 50m Breaststroke"];
    const win = (meetId, i) => swim(meetId, i + 1, EVENTS[i], { place: 1, time: "35.00", points: 6 });
    const result = swimmerBadges([
        win("m1", 0), win("m1", 1), win("m1", 2),
        // A DQ in one of the three.
        win("m2", 0), win("m2", 1), swim("m2", 3, EVENTS[2], { status: "DQ" }),
        // Only two events entered.
        win("m3", 0), win("m3", 1),
        win("m4", 0), win("m4", 1), win("m4", 2)
    ], []);
    const triple = badge(result, "triple");
    assert.deepEqual([triple.pill, triple.meetId, triple.isNew], ["×2", "m4", true]);
    assert.deepEqual(triple.list, { label: "Meets", rows: [
        { title: "July 1", sub: "50m Free, Fly, Breast", value: "3 of 3" },
        { title: "June 10", sub: "50m Free, Fly, Breast", value: "3 of 3" }
    ] });
    assert.equal(badge(swimmerBadges([win("m1", 0), win("m1", 1), win("m1", 2)], []), "triple").pill, null);

    // A distance is written again when it changes.
    const mixed = badge(swimmerBadges([
        swim("m1", 1, "Girls 13-14 100m Freestyle", { place: 1, time: "1:10.00", points: 6 }),
        swim("m1", 2, "Girls 13-14 50m Butterfly", { place: 1, time: "35.00", points: 6 }),
        swim("m1", 3, "Girls 13-14 50m Breaststroke", { place: 1, time: "40.00", points: 6 })
    ], []), "triple");
    assert.equal(mixed.list.rows[0].sub, "100m Free, 50m Fly, Breast");
});

test("Relay Ready: every legal leg, exhibition ones too, listed by relay and age group", () => {
    const one = swimmerBadges([], [leg("m1", 11, "Boys 9-10 100m Freestyle Relay", 2)]);
    assert.deepEqual(ids(one), ["relay", "splash"]);
    assert.deepEqual([badge(one, "relay").pill, badge(one, "relay").list], [null, { label: "Relays", rows: [{ title: "100m Freestyle Relay · 9-10", sub: "June 10" }] }]);

    const result = swimmerBadges([], [
        leg("m1", 11, "Boys 9-10 100m Freestyle Relay", 2),
        leg("m1", 13, "Boys 9-10 125m Freestyle Relay", 1, { status: "EXH", place: null }),
        leg("m2", 11, "Boys 9-10 100m Medley Relay", 3, { status: "DQ", place: null }),
        leg("m3", 11, "Boys 12 & Under 100m Medley Relay", 1)
    ]);
    const relay = badge(result, "relay");
    assert.deepEqual([relay.pill, relay.meetId, relay.isNew], ["×3", "m3", true]);
    assert.deepEqual(relay.list.rows, [
        { title: "100m Medley Relay · 12 & under", sub: "June 24" },
        { title: "125m Freestyle Relay · 9-10", sub: "June 10" },
        { title: "100m Freestyle Relay · 9-10", sub: "June 10" }
    ]);
    // The DQ'd relay isn't a relay swum, but its meet still counts for Meet Attendance.
    assert.equal(result.totals.relayLegs, 3);
    assert.equal(result.totals.meetsSwum, 3);
});

test("Anchor: the last leg of a 100 relay, but not the 4th listed swimmer on a 125 relay", () => {
    const result = swimmerBadges([], [
        leg("m1", 11, "Girls 13-14 100m Freestyle Relay", 4),
        // Five swim a 125 relay, but the sheet lists only four.
        leg("m2", 13, "Girls 13-14 125m Freestyle Relay", 4),
        leg("m2", 11, "Girls 13-14 100m Medley Relay", 3)
    ]);
    const anchor = badge(result, "anchor");
    assert.deepEqual([anchor.pill, anchor.meetId, anchor.isNew], [null, "m1", false]);
    assert.deepEqual(anchor.list, { label: "Relays", rows: [{ title: "100m Freestyle Relay · 13-14", sub: "June 10" }] });

    const two = badge(swimmerBadges([], [
        leg("m1", 11, "Girls 13-14 100m Freestyle Relay", 4),
        leg("m2", 12, "Girls 13-14 100m Medley Relay", 4)
    ]), "anchor");
    assert.deepEqual([two.pill, two.list.rows.map(r => r.title)], ["×2", ["100m Medley Relay · 13-14", "100m Freestyle Relay · 13-14"]]);

    // With a name missing from the lineup, the last one listed isn't the anchor.
    assert.equal(badge(swimmerBadges([], [leg("m1", 11, "Girls 13-14 100m Freestyle Relay", 3, { listed: 3 })]), "anchor"), undefined);
});

test("Well-Rounded: legal swims in all four strokes; the IM, relays and DQs don't count", () => {
    const swims = [
        swim("m1", 1, "Boys 11-12 50m Freestyle", { place: 4, time: "35.00" }),
        swim("m1", 2, "Boys 11-12 50m Backstroke", { place: 4, time: "42.00" }),
        swim("m1", 3, "Boys 11-12 50m Breaststroke", { status: "DQ" }),
        swim("m2", 4, "Boys 11-12 100m IM", { place: 4, time: "1:30.00" }),
        swim("m2", 5, "Boys 11-12 50m Butterfly", { place: 4, time: "45.00" })
    ];
    assert.equal(badge(swimmerBadges(swims, [leg("m2", 11, "Boys 11-12 100m Medley Relay", 2)]), "rounded"), undefined);
    const result = swimmerBadges([...swims, swim("m3", 3, "Boys 11-12 50m Breaststroke", { place: 4, time: "48.00" })], []);
    const rounded = badge(result, "rounded");
    assert.deepEqual([rounded.pill, rounded.meetId, rounded.isNew], [null, "m3", true]);
    assert.equal(rounded.detail, "Swam freestyle, backstroke, breaststroke and butterfly");
});

test("Time Dropper: every drop below a seed time, earned once they add up to 10 s", () => {
    const swims = [
        swim("m1", 1, "Girls 9-10 50m Freestyle", { place: 4, seed: "45.00", time: "40.00" }),
        swim("m1", 2, "Girls 9-10 50m Backstroke", { place: 4, seed: "50.00", time: "45.50" }),
        // Slower than the seed: adds nothing.
        swim("m1", 3, "Girls 9-10 50m Breaststroke", { place: 4, seed: "55.00", time: "56.00" }),
        swim("m2", 1, "Girls 9-10 50m Freestyle", { place: 4, seed: "40.00", time: "39.00" }),
        swim("m3", 4, "Girls 9-10 100m IM", { place: 4, seed: "2:10.00", time: "1:50.00" })
    ];
    assert.equal(badge(swimmerBadges(swims.slice(0, 3), []), "dropper"), undefined, "9.50 s isn't enough");
    const atTen = badge(swimmerBadges(swims.slice(0, 4), []), "dropper");
    assert.deepEqual([atTen.pill, atTen.meetId, atTen.isNew], ["10.50s", "m2", true]);

    const result = swimmerBadges(swims, []);
    const dropper = badge(result, "dropper");
    assert.deepEqual([dropper.pill, dropper.meetId, dropper.isNew], ["30.50s", "m3", true]);
    assert.deepEqual(dropper.list, { label: "Drops", rows: [
        { title: "100m IM", sub: "June 24", value: "−20.00s" },
        { title: "50m Freestyle", sub: "June 17", value: "−1.00s" },
        { title: "50m Backstroke", sub: "June 10", value: "−4.50s" },
        { title: "50m Freestyle", sub: "June 10", value: "−5.00s" }
    ] });
    assert.equal(result.totals.timeDropped, 30.5);

    // A later meet without a drop leaves it as it was.
    const quiet = badge(swimmerBadges([...swims, swim("m4", 1, "Girls 9-10 50m Freestyle", { place: 4, seed: "39.00", time: "39.50" })], []), "dropper");
    assert.deepEqual([quiet.pill, quiet.isNew], ["30.50s", false]);
});

test("Time Dropper and Barrier Breaker leave out a seed converted from the other course", () => {
    const converted = { ...swim("m1", 1, "Girls 9-10 50m Freestyle", { place: 4, seed: "1:05.00", time: "50.00" }), seedConverted: true };
    const real = swim("m1", 2, "Girls 9-10 50m Backstroke", { place: 4, seed: "48.00", time: "47.00" });
    const result = swimmerBadges([converted, real], []);
    // Only the real seed's 1.00 s counts, and under 1:00 against a converted seed isn't a barrier broken.
    assert.equal(result.totals.timeDropped, 1);
    assert.equal(badge(result, "barrier"), undefined);
});

test("Meet Attendance: 2 or more meets swum, counting relay-only meets and DQs but not no-shows", () => {
    const first = swim("m1", 3, "Girls 9-10 25m Freestyle", { place: 2, time: "21.00" });
    assert.equal(badge(swimmerBadges([first], []), "attendance"), undefined, "the first meet is First Splash's");

    const result = swimmerBadges([
        first,
        swim("m1", 5, "Girls 9-10 25m Backstroke", { place: 3, time: "25.00" }),
        swim("m2", 3, "Girls 9-10 25m Freestyle", { status: "DQ" }),
        swim("m3", 3, "Girls 9-10 25m Freestyle", { status: "NS" }),
        swim("m5", 3, "Girls 9-10 25m Freestyle", { status: "NS" })
    ], [
        leg("m1", 11, "Girls 9-10 100m Freestyle Relay", 2),
        leg("m4", 11, "Girls 9-10 100m Freestyle Relay", 1)
    ]);
    const attendance = badge(result, "attendance");
    // m5 was a no-show, so July 1 is the swimmer's latest meet.
    assert.deepEqual([attendance.name, attendance.pill, attendance.meetId, attendance.isNew], ["Meet Attendance", "×3", "m4", true]);
    // No small line: the Stats page shows each meet's title ("at Curtis Park") from its meetId.
    assert.deepEqual(attendance.list, { label: "Meets", rows: [
        { title: "July 1", meetId: "m4", value: "1 swim" },
        { title: "June 17", meetId: "m2", value: "1 swim" },
        { title: "June 10", meetId: "m1", value: "3 swims" }
    ] });
    assert.equal(result.totals.meetsSwum, 3);
});

test("New: earned, or its pill changed, at the swimmer's latest meet", () => {
    const result = swimmerBadges([
        swim("m1", 1, "Boys 13-14 50m Freestyle", { place: 1, seed: "30.50", time: "29.80", points: 6 }),
        swim("m2", 2, "Boys 13-14 50m Backstroke", { place: 1, time: "35.00", points: 6 })
    ], []);
    // Champion's count went up, Point Scorer reached 10, and Meet Attendance
    // counted a second meet at m2. First Splash and Barrier Breaker are from
    // m1 (under 30s for the first time, though not a personal best: it was
    // the first swim in the event).
    assert.deepEqual(result.badges.map(b => [b.id, b.isNew]), [
        ["champion", true], ["scorer", true], ["attendance", true], ["barrier", false], ["splash", false]
    ]);
    assert.deepEqual(badge(result, "champion").list.rows, [
        { title: "50m Backstroke", sub: "June 17 · 35.00", value: "1st" },
        { title: "50m Freestyle", sub: "June 10 · 29.80", value: "1st" }
    ]);
});

test("every badge with a list has a pill that matches it", () => {
    const result = swimmerBadges([
        swim("m1", 1, "Girls 11-12 50m Freestyle", { place: 1, seed: "31.00", time: "30.10", points: 6 }),
        swim("m1", 2, "Girls 11-12 50m Backstroke", { place: 2, seed: "36.00", time: "35.50", points: 4 }),
        swim("m1", 3, "Girls 11-12 50m Butterfly", { place: 1, time: "33.00", points: 6 }),
        swim("m2", 1, "Girls 11-12 50m Freestyle", { place: 1, seed: "30.10", time: "29.50", points: 6 }),
        swim("m2", 2, "Girls 11-12 50m Backstroke", { place: 3, seed: "35.50", time: "35.20", points: 3 }),
        swim("m2", 4, "Girls 11-12 50m Breaststroke", { place: 1, seed: "40.00", time: "39.00", points: 6 }),
        swim("m3", 1, "Girls 11-12 50m Freestyle", { place: 1, time: "29.40", points: 6 }),
        swim("m3", 3, "Girls 11-12 50m Butterfly", { place: 1, seed: "33.00", time: "32.10", points: 6 }),
        swim("m3", 5, "Girls 11-12 100m IM", { place: 2, time: "1:20.00", points: 4 })
    ], [
        leg("m1", 11, "Girls 11-12 100m Freestyle Relay", 4),
        leg("m1", 12, "Girls 12 & Under 100m Medley Relay", 2),
        leg("m2", 11, "Girls 11-12 100m Freestyle Relay", 4),
        leg("m3", 12, "Girls 12 & Under 100m Medley Relay", 4)
    ]);
    const listed = result.badges.filter(b => b.list);
    assert.deepEqual(listed.map(b => b.id).sort(), ["anchor", "attendance", "champion", "distance", "pb", "relay", "scorer", "streak"]);
    for (const b of listed) assertPillMatchesList(b);
    assert.deepEqual(result.badges.filter(b => !b.list).map(b => b.id), ["barrier", "rounded", "splash"]);
});

test("rankBadges: New first, then the fixed ranking, with First Splash last", () => {
    const badges = ["splash", "relay", "pb", "attendance", "anchor", "scorer", "champion", "triple"].map(id => ({ id, isNew: ["relay", "scorer", "attendance"].includes(id) }));
    assert.deepEqual(rankBadges(badges).map(b => b.id), ["scorer", "relay", "attendance", "triple", "champion", "anchor", "pb", "splash"]);
    assert.equal(badges[0].id, "splash", "the list passed in is left as it was");
    // Every badge has its place in the ranking.
    assert.deepEqual([...BADGE_RANK].sort(), Object.keys(BADGE_INFO).sort());
});
