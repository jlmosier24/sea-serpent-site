// Spotswood Sea Serpents: shared by the public pages that show meets and
// swimmers -- date, time, and name formatting, a meet's outcome, and the meet
// results popup. Styles live in /assets/site.css.
//
// Load it after /assets/site.js and WITHOUT defer, so a page's own script
// at the end of <body> can already use window.Meets.
(function () {
    "use strict";

    function escapeHtml(str) {
        // Quotes too, not just <>& -- output also lands inside attributes like alt="…".
        return (str == null ? "" : String(str))
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    // "2026-07-13" -> "July 13"
    function fmtDate(isoDate) {
        return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" });
    }

    // "2026-07-13" -> "Jul 13"
    function fmtShortDate(isoDate) {
        return isoDate ? new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    }

    // 93.02 -> "1:33.02", 40.25 -> "40.25"
    function fmtSeconds(seconds) {
        if (seconds == null) return "";
        if (seconds < 60) return seconds.toFixed(2);
        const minutes = Math.floor(seconds / 60);
        return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
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

    // "win", "loss", "tie", or null when the meet has no score.
    function outcome(meet) {
        if (!hasScore(meet)) return null;
        if (meet.teamScore > meet.opponentScore) return "win";
        return meet.teamScore < meet.opponentScore ? "loss" : "tie";
    }
    const OUTCOME_CHIPS = { win: "WIN", loss: "LOSS", tie: "TIE" };

    /* ---------- Meet results popup ---------- */
    const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    // Built on first use, so pages don't each carry a copy of the markup.
    function resultsDialog() {
        let dialog = document.getElementById("meetDialog");
        if (dialog) return dialog;
        dialog = document.createElement("dialog");
        dialog.className = "dialog";
        dialog.id = "meetDialog";
        dialog.setAttribute("aria-labelledby", "meetDialogTitle");
        dialog.innerHTML = `
            <div class="dialog-grab" aria-hidden="true"></div>
            <div class="dialog-head">
                <div><h2 id="meetDialogTitle"></h2><p id="meetDialogWhen"></p></div>
                <button type="button" class="dialog-close" data-close-dialog aria-label="Close meet results">${CLOSE_ICON}</button>
            </div>
            <div class="dialog-body" id="meetDialogBody"></div>`;
        document.body.appendChild(dialog);
        return dialog;
    }

    // Opens a meet's popup from the numbers saved at import (meet.summary, from
    // /api/meets). A meet without them has nothing to show, so it doesn't open.
    function openResults(meet, opener) {
        if (!meet || !meet.summary) return;
        const s = meet.summary;
        const dialog = resultsDialog();
        dialog.querySelector("#meetDialogTitle").textContent = meet.title;
        dialog.querySelector("#meetDialogWhen").textContent = `${fmtDate(meet.date)} · Final`;
        const body = dialog.querySelector("#meetDialogBody");
        body.innerHTML = scoreBanner(meet) + statTiles(s) + seedCard(s) + dropCard(s.biggestDrop) + `
            <p class="meet-foot">Individual and relay results from the official meet sheet. Biggest drop is the largest percent improvement over seed among swimmers age 7 and up.</p>
            <button type="button" class="btn primary block view-all" disabled>View all swimmer results</button>`;
        SiteUI.openDialog(dialog, opener);
        body.scrollTop = 0; // only once it's showing; a hidden box keeps its old scroll position
    }

    function scoreBanner(meet) {
        const result = outcome(meet);
        if (!result) return "";
        const label = result === "loss" ? `Final team score · lost by ${Math.abs(meet.teamScore - meet.opponentScore)}` : "Final team score";
        return `
            <div class="score-banner${result === "loss" ? " loss" : ""}">
                <div>
                    <p class="banner-label">${escapeHtml(label)}</p>
                    <p class="banner-us">Spotswood ${escapeHtml(meet.teamScore)}</p>
                    <p class="banner-them">${escapeHtml(meet.opponent)} ${escapeHtml(meet.opponentScore)}</p>
                </div>
                <span class="banner-chip">${OUTCOME_CHIPS[result]}</span>
            </div>`;
    }

    function statTiles(s) {
        const tile = (label, value, caption) => `<div class="stat-tile"><p class="stat-label">${label}</p><p class="stat-value">${escapeHtml(value)}</p><p class="stat-caption">${caption}</p></div>`;
        return `
            <div class="stat-grid">
                ${tile("1st places", s.firstPlaces, "Individual events")}
                ${tile("Relay wins", `${s.relayWins} of ${s.relayEvents}`, "Relays won")}
                ${tile("Top-3 finishes", s.topThree, "Individual podiums")}
                ${tile("First-time swims", s.firstTimeSwims, "No seed time on file")}
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

    function dropCard(drop) {
        if (!drop) return "";
        return `
            <div class="gold-card drop-card">
                <p class="drop-eyebrow">Biggest drop of the meet</p>
                <div class="drop-who">
                    <span class="drop-avatar" aria-hidden="true">${escapeHtml(initials(drop.name))}</span>
                    <div class="drop-name">
                        <p class="drop-swimmer">${escapeHtml(displayName(drop.name))}</p>
                        <p class="drop-detail">${escapeHtml(shortEventName(drop.eventName))}${drop.age != null ? ` · age ${escapeHtml(drop.age)}` : ""}</p>
                    </div>
                    <div class="drop-times">
                        <p class="drop-delta">−${drop.seconds.toFixed(2)}s</p>
                        <p class="drop-detail">${escapeHtml(drop.seedTime)} → ${escapeHtml(drop.officialTime)} · ${(drop.percent * 100).toFixed(1)}%</p>
                    </div>
                </div>
            </div>`;
    }

    window.Meets = {
        escapeHtml, fmtDate, fmtShortDate, fmtSeconds, displayName, initials, shortEventName, plural,
        hasScore, outcome, OUTCOME_CHIPS, openResults
    };
})();
