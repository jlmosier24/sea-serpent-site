// Run from api/: npm test
// The badge rules in design/update-2/UPDATE.md, section 3, one at a time,
// with made-up swimmers.
const test = require("node:test");
const assert = require("node:assert/strict");
const { timeToSeconds } = require("../shared/meetResultsParser");
const { swimmerBadges, badgeRarity, rankBadges, eventMeters } = require("../shared/badges");
const { swimmerTotals } = require("../shared/stats");

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

test("First Splash: the first meet with a legal swim; DQs and no-shows earn nothing", () => {
    assert.deepEqual(swimmerBadges([swim("m1", 3, "Girls 9-10 25m Freestyle", { status: "DQ" })], []).badges, []);
    const result = swimmerBadges([
        swim("m1", 3, "Girls 9-10 25m Freestyle", { status: "DQ" }),
        swim("m1", 7, "Girls 9-10 25m Backstroke", { status: "NS" }),
        swim("m2", 3, "Girls 9-10 25m Freestyle", { place: 5, time: "24.10" })
    ], []);
    assert.deepEqual(result.badges, [{
        id: "splash", name: "First Splash", description: "Swam in a first meet with the Sea Serpents.",
        pill: null, sub: null, detail: "First meet of the season", meetId: "m2", meetDate: "2026-06-17", isNew: true
    }]);
    assert.equal(result.totals.meetsSwum, 1);
});

test("Personal Best: faster than the seed time or an earlier swim; a first swim with no seed has nothing to beat", () => {
    const swims = [
        swim("m1", 3, "Boys 11-12 50m Freestyle", { place: 4, time: "41.48" }),
        swim("m1", 7, "Boys 11-12 50m Backstroke", { place: 5, seed: "50.10", time: "50.30" }),
        swim("m2", 3, "Boys 11-12 50m Freestyle", { place: 4, seed: "41.48", time: "40.55" }),
        // Under the seed, and so under the slower swim before it too.
        swim("m2", 7, "Boys 11-12 50m Backstroke", { place: 4, seed: "50.10", time: "49.90" }),
        swim("m3", 3, "Boys 11-12 50m Freestyle", { place: 4, seed: "40.55", time: "40.80" })
    ];
    const result = swimmerBadges(swims, []);
    const pb = badge(result, "pb");
    // The badge tells the story of the first one.
    assert.deepEqual([pb.detail, pb.meetId, pb.pill, pb.isNew], ["50m Freestyle: 41.48 → 40.55", "m2", null, false]);
    assert.equal(result.totals.personalBests, 2);
    // The Stats page's swim tables mark the same swims.
    assert.equal(swimmerTotals(swims).personalBests, 2);
});

test("PB Streak: personal bests at meets in a row; a relay-only meet doesn't break the run, a meet without one does", () => {
    const free = (meetId, seed, time) => swim(meetId, 3, "Girls 11-12 50m Freestyle", { place: 4, seed, time });
    const result = swimmerBadges([
        free("m1", "40.00", "39.50"),
        free("m2", "39.50", "39.00"),
        free("m4", "39.00", "38.80"),
        free("m5", "38.80", "39.10"),
        free("m6", "38.80", "38.50")
    ], [leg("m3", 11, "Girls 11-12 100m Freestyle Relay", 2)]);
    const streak = badge(result, "streak");
    assert.deepEqual([streak.pill, streak.meetId, streak.isNew], ["×3", "m4", false]);
    assert.equal(streak.detail, "Personal bests at 3 meets in a row");
    // Two in a row earns it; one doesn't.
    assert.equal(badge(swimmerBadges([free("m1", "40.00", "39.50"), free("m2", "39.50", "39.00")], []), "streak").pill, "×2");
    assert.equal(badge(swimmerBadges([free("m1", "40.00", "39.50")], []), "streak"), undefined);
});

