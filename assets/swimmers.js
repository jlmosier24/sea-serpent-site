// Spotswood Sea Serpents: the swimmer search and favorites shared by the home
// page and the Stats page. Styles live in /assets/site.css.
//
// Swimmers.mountSearch(box, { onPick }) fills box with "Find a swimmer": a
// search box where typing part of a first or last name lists the matches,
// grouped by age group (focusing the empty box lists everyone; arrow keys
// and Enter pick; Esc closes the list), and the Favorites under it.
//
// Favorites are swimmers starred on their Stats page, saved in this browser
// only -- nothing is sent anywhere.
//
// Load it after /assets/meets.js (for the name helpers) and WITHOUT defer.
(function () {
    "use strict";

    const { escapeHtml, displayName, initials } = Meets;

    /* ---------- Favorites ---------- */
    const FAVORITES_KEY = "seaSerpents.favorites";
    const FAVORITES_MAX = 8;
    const STAR = filled => `<svg viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`;

    function readFavorites() {
        try {
            const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
            return Array.isArray(saved) ? saved.filter(n => typeof n === "string") : [];
        } catch (e) {
            return [];
        }
    }
    function saveFavorites(list) {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
            return true;
        } catch (e) {
            return false; // private browsing or storage turned off: the star just doesn't stick
        }
    }

    // Adds or removes a swimmer: { on } after the change, or { problem } when
    // it couldn't be made (the list is full, or this browser won't save).
    function toggleFavorite(name) {
        const list = readFavorites();
        const on = list.includes(name);
        if (!on && list.length >= FAVORITES_MAX) return { problem: `Up to ${FAVORITES_MAX} favorites. Remove one to add another.` };
        if (!saveFavorites(on ? list.filter(n => n !== name) : [...list, name])) return { problem: "This browser isn't saving favorites." };
        return { on: !on };
    }

    // The star for a swimmer's header: "Add to favorites" or "Favorite".
    function favoriteButton(name) {
        const on = readFavorites().includes(name);
        return `<button type="button" class="fav-btn" data-name="${escapeHtml(name)}" aria-pressed="${on}">${STAR(on)}<span>${on ? "Favorite" : "Add to favorites"}</span></button>`;
    }

    /* ---------- Search ---------- */
    const AGE_GROUPS = [[6, "6 & under"], [8, "7-8"], [10, "9-10"], [12, "11-12"], [14, "13-14"], [Infinity, "15-18"]];
    const GROUP_ORDER = AGE_GROUPS.map(([, label]) => label).concat("Swimmers");
    const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
    const CLEAR_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    // The list shows names last name first, as the results sheets do and in
    // the order it's sorted, so a family's swimmers sit together: "Doe, Jane".
    function listName(name) {
        return name.replace(/\s*,\s*/, ", ");
    }

    // "Lu" in "Loe, Lucy" -> "Loe, <mark>Lu</mark>cy", escaped.
    function highlight(text, query) {
        const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
        if (at < 0) return escapeHtml(text);
        return escapeHtml(text.slice(0, at)) + `<mark>${escapeHtml(text.slice(at, at + query.length))}</mark>` + escapeHtml(text.slice(at + query.length));
    }

    // onPick(name) runs when a swimmer is chosen from the list or Favorites,
    // and with "" when the search is cleared. With labelledBy (a heading's id),
    // that heading names the box instead of the small "Find a swimmer" label.
    // Returns the search's controls.
    function mountSearch(box, { onPick, labelledBy = "" }) {
        box.innerHTML = `
            ${labelledBy ? "" : '<label class="picker-label" for="swimmerSearch">Find a swimmer</label>'}
            <div class="search">
                ${SEARCH_ICON}
                <input class="input" id="swimmerSearch" type="text"${labelledBy ? ` aria-labelledby="${escapeHtml(labelledBy)}"` : ""} role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="swimmerMatches" placeholder="Loading swimmers…" autocomplete="off" spellcheck="false" disabled>
                <button type="button" class="search-clear" aria-label="Clear the search" hidden>${CLEAR_ICON}</button>
            </div>
            <div class="matches" id="swimmerMatches" role="listbox" aria-label="Swimmers" hidden></div>
            <div class="favorites" hidden>
                <p class="picker-label" id="favoritesLabel">Favorites</p>
                <div class="fav-chips" role="list" aria-labelledby="favoritesLabel"></div>
            </div>`;
        const search = box.querySelector("#swimmerSearch");
        const matchesBox = box.querySelector("#swimmerMatches");
        const clear = box.querySelector(".search-clear");
        let swimmers = [];
        let ages = {};
        let shown = [];
        let active = -1;

        function ageGroup(name) {
            const age = ages[name];
            return age == null ? "Swimmers" : AGE_GROUPS.find(([upTo]) => age <= upTo)[1];
        }

        function setOpen(open) {
            matchesBox.hidden = !open;
            search.setAttribute("aria-expanded", String(open));
            if (!open) search.removeAttribute("aria-activedescendant");
            else fitList();
        }

        // The list only runs as far as the part of the screen you can see: on
        // a phone, that stops at the top of the keyboard (the visual viewport's
        // bottom), and the list scrolls inside that space.
        const LIST_MAX = 340;
        const LIST_MIN = 120;
        function fitList() {
            if (matchesBox.hidden) return;
            const view = window.visualViewport;
            const bottom = view ? view.offsetTop + view.height : window.innerHeight;
            const room = bottom - matchesBox.getBoundingClientRect().top - 12;
            matchesBox.style.maxHeight = `${Math.max(LIST_MIN, Math.min(LIST_MAX, Math.floor(room)))}px`;
        }
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", fitList);
            window.visualViewport.addEventListener("scroll", fitList);
        }
        window.addEventListener("scroll", fitList, { passive: true });

        function updateActive() {
            matchesBox.querySelectorAll(".match").forEach(el => el.setAttribute("aria-selected", String(Number(el.dataset.index) === active)));
            const option = box.querySelector(`#match${active}`);
            if (option) {
                search.setAttribute("aria-activedescendant", option.id);
                // Scroll the list, never the page, to keep the chosen name in view.
                const top = option.offsetTop; // from the list's top (it's positioned)
                if (top < matchesBox.scrollTop) matchesBox.scrollTop = top - 6;
                else if (top + option.offsetHeight > matchesBox.scrollTop + matchesBox.clientHeight) matchesBox.scrollTop = top + option.offsetHeight - matchesBox.clientHeight + 6;
            } else {
                search.removeAttribute("aria-activedescendant");
            }
        }

        function showMatches() {
            const query = search.value.trim();
            const words = query.toLowerCase().split(/\s+/).filter(Boolean);
            // Every word typed has to be in the name, in either order ("lu loe", "loe lu").
            shown = swimmers
                .filter(name => words.every(w => listName(name).toLowerCase().includes(w)))
                .sort((a, b) => GROUP_ORDER.indexOf(ageGroup(a)) - GROUP_ORDER.indexOf(ageGroup(b)) || a.localeCompare(b));
            active = query && shown.length ? 0 : -1;
            let lastGroup = null;
            matchesBox.innerHTML = shown.length
                ? shown.map((name, i) => {
                    const group = ageGroup(name);
                    const heading = group !== lastGroup ? `<p class="match-group" role="presentation">${escapeHtml(group)}</p>` : "";
                    lastGroup = group;
                    return `${heading}<div class="match" role="option" id="match${i}" data-index="${i}" aria-selected="${i === active}"><span class="name-avatar" aria-hidden="true">${escapeHtml(initials(name))}</span><span>${highlight(listName(name), words.length === 1 ? query : "")}</span></div>`;
                }).join("")
                : '<p class="match-none">No swimmers match that.</p>';
            setOpen(true);
            updateActive();
        }

        // Shows name in the box (or clears it) and tells the page.
        function pick(name) {
            showName(name);
            setOpen(false);
            onPick(name);
        }
        function showName(name) {
            search.value = name ? displayName(name) : "";
            clear.hidden = !name;
        }

        search.addEventListener("input", () => {
            clear.hidden = !search.value;
            showMatches();
        });
        search.addEventListener("focus", () => {
            if (swimmers.length) showMatches();
            bringToTop();
        });

        // On a phone, the keyboard takes the bottom half of the screen, so the
        // card with the search moves to the top, leaving the list room above
        // the keyboard. It waits a moment for the keyboard to come up.
        function bringToTop() {
            if (!matchMedia("(max-width: 600px) and (pointer: coarse)").matches) return;
            const card = box.closest(".card") || box;
            setTimeout(() => {
                const top = card.getBoundingClientRect().top + window.scrollY - 12;
                const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
                window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
            }, 250);
        }
        search.addEventListener("keydown", (event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (matchesBox.hidden) showMatches();
                if (!shown.length) return;
                active = (active + (event.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
                updateActive();
            } else if (event.key === "Enter") {
                if (active >= 0 && !matchesBox.hidden) {
                    event.preventDefault();
                    pick(shown[active]);
                }
            } else if (event.key === "Escape" && !matchesBox.hidden) {
                event.preventDefault();
                setOpen(false);
            }
        });
        // A press on a name picks it before the box loses focus and closes the list.
        matchesBox.addEventListener("pointerdown", (event) => event.preventDefault());
        matchesBox.addEventListener("click", (event) => {
            const match = event.target.closest(".match");
            if (!match) return;
            pick(shown[Number(match.dataset.index)]);
            // A tapped name is the end of the search: leaving the box closes a
            // phone's keyboard, which would otherwise cover what comes next.
            search.blur();
        });
        search.addEventListener("blur", () => setOpen(false));
        clear.addEventListener("click", () => {
            pick("");
            search.focus();
        });
        box.querySelector(".fav-chips").addEventListener("click", (event) => {
            const chip = event.target.closest(".fav-chip");
            if (chip) pick(chip.dataset.name);
        });

        function renderFavorites() {
            const list = readFavorites().filter(name => swimmers.includes(name));
            box.querySelector(".favorites").hidden = !list.length;
            box.querySelector(".fav-chips").innerHTML = list.map(name => `
                <span role="listitem"><button type="button" class="fav-chip" data-name="${escapeHtml(name)}"><span class="name-avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>${escapeHtml(displayName(name))}</button></span>`).join("");
        }

        return {
            // The list from /api/swimmerStats: { swimmers, ages }.
            setList(list) {
                swimmers = list.swimmers || [];
                ages = list.ages || {};
                search.disabled = !swimmers.length;
                search.placeholder = swimmers.length ? "Type a name…" : "No swimmers on record yet";
                renderFavorites();
            },
            failed() {
                search.placeholder = "Couldn't load swimmers";
            },
            showName,
            renderFavorites
        };
    }

    window.Swimmers = { mountSearch, favoriteButton, toggleFavorite, favorites: readFavorites };
})();
