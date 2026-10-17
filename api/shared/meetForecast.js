// The next meet's forecast for the hours it runs: from warm-up (or the start,
// when there's no warm-up time) until four hours after the start, read from
// the Weather Service's hourly forecast. Summed up in one line for the card,
// like "84° at warm-up, cooling to 75°. Storms possible, most likely around 7pm."
const MEET_HOURS = 4;

// "17:15" -> minutes after midnight, or null.
function minutesOf(time) {
    const m = String(time || "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// The hour a period starts, in the meet's own time zone: "2026-07-13T17:00:00-04:00" -> 17.
function hourOf(period) {
    return Number(String(period.startTime || "").slice(11, 13));
}

// The hourly periods the meet runs through, or [] when its times aren't set.
function meetHours(periods, { date, warmUp, time }) {
    const start = minutesOf(time);
    const from = minutesOf(warmUp) != null ? minutesOf(warmUp) : start;
    if (start == null || from == null) return [];
    const firstHour = Math.floor(from / 60);
    const endHour = Math.ceil((start + MEET_HOURS * 60) / 60); // not included
    return periods.filter(p => String(p.startTime || "").slice(0, 10) === date && hourOf(p) >= firstHour && hourOf(p) < endHour);
}

const STORMS = /thunder|t-storm/i;
const WET = /thunder|t-storm|rain|shower|drizzle/i;

function chanceOf(period) {
    const pop = period.probabilityOfPrecipitation;
    return (pop && pop.value != null) ? pop.value : 0;
}

// 19 -> "7pm"
function fmtHour(hour) {
    return `${hour % 12 || 12}${hour >= 12 ? "pm" : "am"}`;
}

function sentenceCase(text) {
    const lower = String(text || "").trim().toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// hours: the meet's hourly periods, in order. hasWarmUp: whether the first is warm-up or the start.
function summarize(hours, hasWarmUp) {
    const first = hours[0];
    const last = hours[hours.length - 1];
    const when = hasWarmUp ? "warm-up" : "the start";
    let temps;
    if (last.temperature <= first.temperature - 3) temps = `${first.temperature}° at ${when}, cooling to ${last.temperature}°.`;
    else if (last.temperature >= first.temperature + 3) temps = `${first.temperature}° at ${when}, warming to ${last.temperature}°.`;
    else temps = `Around ${first.temperature}° through the meet.`;

    const wet = hours.filter(p => WET.test(p.shortForecast || ""));
    if (!wet.length) {
        return { shortForecast: first.shortForecast, note: `${temps} ${sentenceCase(first.shortForecast)}, no rain expected.` };
    }
    const storms = wet.some(p => STORMS.test(p.shortForecast || ""));
    const kind = storms ? "storms" : "rain";
    // The wettest hour; the earlier one when two are the same.
    const peak = wet.reduce((best, p) => chanceOf(p) > chanceOf(best) ? p : best);
    const chance = chanceOf(peak);
    const at = fmtHour(hourOf(peak));
    let rain;
    if (chance >= 60) rain = `${sentenceCase(kind)} likely, mainly around ${at}.`;
    else if (chance >= 25) rain = `${sentenceCase(kind)} possible, most likely around ${at}.`;
    else rain = `A slight chance of ${kind}, mainly around ${at}.`;
    const worst = wet.find(p => STORMS.test(p.shortForecast || "")) || peak;
    return { shortForecast: worst.shortForecast, note: `${temps} ${rain}` };
}

// The card's forecast from the hourly periods, or null when the meet's hours
// aren't in them (times not set, or too far out for the hourly forecast).
function meetForecast(periods, meet) {
    const hours = meetHours(periods, meet);
    if (!hours.length) return null;
    const { shortForecast, note } = summarize(hours, minutesOf(meet.warmUp) != null);
    return {
        available: true,
        shortForecast,
        detailedForecast: note,
        temperature: hours[0].temperature,
        temperatureUnit: hours[0].temperatureUnit
    };
}

module.exports = { meetForecast, meetHours, summarize };