test("Barrier Breaker: the first time under 1:00, 40, 30 or 20 seconds, counting the seed time", () => {
    const fly = badge(swimmerBadges([swim("m1", 9, "Boys 11-12 50m Butterfly", { place: 2, seed: "1:06.24", time: "53.46" })], []), "barrier");
    assert.deepEqual([fly.sub, fly.pill, fly.detail], ["Under 1:00", null, "50m Butterfly: 1:06.24 → 53.46"]);

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

test("Distance Dynamo: meters from legal swims and relay legs (25 m each), earned at 500", () => {
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
    assert.equal(distance.detail, "525 meters raced: 450 m in individual events and 75 m on 3 relay legs. DQ swims don't count. Next level at 1,000 m, 475 m to go.");
    assert.deepEqual([result.totals.meters, result.totals.individualMeters, result.totals.relayMeters], [525, 450, 75]);

    // Yards are converted: six 100-yard swims are 549 m.
    assert.equal(eventMeters("Boys 13-14 100yd Freestyle"), 91.44);
    const yards = swimmerBadges(["m1", "m2", "m3"].flatMap(m => [
        swim(m, 3, "Boys 13-14 100yd Freestyle", { place: 4, time: "1:10.00" }),
        swim(m, 7, "Boys 13-14 100yd Backstroke", { place: 4, time: "1:20.00" })
    ]), []);
    assert.equal(badge(yards, "distance").pill, "549 m");
});

test("Podium: top-3 finishes, until Champion (a win, ties included) takes its place", () => {
    const podiums = swimmerBadges([
        swim("m1", 3, "Boys 9-10 50m Freestyle", { place: 2, time: "40.00", points: 4 }),
        swim("m2", 5, "Boys 9-10 50m Backstroke", { place: 3, time: "45.00", points: 3 }),
        swim("m2", 7, "Boys 9-10 50m Butterfly", { place: 4, time: "50.00", points: 2 })
    ], []);
    const podium = badge(podiums, "podium");
    assert.deepEqual([podium.pill, podium.meetId, podium.isNew], ["×2", "m2", true]);
    assert.equal(podium.detail, "2 top-3 finishes. Latest: 3rd · 50m Backstroke (45.00)");
    assert.equal(badge(podiums, "champion"), undefined);

    const one = badge(swimmerBadges([swim("m1", 3, "Boys 9-10 50m Freestyle", { place: 2, time: "40.00", points: 4 })], []), "podium");
    assert.deepEqual([one.pill, one.detail], [null, "2nd · 50m Freestyle (40.00)"]);

    // A tie for first (stored as place 1, with the points split) is a win,
    // and Champion covers the later 2nd place too.
    const winner = swimmerBadges([
        swim("m1", 3, "Boys 9-10 50m Freestyle", { place: 1, time: "38.00", points: 5 }),
        swim("m2", 5, "Boys 9-10 50m Backstroke", { place: 2, time: "44.00", points: 4 })
    ], []);
    assert.equal(badge(winner, "podium"), undefined);
    const champion = badge(winner, "champion");
    assert.deepEqual([champion.pill, champion.detail, champion.meetId, champion.isNew], [null, "Won 50m Freestyle (38.00)", "m1", false]);
});

test("Point Scorer: earned at 10 points, New again at 25, 50 and 100; the pill is the real total", () => {
    const EVENTS = ["Girls 13-14 50m Freestyle", "Girls 13-14 50m Backstroke", "Girls 13-14 50m Butterfly"];
    const PLACES = { 6: 1, 4: 2, 3.5: 2, 3: 3, 2: 4 }; // 3.5: tied for 2nd
    const meet = (meetId, ...points) => points.map((p, i) => swim(meetId, i + 1, EVENTS[i], { place: PLACES[p], time: "40.00", points: p }));

    assert.equal(badge(swimmerBadges(meet("m1", 6, 3), []), "scorer"), undefined, "9 points isn't enough");
    const atTen = badge(swimmerBadges(meet("m1", 6, 4), []), "scorer");
    assert.deepEqual([atTen.pill, atTen.meetId, atTen.isNew], ["10 pts", "m1", true]);
    const atTwentyFive = badge(swimmerBadges([...meet("m1", 6, 4), ...meet("m2", 6, 6, 3)], []), "scorer");
    assert.deepEqual([atTwentyFive.pill, atTwentyFive.meetId, atTwentyFive.isNew], ["25 pts", "m2", true]);

    // Past 25 but not yet 50: the count goes up, but it isn't New.
    const result = swimmerBadges([...meet("m1", 6, 4), ...meet("m2", 6, 6, 3), ...meet("m3", 3.5)], []);
    const scorer = badge(result, "scorer");
    assert.deepEqual([scorer.pill, scorer.meetId, scorer.isNew], ["28.5 pts", "m2", false]);
    assert.equal(scorer.detail, "28.5 team points so far. Next level at 50 points, 21.5 to go.");
    assert.equal(result.totals.points, 28.5);
});

test("Triple Winner: 1st in all three individual events entered at a meet", () => {
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
    assert.equal(triple.detail, "Won all 3 individual events at 2 meets");
    assert.equal(badge(swimmerBadges([win("m1", 0), win("m1", 1), win("m1", 2)], []), "triple").pill, null);
});

test("Relay Ready: every legal leg counts, exhibition ones too; one leg has no pill", () => {
    const one = swimmerBadges([], [leg("m1", 11, "Boys 9-10 100m Freestyle Relay", 2)]);
    assert.deepEqual(ids(one), ["splash", "relay"]);
    assert.deepEqual([badge(one, "relay").pill, badge(one, "relay").detail], [null, "Swam a relay leg"]);

    const result = swimmerBadges([], [
        leg("m1", 11, "Boys 9-10 100m Freestyle Relay", 2),
        leg("m1", 13, "Boys 9-10 125m Freestyle Relay", 1, { status: "EXH", place: null }),
        leg("m2", 11, "Boys 9-10 100m Medley Relay", 3, { status: "DQ", place: null }),
        leg("m3", 11, "Boys 9-10 100m Freestyle Relay", 1)
    ]);
    const relay = badge(result, "relay");
    assert.deepEqual([relay.pill, relay.meetId, relay.isNew], ["×3", "m3", true]);
    assert.equal(relay.detail, "Swam 3 relay legs: 2 on June 10, 1 on June 24");
    // A meet with only a relay is a meet swum; one with only a DQ'd relay isn't.
    assert.equal(result.totals.meetsSwum, 2);
});

test("Anchor: the last leg of a 100 relay, but not the 4th listed swimmer on a 125 relay", () => {
    const result = swimmerBadges([], [
        leg("m1", 11, "Girls 13-14 100m Freestyle Relay", 4),
        // Five swim a 125 relay, but the sheet lists only four.
        leg("m2", 13, "Girls 13-14 125m Freestyle Relay", 4),
        leg("m2", 11, "Girls 13-14 100m Medley Relay", 3)
    ]);
    const anchor = badge(result, "anchor");
    assert.deepEqual([anchor.pill, anchor.detail, anchor.meetId, anchor.isNew], [null, "Anchored the Girls 13-14 100m Freestyle Relay", "m1", false]);

    const two = badge(swimmerBadges([], [
        leg("m1", 11, "Girls 13-14 100m Freestyle Relay", 4),
        leg("m2", 12, "Girls 13-14 100m Medley Relay", 4)
    ]), "anchor");
    assert.deepEqual([two.pill, two.detail], ["×2", "Anchored 2 relays. Latest: Girls 13-14 100m Medley Relay"]);

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

test("Time Dropper: time dropped below seed times adds up to 10 s, and is New again at 30 s", () => {
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
    assert.equal(dropper.detail, "Total time dropped: 30.50 s. Next level at 60 s, 29.50 s to go.");
    assert.equal(result.totals.timeDropped, 30.5);
});

test("New: earned, counted up, or past a milestone at the swimmer's latest meet", () => {
    const result = swimmerBadges([
        swim("m1", 1, "Boys 13-14 50m Freestyle", { place: 1, seed: "30.50", time: "29.80", points: 6 }),
        swim("m2", 2, "Boys 13-14 50m Backstroke", { place: 1, time: "35.00", points: 6 })
    ], []);
    // Champion's count went up and Point Scorer reached 10 at m2; the rest were earned at m1.
    assert.deepEqual(result.badges.map(b => [b.id, b.isNew]), [
        ["splash", false], ["pb", false], ["barrier", false], ["champion", true], ["scorer", true]
    ]);
    const champion = badge(result, "champion");
    assert.deepEqual([champion.pill, champion.detail], ["×2", "2 wins. Latest: 50m Backstroke (35.00)"]);
});

test("rankBadges: New first, then the rarest, with First Splash always last; ties in catalog order", () => {
    const badges = ["splash", "relay", "pb", "anchor", "scorer", "champion"].map(id => ({ id, isNew: id === "champion" || id === "scorer" }));
    const rarity = { splash: 1, relay: 30, pb: 25, anchor: 3, scorer: 8, champion: 8 };
    assert.deepEqual(rankBadges(badges, rarity).map(b => b.id), ["champion", "scorer", "anchor", "pb", "relay", "splash"]);
    assert.deepEqual(rankBadges(badges).map(b => b.id), ["champion", "scorer", "pb", "relay", "anchor", "splash"]);
    assert.equal(badges[0].id, "splash", "the list passed in is left as it was");
});

test("badgeRarity counts the swimmers holding each badge", () => {
    assert.deepEqual(badgeRarity([[{ id: "splash" }, { id: "pb" }], [{ id: "splash" }], []]), { splash: 2, pb: 1 });
});
