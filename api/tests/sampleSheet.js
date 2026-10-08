// A made-up results sheet in Meet Maestro's text layout (every name is
// invented), shared by the parser, stats, and import tests. sheetText()
// rebuilds it with another date or without some rows.
const HEADER = date => `Results 2026 Spotswood at Test Seahawks — ${date} Page 1 of 2`;

const INDIVIDUAL = [
    "1 Doe, Jane 8 Spotswood 25.10 24.50 6",
    "2* Roe, Rachel 8 Test Seahawks 26.00 25.90 3.5",
    "2* Poe, Sam 7 Spotswood NT 25.90 3.5",
    "-- Moe, Max 8 Test Seahawks 27.00 DQ",
    "DQ: 3J Touch: One hand",
    "7T Other - Misc",
    "SwimTopia Meet Maestro™ Download the SwimTopia Mobile App for Live Results & More Printed 07/13/26 11:45 PM",
    "Results 2026 Spotswood at Test Seahawks — Jul 13, 2026 Page 2 of 2",
    "-- Loe, Liz 8 Spotswood 28.00 NS",
    "X Koe, Kim EXH 8 Spotswood NT 30.10",
    "-- Joe, Jo 8 Spotswood 31.00 DNF",
    "5 Voe., Val 8 Test Seahawks 29.00 28.00 1"
];

const RELAYS = [
    "1 Spotswood A S 1:50.00 1:45.88 8",
    "1) Doe, Jane (8) 2) Poe, Sam (7) 3) Koe, Kim (8) 4) Loe, Liz (8)",
    "-- Test Seahawks A TS 1:52.00 DQ",
    "1) Roe, Rachel (8) 2) Moe, Max (8) 3) Fake, Ann (8) 4) Fake, Bea (8)",
    "DQ: 6H Early take-off swimmer #4",
    "X Spotswood EXH C S 2:39.02 DQ",
    "1) Aye, Al (8) 2) Bee, Bo (8) 3) Cee, Cy (8) 4) Dee, Di (8)",
    "DQ: 6F Early take-off swimmer #2"
];

const TEAM_SCORES = [
    "Team Scores (for scored and filtered events)",
    "Combined Team Scores -- Through Event 68",
    "Rank Team Combined",
    "1 Spotswood S 525",
    "2 Test Seahawks TS 511",
    "Total 1036"
];

// course: "m" for a meters pool, "yd" for a yards one.
function sheetText({ date = "Jul 13, 2026", individual = INDIVIDUAL, relays = RELAYS, teamScores = true, course = "m" } = {}) {
    return [
        HEADER(date),
        `#1 Girls 8 & Under 25${course} Freestyle Girls 8 & Under`,
        "Pl Name Age Team Seed Official Pts",
        ...individual,
        `#5 Girls 8 & Under 100${course} Freestyle Relay Girls 8 & Under`,
        "Pl Team Relay Seed Official Pts",
        ...relays,
        ...(teamScores ? TEAM_SCORES : [])
    ].join("\n");
}

module.exports = { SHEET: sheetText(), sheetText, INDIVIDUAL, RELAYS };
