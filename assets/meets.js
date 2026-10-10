// Spotswood Sea Serpents: shared by the public pages that show meets and
// swimmers -- date, time, and name formatting, which meets are upcoming or
// past, the meet cards (Home and Schedule), the meet results popup, and the
// full results list. Styles live in /assets/site.css.
//
// Load it after /assets/site.js and WITHOUT defer, so a page's own script
// at the end of <body> can already use window.Meets.
(function () {
    "use strict";

    const icon = (name, className) => SiteUI.icon(name, className);

    function escapeHtml(str) {
        // Quotes too, not just <>& -- output also lands inside attributes like alt="…".
        return (str == null ? "" : String(str))
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    // "2026-07-13" -> "July 13"
    function fmtDate(isoDate) {
        return isoDate ? new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "";
    }

    // "18:00" -> "6:00pm"
    function fmtClock(time) {
        if (!time) return "";
        const [hours, minutes] = time.split(":");
        const h = parseInt(hours, 10);
        return `${h % 12 || 12}:${minutes}${h >= 12 ? "pm" : "am"}`;
    }

    // 93.02 -> "1:33.02", 40.25 -> "40.25"
    function fmtSeconds(seconds) {
        if (seconds == null) return "";
        if (seconds < 60) return seconds.toFixed(2);
        const minutes = Math.floor(seconds / 60);
        return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
    }

    // Today on the team's own clock -- at 8pm EDT, UTC is already tomorrow.
    function easternToday() {
        return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    }

    function daysBetween(fromIsoDate, toIsoDate) {
        return Math.round((Date.parse(toIsoDate + "T00:00:00Z") - Date.parse(fromIsoDate + "T00:00:00Z")) / 86400000);
    }

    // Meet sheets list swimmers last name first: "Doe, Jr., John" -> "John Doe Jr.", initials "JD".
    function nameParts(name) {
        const parts = String(name || "").split(",").map(p => p.trim()).filter(Boolean);
        return parts.length < 2 ? { first: parts[0] || "", rest: [] } : { first: parts[parts.length - 1], rest: parts.slice(0, -1) };
    }
    function displayName(name) {
        const { first, rest } = nameParts(name);
        return [first, ...rest].join(" ");
    }
    function initials(name) {
        const { first, rest } = nameParts(name);
        return (([...first][0] || "") + ([...(rest[0] || "")][0] || "")).toUpperCase();
    }

    // Event names read "<gender> <age group> <distance> <stroke>" ("Girls 12 & Under
    // 100yd Freestyle"). Next to a swimmer's name, only the distance and stroke are needed.
    function shortEventName(eventName) {
        const m = String(eventName || "").match(/^.+?\s+(\d+(?:yd|m)\s+.+)$/);
        return m ? m[1] : eventName;
    }

    function plural(count, one, many) {
        return `${count} ${count === 1 ? one : many}`;
    }

    function hasScore(meet) {
        return meet.teamScore != null && meet.opponentScore != null;
    }

    // A meet has results once its sheet is imported or a score is typed in.
    function hasResults(meet) {
        return !!meet.resultsImported || hasScore(meet);
    }

    // "win", "loss", "tie", or null when the meet has no score.
    function outcome(meet) {
        if (!hasScore(meet)) return null;
        if (meet.teamScore > meet.opponentScore) return "win";
        return meet.teamScore < meet.opponentScore ? "loss" : "tie";
    }
    const OUTCOME_CHIPS = { win: "WIN", loss: "LOSS", tie: "TIE" };

    // Upcoming meets, soonest first, and past ones, newest first. A meet is
    // past once its day is over, or earlier that day once it has results.
    function splitMeets(meets) {
        const today = easternToday();
        const isPast = m => m.date < today || (m.date === today && hasResults(m));
        return {
            upcoming: meets.filter(m => !isPast(m)).sort((a, b) => a.date.localeCompare(b.date)),
            past: meets.filter(isPast).sort((a, b) => b.date.localeCompare(a.date))
        };
    }

    /* ---------- Upcoming meet card ---------- */
    // Fills a gold card (<article class="gold-card upcoming">) with an upcoming
    // meet: its date, name, pool, and times. The next meet also gets its
    // forecast, Directions, and Add to calendar.
    function showUpcoming(card, meet, { next = false } = {}) {
        // The pool's name, or its address when it has none; Directions needs the address.
        const where = meet.placeName || meet.address;
        const destination = meet.address || meet.placeName;
        card.innerHTML = `
            <div class="card-top">
                <span class="pill">${escapeHtml(fmtDate(meet.date))}</span>
                ${next ? '<span class="forecast" hidden></span>' : ""}
            </div>
            <h3>${escapeHtml(meet.title)}</h3>
            ${where ? `<p class="upcoming-line">${icon("pin")}${escapeHtml(where)}</p>` : ""}
            ${meetTimes(meet)}
            ${next ? `
                <p class="weather-note" hidden></p>
                <div class="btn-row">
                    ${destination ? `<a class="btn primary" href="https://www.google.com/maps/dir/?api=1&amp;destination=${encodeURIComponent(destination)}" target="_blank" rel="noopener">${icon("pin")}Directions</a>` : ""}
                    <button type="button" class="btn" data-add-to-calendar>${icon("calendar")}Add to calendar</button>
                </div>` : ""}`;
        if (!next) return;
        card.querySelector("[data-add-to-calendar]").addEventListener("click", () => downloadCalendarFile(meet));
        loadForecast(card, meet);
    }

    // "Warm-up: 5:15pm" and "Meet start: 6:00pm", each row left out when its time isn't set.
    function meetTimes(meet) {
        const rows = [meet.warmUp && ["clock", "Warm-up:", meet.warmUp], meet.time && ["flag", "Meet start:", meet.time]].filter(Boolean);
        if (!rows.length) return '<p class="upcoming-line">Times to be announced.</p>';
        return rows.map(([name, label, time]) => `<p class="upcoming-line">${icon(name)}<span class="time-label">${label}</span><b>${escapeHtml(fmtClock(time))}</b></p>`).join("");
    }

    /* ---------- Forecast ---------- */
    // The Weather Service forecasts about a week ahead.
    const FORECAST_DAYS = 7;

    function weatherIcon(shortForecast) {
        const text = shortForecast || "";
        if (/thunder|t-storm/i.test(text)) return icon("storm", "overcast");
        if (/rain|shower|drizzle/i.test(text)) return icon("rain", "overcast");
        if (/sunny|clear|fair|hot/i.test(text)) return icon("sun", "");
        return icon("cloud", "overcast");
    }

    // The card's forecast chip and note, or "Forecast soon" until the meet is
    // within a week. A meet with no map location gets neither.
    async function loadForecast(card, meet) {
        if (meet.lat == null || meet.lon == null) return;
        const chip = card.querySelector(".forecast");
        const note = card.querySelector(".weather-note");
        let forecast = null;
        if (daysBetween(easternToday(), meet.date) <= FORECAST_DAYS) {
            try {
                const res = await fetch(`/api/meetWeather?lat=${encodeURIComponent(meet.lat)}&lon=${encodeURIComponent(meet.lon)}&date=${encodeURIComponent(meet.date)}`);
                if (res.ok) forecast = await res.json();
            } catch (e) {
                // Shown as "Forecast soon" below.
            }
        }
        if (forecast && forecast.available) {
            // "Chance Showers And Thunderstorms then Mostly Sunny" is a lot for a chip;
            // the start of it fits, and the note below has the whole forecast.
            const conditions = (forecast.shortForecast || "").split(/\s+then\s+/i)[0];
            const summary = [forecast.temperature != null && `${forecast.temperature}°`, conditions].filter(Boolean).join(" · ");
            chip.className = "forecast";
            chip.innerHTML = `${weatherIcon(forecast.shortForecast)}<span>${escapeHtml(summary)}</span>`;
            note.textContent = forecast.detailedForecast || "";
        } else {
            chip.className = "forecast pending";
            chip.innerHTML = `${icon("clock", "")}<span>Forecast soon</span>`;
            note.textContent = "We'll show the forecast here a week before the meet.";
        }
        chip.hidden = false;
        note.hidden = !note.textContent;
    }

    /* ---------- Add to calendar ---------- */
    // Meets have no end time and calendars need one.
    const MEET_LENGTH_HOURS = 3;
    // Meet times are Eastern; the file spells out the zone's daylight-saving rules.
    const EASTERN_TIMEZONE = [
        "BEGIN:VTIMEZONE", "TZID:America/New_York",
        "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:20070311T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
        "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:20071104T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
        "END:VTIMEZONE"
    ];

    function icsText(value) {
        return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
    }

    // Calendar file lines stop at 75 bytes; a longer one continues on the next line after a space.
    function foldIcsLine(line) {
        const encoder = new TextEncoder();
        let folded = "";
        let bytes = 0;
        for (const ch of line) {
            const size = encoder.encode(ch).length;
            if (bytes + size > 75) {
                folded += "\r\n ";
                bytes = 1;
            }
            folded += ch;
            bytes += size;
        }
        return folded;
    }

    // "2026-07-22" at "18:00", plus `addHours` -> "20260722T180000" (a wall-clock time, not UTC).
    function icsDateTime(date, time, addHours = 0) {
        const [y, mo, d] = date.split("-").map(Number);
        const [h, mi] = time.split(":").map(Number);
        const t = new Date(Date.UTC(y, mo - 1, d, h + addHours, mi));
        return t.toISOString().slice(0, 16).replace(/[-:]/g, "") + "00";
    }

    function icsDate(date, addDays = 0) {
        const [y, mo, d] = date.split("-").map(Number);
        return new Date(Date.UTC(y, mo - 1, d + addDays)).toISOString().slice(0, 10).replace(/-/g, "");
    }

    function calendarFile(meet) {
        const when = meet.time
            ? [`DTSTART;TZID=America/New_York:${icsDateTime(meet.date, meet.time)}`, `DTEND;TZID=America/New_York:${icsDateTime(meet.date, meet.time, MEET_LENGTH_HOURS)}`]
            : [`DTSTART;VALUE=DATE:${icsDate(meet.date)}`, `DTEND;VALUE=DATE:${icsDate(meet.date, 1)}`];
        const location = [meet.placeName, meet.address].filter(Boolean).join(", ");
        const details = [meet.warmUp && `Warm-up at ${fmtClock(meet.warmUp)}.`, meet.time && `Meet starts at ${fmtClock(meet.time)}.`].filter(Boolean).join(" ");
        const lines = [
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Spotswood Sea Serpents//Meet schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
            ...(meet.time ? EASTERN_TIMEZONE : []),
            "BEGIN:VEVENT",
            `UID:${meet.id}@spotswood-sea-serpents`,
            `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`,
            ...when,
            `SUMMARY:${icsText(`Sea Serpents ${meet.title}`)}`,
            location && `LOCATION:${icsText(location)}`,
            details && `DESCRIPTION:${icsText(details)}`,
            "END:VEVENT", "END:VCALENDAR"
        ];
        return lines.filter(Boolean).map(foldIcsLine).join("\r\n") + "\r\n";
    }

    function downloadCalendarFile(meet) {
        const url = URL.createObjectURL(new Blob([calendarFile(meet)], { type: "text/calendar;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `sea-serpents-${meet.id}.ics`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /* ---------- Past meet card and rows ---------- */
    const TROPHY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Winner"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';

    // A past meet's card: green, or gray-green after a loss (never red).
    // "See team stats" carries data-meet-stats for the page to open the popup.
    function resultCard(meet) {
        const result = outcome(meet);
        const s = meet.summary;
        return `
            <article class="hero-card result-card${result === "loss" ? " loss" : ""}">
                <div class="card-top">
                    <span class="pill">${escapeHtml(fmtDate(meet.date))} · Final</span>
                    ${result ? `<span class="result-chip">${OUTCOME_CHIPS[result]}</span>` : ""}
                </div>
                <h3>${escapeHtml(meet.title)}</h3>
                ${result ? `
                    <p class="score-row us"><span>Spotswood ${escapeHtml(meet.teamScore)}</span>${result === "win" ? TROPHY : ""}</p>
                    <p class="score-row them"><span>${escapeHtml(meet.opponent)} ${escapeHtml(meet.opponentScore)}</span>${result === "loss" ? TROPHY : ""}</p>` : ""}
                ${s ? `<p class="quick-stats"><b>${s.firstPlaces}</b> ${s.firstPlaces === 1 ? "first place" : "first places"}<span class="sep" aria-hidden="true"></span><b>${s.relayWins}</b> ${s.relayWins === 1 ? "relay win" : "relay wins"}</p>` : ""}
                <div class="btn-row">
                    ${s ? `<button type="button" class="btn on-dark" data-meet-stats="${escapeHtml(meet.id)}">${icon("chart")}See team stats</button>` : ""}
                    <a class="btn ghost-on-dark" href="/gallery.html?meet=${encodeURIComponent(meet.id)}">${icon("camera")}View photos</a>
                </div>
            </article>`;
    }

    // "Won 550–473": the higher score first, whoever had it. "Final" without a score.
    function scoreLine(meet) {
        const result = outcome(meet);
        if (!result) return "Final";
        const verb = { win: "Won", loss: "Lost", tie: "Tied" }[result];
        return `${verb} ${Math.max(meet.teamScore, meet.opponentScore)}–${Math.min(meet.teamScore, meet.opponentScore)}`;
    }

    // An earlier meet as one row, which opens its popup when it has one.
    function miniRow(meet) {
        const text = `
            <span class="mini-dot" aria-hidden="true"></span>
            <span><span class="mini-title">${escapeHtml(meet.title)}</span><span class="mini-sub">${escapeHtml(`${fmtDate(meet.date)} · ${scoreLine(meet)}`)}</span></span>`;
        return meet.summary
            ? `<button type="button" class="mini" data-meet-stats="${escapeHtml(meet.id)}">${text}<span class="sr-only">, see team stats</span>${icon("chevron")}</button>`
            : `<div class="mini">${text}</div>`;
    }

    /* ---------- Meet results popup ---------- */
    const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    // Dialogs are built on first use, so pages don't each carry a copy of the markup.
    function makeDialog(id, closeLabel, wide) {
        let dialog = document.getElementById(id);
        if (dialog) return dialog;
        dialog = document.createElement("dialog");
        dialog.className = wide ? "dialog wide" : "dialog";
        dialog.id = id;
        dialog.setAttribute("aria-labelledby", `${id}Title`);
        dialog.innerHTML = `
            <div class="dialog-grab" aria-hidden="true"></div>
            <div class="dialog-head">
                <div><h2 id="${id}Title"></h2><p id="${id}When"></p></div>
                <button type="button" class="dialog-close" data-close-dialog aria-label="${closeLabel}">${CLOSE_ICON}</button>
            </div>
            <div class="dialog-body" id="${id}Body"></div>`;
        document.body.appendChild(dialog);
        return dialog;
    }

    // Opens a meet's popup from the numbers saved at import (meet.summary, from
    // /api/meets; api/shared/stats.js meetSummary). A meet without them has
    // nothing to show, so it doesn't open.
    function openResults(meet, opener) {
        if (!meet || !meet.summary) return;
        const s = meet.summary;
        const dialog = makeDialog("meetDialog", "Close meet results");
        dialog.querySelector("#meetDialogTitle").textContent = meet.title;
        dialog.querySelector("#meetDialogWhen").textContent = `${fmtDate(meet.date)} · Final`;
        const body = dialog.querySelector("#meetDialogBody");
        body.innerHTML = scoreBanner(meet) + statTiles(s) + seedCard(s) + pointsCard(s) + highlightCards(s) + `
            <button type="button" class="btn primary block view-all">View all swimmer results</button>`;
        body.querySelector(".view-all").addEventListener("click", (event) => openAllResults(meet, event.currentTarget));
        setUpPointsCard(body, s);
        SiteUI.openDialog(dialog, opener);
        body.scrollTop = 0; // only once it's showing; a hidden box keeps its old scroll position
    }

    function scoreBanner(meet) {
        const result = outcome(meet);
        if (!result) return "";
        return `
            <div class="score-banner${result === "loss" ? " loss" : ""}">
                <div>
                    <p class="banner-label">Final team score</p>
                    <p class="banner-us">Spotswood ${escapeHtml(meet.teamScore)}</p>
                    <p class="banner-them">${escapeHtml(meet.opponent)} ${escapeHtml(meet.opponentScore)}</p>
                </div>
                <span class="banner-chip">${OUTCOME_CHIPS[result]}</span>
            </div>`;
    }

    // 176.29 -> "2:56" once it's over a minute; 42.5 -> "42.5s".
    function fmtDropped(seconds) {
        if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
        const whole = Math.round(seconds);
        return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
    }

    function statTiles(s) {
        const tile = (label, value, caption) => `<div class="stat-tile"><p class="stat-label">${label}</p><p class="stat-value">${escapeHtml(value)}</p><p class="stat-caption">${escapeHtml(caption)}</p></div>`;
        // A personal best beats an earlier swim in the event, so a meet with none to beat (the first one) says so.
        const bestsCaption = s.comparableSwims ? `by ${plural(s.personalBestSwimmers, "swimmer", "swimmers")}` : "No earlier swims to beat";
        return `
            <div class="stat-grid">
                ${tile("Top-3 finishes", s.topThree, `${s.firstPlaces} ${s.firstPlaces === 1 ? "was" : "were"} 1st`)}
                ${tile("Personal bests", s.personalBests || 0, bestsCaption)}
                ${tile("Point scorers", s.pointScorers || 0, `of ${plural(s.swimmersRaced || 0, "swimmer", "swimmers")}`)}
                ${tile("Time dropped", fmtDropped(s.timeDropped || 0), "off best times")}
            </div>`;
    }

    function seedCard(s) {
        if (!s.timedWithSeed) return "";
        const pct = Math.round(s.fasterThanSeed / s.timedWithSeed * 100);
        return `
            <div class="inset seed-card">
                <div class="seed-ring" style="--pct: ${pct}"><span>${pct}%</span></div>
                <div><h3>Swims faster than seed</h3><p>${s.fasterThanSeed} of ${plural(s.timedWithSeed, "timed swim", "timed swims")} beat the swimmer's seed time.</p></div>
            </div>`;
    }

    /* ---------- Points by age group card ---------- */
    // Spotswood's points by age group, for the whole team or boys or girls
    // only (design/update-5/UPDATE.md, section 5). All adds up to the team
    // score; each row's share is of its own tab's total. The biggest age group
    // gets the gold bar; Mixed relays span ages, so it doesn't compete for it.
    const POINTS_TABS = [["all", "All"], ["boys", "Boys"], ["girls", "Girls"]];
    const fmtPoints = points => String(Math.round(points * 100) / 100);

    function pointsCard(s) {
        if (!s.pointsBy || !s.pointsBy.all) return "";
        return `
            <section class="inset points-card" aria-labelledby="pointsTitle">
                <h3 id="pointsTitle">Points by age group</h3>
                <div class="points-tabs" role="tablist" aria-labelledby="pointsTitle">
                    ${POINTS_TABS.map(([key, label], i) => `<button type="button" role="tab" id="pointsTab-${key}" data-tab="${key}" aria-controls="pointsPanel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${label}</button>`).join("")}
                </div>
                <div class="points-panel" id="pointsPanel" role="tabpanel" aria-labelledby="pointsTab-all">
                    <ul class="points-bars"></ul>
                </div>
            </section>`;
    }

    function pointsRows(rows) {
        const total = rows.reduce((n, r) => n + r.points, 0);
        const most = Math.max(0, ...rows.map(r => r.points));
        const gold = Math.max(0, ...rows.filter(r => r.label !== "Mixed relays").map(r => r.points));
        return rows.map(r => {
            const pct = total ? Math.round(r.points / total * 100) : 0;
            const top = gold > 0 && r.points === gold && r.label !== "Mixed relays";
            return `
                <li class="points-row${top ? " top" : ""}">
                    <span class="points-label">${escapeHtml(r.label)}</span>
                    <span class="points-track"><span class="points-bar" style="--w: ${most ? r.points / most : 0}"></span><span class="points-value">${fmtPoints(r.points)}</span><span class="points-pct">${pct}%</span>${top ? '<span class="sr-only">, most points</span>' : ""}</span>
                </li>`;
        }).join("");
    }

    // Tabs follow the usual keyboard pattern (arrow keys, Home, End).
    function setUpPointsCard(body, s) {
        const card = body.querySelector(".points-card");
        if (!card) return;
        const tablist = card.querySelector('[role="tablist"]');
        const tabs = [...tablist.querySelectorAll('[role="tab"]')];
        const panel = card.querySelector('[role="tabpanel"]');
        const list = panel.querySelector(".points-bars");

        function select(tab, focus) {
            tabs.forEach(t => {
                const on = t === tab;
                t.setAttribute("aria-selected", String(on));
                t.tabIndex = on ? 0 : -1;
            });
            panel.setAttribute("aria-labelledby", tab.id);
            list.innerHTML = pointsRows(s.pointsBy[tab.dataset.tab] || []);
            if (focus) tab.focus();
        }

        tablist.addEventListener("click", (event) => {
            const tab = event.target.closest('[role="tab"]');
            if (tab) select(tab);
        });
        tablist.addEventListener("keydown", (event) => {
            const i = tabs.indexOf(document.activeElement);
            const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
            if (i < 0 || next === undefined) return;
            event.preventDefault();
            select(tabs[(next + tabs.length) % tabs.length], true);
        });
        select(tabs[0]);
    }

    /* ---------- Highlight cards ---------- */
    // Triple winners (or, when there are none, the top point scorers), then the
    // biggest time drop in each age group (design/update-5/UPDATE.md, sections
    // 2 to 4). A card shows only when something qualifies, with every tie listed.
    const HL_TROPHY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 20h8"/></svg>';
    const HL_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>';

    function highlightCard(title, iconHtml, rows) {
        if (!rows.length) return "";
        return `
            <section class="inset hl-card">
                <h3 class="hl-card-title">${escapeHtml(title)}${iconHtml}</h3>
                <ul class="hl-list">${rows.join("")}</ul>
            </section>`;
    }
    // A name, a grey line under it, and an optional value on the right.
    const hlRow = (name, lineHtml, value) => `
        <li><div class="hl-who"><p class="hl-name">${escapeHtml(displayName(name))}</p>${lineHtml ? `<p class="hl-line">${lineHtml}</p>` : ""}</div>${value ? `<span class="hl-value">${escapeHtml(value)}</span>` : ""}</li>`;

    function highlightCards(s) {
        const h = s.highlights || {};
        const triples = h.tripleWinners || [];
        const scorers = h.topScorers || [];
        const drops = h.biggestDrops || [];
        const pts = points => `${fmtPoints(points)} ${points === 1 ? "pt" : "pts"}`;
        return highlightCard(triples.length === 1 ? "Triple winner" : "Triple winners", `<span class="hl-icon">${HL_TROPHY}</span>`,
                triples.map(t => hlRow(t.name, escapeHtml((t.events || []).join(" · ")))))
            + (triples.length ? "" : highlightCard("Top point scorers", `<span class="hl-icon star">${HL_STAR}</span>`,
                scorers.map(p => hlRow(p.name, "", pts(p.points)))))
            + highlightCard(drops.length === 1 ? "Biggest time drop" : "Biggest time drops", "",
                drops.map(d => hlRow(d.name, `<b>${escapeHtml(d.group)}</b> · ${escapeHtml(shortEventName(d.eventName))}`, `−${d.seconds.toFixed(2)}s`)));
    }

    /* ---------- Full results list ---------- */
    // Every result at a meet, both teams, event by event (/api/resultsByMeet).
    // It opens on top of the meet popup, so closing it goes back there. A meet
    // has hundreds of rows, so they're loaded only when asked for.
    const allResults = new Map(); // meet id -> { individual, relays }
    const STATUS_TEXT = { DQ: "DQ", NS: "Did not swim", DNF: "Did not finish" };

    async function openAllResults(meet, opener) {
        const dialog = makeDialog("allResultsDialog", "Close all results", true);
        dialog.querySelector("#allResultsDialogTitle").textContent = meet.title;
        dialog.querySelector("#allResultsDialogWhen").textContent = `${fmtDate(meet.date)} · All results`;
        dialog.dataset.meet = meet.id;
        const body = dialog.querySelector("#allResultsDialogBody");
        body.innerHTML = '<p class="results-note">Loading results…</p>';
        SiteUI.openDialog(dialog, opener);
        body.scrollTop = 0;

        let results = allResults.get(meet.id);
        if (!results) {
            try {
                const res = await fetch(`/api/resultsByMeet?meetId=${encodeURIComponent(meet.id)}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                results = await res.json();
                allResults.set(meet.id, results);
            } catch (e) {
                if (dialog.dataset.meet === meet.id) body.innerHTML = '<p class="results-note">Couldn\'t load the results right now.</p>';
                return;
            }
        }
        if (dialog.dataset.meet !== meet.id) return; // another meet's list was opened meanwhile
        const events = resultsByEvent(results.individual, results.relays);
        body.innerHTML = events.length ? events.map(eventResults).join("") : '<p class="results-note">No results yet.</p>';
    }

    // Individual and relay events share one numbering in the sheet (a relay can
    // be event 3 with individual events on either side), so they're grouped by
    // event number across both to read in the sheet's order.
    function resultsByEvent(individual, relays) {
        const byEvent = new Map();
        const add = (row, relay) => {
            if (!byEvent.has(row.eventNumber)) byEvent.set(row.eventNumber, { eventNumber: row.eventNumber, eventName: row.eventName, relay, rows: [] });
            byEvent.get(row.eventNumber).rows.push(row);
        };
        individual.forEach(row => add(row, false));
        relays.forEach(row => add(row, true));
        const events = [...byEvent.values()].sort((a, b) => a.eventNumber - b.eventNumber);
        // No place (a DQ, or an exhibition swim, which isn't scored) sorts after
        // everyone who placed, rather than first as 0 would.
        events.forEach(e => e.rows.sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity)));
        return events;
    }

    function eventResults(event) {
        const id = `allResultsEvent${event.eventNumber}`;
        const head = event.relay
            ? '<th scope="col">Place</th><th scope="col" class="relay-team">Team</th><th scope="col">Swimmers</th><th scope="col" class="r">Time</th>'
            : '<th scope="col">Place</th><th scope="col">Swimmer</th><th scope="col">Team</th><th scope="col" class="r">Time</th>';
        const rows = event.rows.map(row => event.relay
            ? `<tr><td>${escapeHtml(row.place ?? "")}</td><td>${escapeHtml(row.team)} (${escapeHtml(row.relayLetter)})</td><td>${relaySwimmers(row.swimmers || [])}</td><td class="r">${resultTime(row)}</td></tr>`
            : `<tr><td>${escapeHtml(row.place ?? "")}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.team)}</td><td class="r">${resultTime(row)}</td></tr>`).join("");
        return `
            <section class="event-results">
                <h3 id="${id}"><span class="event-number">#${escapeHtml(event.eventNumber)}</span> ${escapeHtml(event.eventName)}</h3>
                <table class="results-table" aria-labelledby="${id}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
            </section>`;
    }

    // "Doe, Jane; Poe, Sam; ...": "; " between swimmers, since each name has a
    // comma, and each name kept on one line when it fits.
    function relaySwimmers(swimmers) {
        return swimmers.map((s, i) => `<span class="relay-swimmer">${escapeHtml(s.name)}${i < swimmers.length - 1 ? ";" : ""}</span>`).join(" ");
    }

    // The time, or why there isn't one. An exhibition swim is timed but not scored.
    function resultTime(row) {
        if (STATUS_TEXT[row.status]) return escapeHtml(STATUS_TEXT[row.status]);
        const time = escapeHtml(row.officialTime);
        return row.status === "EXH" ? `${time}<span class="results-exh">Exhibition</span>` : time;
    }

    window.Meets = {
        escapeHtml, fmtDate, fmtClock, fmtSeconds, easternToday, displayName, initials, shortEventName, plural,
        hasScore, hasResults, outcome, OUTCOME_CHIPS, splitMeets,
        showUpcoming, resultCard, miniRow, openResults, openAllResults
    };
})();
