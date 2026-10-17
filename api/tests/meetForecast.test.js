// Run from api/: npm test
// The meet card's forecast for the hours a meet runs, and /api/meetWeather's use of it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("./fakes");
const { meetForecast, meetHours } = require("../shared/meetForecast");
const meetWeather = require("../meetWeather/index.js");

// Hourly periods for 2026-07-13, 3pm to 11pm: [temperature, shortForecast, chance of rain].
function day(rows) {
    return rows.map(([temperature, shortForecast, pop], i) => ({
        startTime: `2026-07-13T${String(15 + i).padStart(2, "0")}:00:00-04:00`,
        temperature,
        temperatureUnit: "F",
        shortForecast,
        probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: pop }
    }));
}
const stormy = day([
    [86, "Sunny", 5], [85, "Mostly Sunny", 10], [84, "Partly Sunny", 15], [82, "Chance Showers And Thunderstorms", 30],
    [79, "Chance Showers And Thunderstorms", 40], [77, "Chance Showers And Thunderstorms", 35], [75, "Mostly Cloudy", 15], [73, "Mostly Cloudy", 10], [72, "Mostly Cloudy", 5]
]);
const meet = { date: "2026-07-13", warmUp: "17:00", time: "18:00" };

test("the meet's hours run from warm-up until four hours after the start", () => {
    assert.deepEqual(meetHours(stormy, meet).map(p => p.startTime.slice(11, 13)), ["17", "18", "19", "20", "21"]);
    assert.deepEqual(meetHours(stormy, { ...meet, warmUp: "17:15", time: "18:30" }).map(p => p.startTime.slice(11, 13)), ["17", "18", "19", "20", "21", "22"]);
    assert.deepEqual(meetHours(stormy, { ...meet, warmUp: "" }).map(p => p.startTime.slice(11, 13)), ["18", "19", "20", "21"]);
    assert.deepEqual(meetHours(stormy, { ...meet, date: "2026-07-14" }), []);
    assert.deepEqual(meetHours(stormy, { date: "2026-07-13", warmUp: "", time: "" }), []);
});

test("a stormy evening: warm-up temperature, the trend, and the likeliest hour", () => {
    const f = meetForecast(stormy, meet);
    assert.equal(f.temperature, 84);
    assert.equal(f.shortForecast, "Chance Showers And Thunderstorms");
    assert.equal(f.detailedForecast, "84° at warm-up, cooling to 75°. Storms possible, most likely around 7pm.");
});

test("without a warm-up time it reads from the start", () => {
    assert.equal(meetForecast(stormy, { ...meet, warmUp: "" }).detailedForecast, "82° at the start, cooling to 75°. Storms possible, most likely around 7pm.");
});

test("a dry evening, and rain without thunder at each chance", () => {
    const dry = day([[80, "Sunny", 0], [80, "Sunny", 0], [81, "Mostly Clear", 0], [80, "Mostly Clear", 0], [80, "Clear", 0], [79, "Clear", 0], [79, "Clear", 0]]);
    assert.equal(meetForecast(dry, meet).detailedForecast, "Around 81° through the meet. Mostly clear, no rain expected.");
    const rain = (pop) => day([[70, "Cloudy", 10], [70, "Cloudy", 10], [70, "Rain Showers", pop], [72, "Rain Showers", pop], [74, "Cloudy", 10], [74, "Cloudy", 10], [74, "Cloudy", 5]]);
    assert.equal(meetForecast(rain(70), meet).detailedForecast, "70° at warm-up, warming to 74°. Rain likely, mainly around 5pm.");
    assert.equal(meetForecast(rain(70), meet).shortForecast, "Rain Showers");
    assert.equal(meetForecast(rain(20), meet).detailedForecast, "70° at warm-up, warming to 74°. A slight chance of rain, mainly around 5pm.");
});

test("/api/meetWeather uses the hourly forecast when given the meet's times, else the day's", async (t) => {
    const daily = { properties: { periods: [{ name: "Monday", isDaytime: true, startTime: "2026-07-13T06:00:00-04:00", temperature: 88, temperatureUnit: "F", shortForecast: "Sunny", detailedForecast: "Sunny, with a high near 88." },
        { name: "Tuesday", isDaytime: true, startTime: "2026-07-14T06:00:00-04:00", temperature: 90, temperatureUnit: "F", shortForecast: "Hot", detailedForecast: "Hot, with a high near 90." }] } };
    const replies = {
        "https://api.weather.gov/points/38.0000,-77.0000": { properties: { forecast: "https://nws/daily", forecastHourly: "https://nws/hourly" } },
        "https://nws/daily": daily,
        "https://nws/hourly": { properties: { periods: stormy } }
    };
    t.mock.method(global, "fetch", async (url) => ({ ok: url in replies, json: async () => replies[url] }));
    const query = { lat: "38", lon: "-77", date: "2026-07-13" };

    const hourly = await call(meetWeather, { query: { ...query, warmUp: "17:00", time: "18:00" } });
    assert.equal(hourly.status, 200);
    assert.equal(hourly.body.detailedForecast, "84° at warm-up, cooling to 75°. Storms possible, most likely around 7pm.");

    const plain = await call(meetWeather, { query });
    assert.equal(plain.body.detailedForecast, "Sunny, with a high near 88.");

    // Past the hourly forecast's reach: the day's forecast.
    const later = await call(meetWeather, { query: { ...query, date: "2026-07-14", warmUp: "17:00", time: "18:00" } });
    assert.equal(later.body.detailedForecast, "Hot, with a high near 90.");
});
