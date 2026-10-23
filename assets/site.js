// Spotswood Sea Serpents: shared behavior for every page -- the site header,
// icons, dialogs, and file drop zones. Styles live in /assets/site.css.
//
// Load it in <head> WITHOUT defer: <site-header> is then already defined when
// the parser reaches it, so it renders with the rest of the page instead of
// popping in a moment later.
(function () {
    "use strict";

    const NAV_LINKS = [
        { key: "home", href: "/", label: "Home" },
        { key: "schedule", href: "/schedule.html", label: "Schedule" },
        { key: "gallery", href: "/gallery.html", label: "Photos" },
        { key: "stats", href: "/stats.html", label: "Stats" }
    ];
    const MENU_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    // <site-header current="gallery"></site-header> marks that page's link as
    // the current one; <site-header admin></site-header> is the admin variant
    // (its own name, no public nav).
    class SiteHeader extends HTMLElement {
        connectedCallback() {
            if (this.firstElementChild) return; // already rendered; connectedCallback reruns if the element moves
            const admin = this.hasAttribute("admin");
            const current = this.getAttribute("current");
            const nav = admin ? "" : `
                <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="site-nav" aria-label="Menu">${MENU_ICON}</button>
                <nav class="site-nav" id="site-nav" aria-label="Main">
                    ${NAV_LINKS.map(link => `<a href="${link.href}"${link.key === current ? ' aria-current="page"' : ""}>${link.label}</a>`).join("")}
                </nav>`;
            this.innerHTML = `
                <header class="site-header">
                    <div class="wrap">
                        <a class="brand" href="/"><img src="/assets/logo.png" alt="" width="39" height="26"><span class="brand-name">${admin ? "Sea Serpents Admin" : "Spotswood Sea Serpents"}</span></a>
                        ${nav}
                    </div>
                </header>`;
            if (!admin) setUpMenu(this);
        }
    }

    // The phone menu: the toggle opens it; Esc, a tap elsewhere, or following a link closes it.
    function setUpMenu(header) {
        const toggle = header.querySelector(".nav-toggle");
        const nav = header.querySelector(".site-nav");
        function setOpen(open) {
            nav.classList.toggle("open", open);
            toggle.setAttribute("aria-expanded", String(open));
        }
        toggle.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
        document.addEventListener("click", (event) => {
            if (nav.classList.contains("open") && !header.contains(event.target)) setOpen(false);
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && nav.classList.contains("open")) {
                setOpen(false);
                toggle.focus();
            }
        });
    }

    customElements.define("site-header", SiteHeader);

    /* ---------- Icons ---------- */
    // Line icons drawn in the text color: icon("pin") for an 18px .ico, or
    // icon("sun", "") to size it with the surrounding styles.
    const ICONS = {
        pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>',
        chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
        camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
        chevron: '<path d="M9 6l6 6-6 6"/>',
        flag: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>',
        pause: '<path d="M9 6v12M15 6v12"/>',
        play: '<path d="M8 5.5v13l10-6.5z"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
        cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
        rain: '<path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/><path d="M8 13v8M12 15v8M16 13v8"/>',
        storm: '<path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/><path d="M13 11l-4 6h6l-4 6"/>'
    };
    function icon(name, className = "ico") {
        return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
    }

    /* ---------- Dialogs ---------- */
    // Native <dialog class="dialog"> opened with showModal(): the browser itself
    // keeps Tab inside, closes on Esc, and hides the rest of the page from
    // screen readers (the role="dialog" / aria-modal behavior). This adds the
    // rest of the spec: tap outside to close, page scroll lock, focus back
    // on whatever opened it, and a short motion in and out (site.css).
    //
    // Markup: a trigger with data-open-dialog="<dialog id>" and, inside the
    // dialog, any element with data-close-dialog. Pages can also call
    // SiteUI.openDialog(dialog) directly.
    const prepared = new WeakSet();

    function prepareDialog(dialog) {
        if (prepared.has(dialog)) return;
        prepared.add(dialog);
        setUpSwipeToClose(dialog);
        // closedby="any" adds tap-outside-to-close where it's supported...
        if (!dialog.hasAttribute("closedby")) dialog.setAttribute("closedby", "any");
        // ...and Safari, which doesn't support it yet, gets the same by hand: a
        // click whose target is the dialog itself but lands outside its box
        // was on the backdrop.
        if (!("closedBy" in HTMLDialogElement.prototype)) {
            dialog.addEventListener("click", (event) => {
                if (event.target !== dialog) return;
                const box = dialog.getBoundingClientRect();
                const inside = box.top <= event.clientY && event.clientY <= box.bottom && box.left <= event.clientX && event.clientX <= box.right;
                if (!inside) closeDialog(dialog);
            });
        }
        // Esc and tap-outside ask first, so they can play the closing motion too.
        // A browser may not let that be held off (Esc pressed again quickly);
        // then the dialog just closes at once.
        dialog.addEventListener("cancel", (event) => {
            if (!event.cancelable) return;
            event.preventDefault();
            closeDialog(dialog);
        });
        // 'close' fires however the dialog closed (button, Esc, outside tap).
        dialog.addEventListener("close", () => {
            dialog.removeAttribute("data-closing");
            if (!document.querySelector("dialog[open]")) document.documentElement.classList.remove("is-locked");
            const opener = dialog.siteUiOpener;
            dialog.siteUiOpener = null;
            // Browsers normally return focus on their own; this covers any that don't.
            if (opener && opener.isConnected && document.activeElement !== opener) opener.focus();
        });
    }

    // On a phone, where a dialog is a bottom sheet: drag its top (the handle
    // and title) down and it follows the finger. Let go past a quarter of its
    // height, or flick, and it slides on down and closes; otherwise it springs
    // back. Dragging inside the content scrolls it, as before.
    const SHEET_QUERY = "(max-width: 600px)";
    const SHEET_CLOSE_SHARE = 0.25;
    const SHEET_FLICK_PX_PER_MS = 0.5;
    const SHEET_FLICK_MIN_PX = 40;

    function setUpSwipeToClose(dialog) {
        let drag = null;
        dialog.addEventListener("pointerdown", (event) => {
            if (event.pointerType === "mouse" || !event.isPrimary || !matchMedia(SHEET_QUERY).matches) return;
            if (!event.target.closest(".dialog-grab, .dialog-head") || event.target.closest("button, a")) return;
            if (dialog.hasAttribute("data-closing")) return;
            drag = { id: event.pointerId, y: event.clientY, time: event.timeStamp, dy: 0 };
            dialog.setPointerCapture(event.pointerId);
            dialog.classList.add("is-dragging");
        });
        dialog.addEventListener("pointermove", (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            drag.dy = Math.max(0, event.clientY - drag.y);
            dialog.style.transform = `translateY(${drag.dy}px)`;
        });
        const release = (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            const { dy, time } = drag;
            drag = null;
            const speed = dy / Math.max(1, event.timeStamp - time);
            const far = dy > dialog.offsetHeight * SHEET_CLOSE_SHARE;
            const flick = speed > SHEET_FLICK_PX_PER_MS && dy > SHEET_FLICK_MIN_PX;
            // Both finish with the usual motion, from wherever the sheet was let go.
            dialog.classList.remove("is-dragging");
            dialog.style.transform = "";
            if (event.type === "pointerup" && (far || flick)) closeDialog(dialog);
        };
        dialog.addEventListener("pointerup", release);
        dialog.addEventListener("pointercancel", release);
    }

    function openDialog(dialog, opener) {
        if (!dialog) return;
        // Opened again while closing: it turns around and stays open.
        if (dialog.open) {
            dialog.removeAttribute("data-closing");
            return;
        }
        prepareDialog(dialog);
        dialog.siteUiOpener = opener || document.activeElement;
        document.documentElement.classList.add("is-locked");
        dialog.showModal();
    }

    // [data-closing] plays the closing motion while the dialog is still open,
    // then it closes for real. This works the same in every browser, unlike
    // closing first and animating on the way out, which Safari can't do yet.
    const CLOSE_WAIT_MAX_MS = 400;

    function closeDialog(dialog) {
        if (!dialog || !dialog.open || dialog.hasAttribute("data-closing")) return;
        dialog.setAttribute("data-closing", "");
        const finish = () => {
            if (dialog.hasAttribute("data-closing")) dialog.close();
        };
        const motion = dialog.getAnimations();
        if (!motion.length) return finish();
        Promise.race([
            Promise.allSettled(motion.map(animation => animation.finished)),
            new Promise(resolve => setTimeout(resolve, CLOSE_WAIT_MAX_MS))
        ]).then(finish);
    }

    document.addEventListener("click", (event) => {
        const opener = event.target.closest("[data-open-dialog]");
        if (opener) {
            openDialog(document.getElementById(opener.dataset.openDialog), opener);
            return;
        }
        const closer = event.target.closest("[data-close-dialog]");
        if (closer) {
            closeDialog(closer.closest("dialog"));
        }
    });

    /* ---------- Drop zones ---------- */
    // A .dropzone takes files three ways: dragged onto it, picked with its
    // [data-browse] button, or that same button from the keyboard.
    // onFiles receives a plain array of File objects.
    function setupDropZone(zone, { accept, multiple, onFiles }) {
        const input = document.createElement("input");
        input.type = "file";
        input.hidden = true;
        if (accept) input.accept = accept;
        input.multiple = !!multiple;
        zone.appendChild(input);

        const browse = zone.querySelector("[data-browse]");
        if (browse) browse.addEventListener("click", () => input.click());
        input.addEventListener("change", () => {
            if (input.files.length) onFiles([...input.files]);
            input.value = ""; // so picking the same file again still fires 'change'
        });

        // dragenter/dragleave fire for every child element crossed, so count
        // them rather than toggling -- otherwise the highlight flickers.
        let depth = 0;
        zone.addEventListener("dragenter", (event) => {
            event.preventDefault();
            depth++;
            zone.classList.add("is-over");
        });
        zone.addEventListener("dragover", (event) => event.preventDefault());
        zone.addEventListener("dragleave", () => {
            depth = Math.max(0, depth - 1);
            if (!depth) zone.classList.remove("is-over");
        });
        zone.addEventListener("drop", (event) => {
            event.preventDefault();
            depth = 0;
            zone.classList.remove("is-over");
            const files = [...(event.dataTransfer ? event.dataTransfer.files : [])];
            if (files.length) onFiles(multiple ? files : files.slice(0, 1));
        });
    }

    // Tabs with one green line under them that slides to the picked tab (the
    // leaderboards' Girls and Boys, the meet popup's points by age group). It
    // follows aria-selected on its own, doesn't slide the first time or when
    // the tabs change size (shown, or the window resized), and isn't made at
    // all with Reduce motion on (the picked tab's own underline shows instead).
    function slidingTabs(list) {
        if (matchMedia("(prefers-reduced-motion: reduce)").matches || !window.ResizeObserver) return;
        const ink = document.createElement("span");
        ink.className = "tab-ink";
        ink.setAttribute("aria-hidden", "true");
        const place = (slide) => {
            const tab = list.querySelector('[aria-selected="true"]');
            if (!tab || !list.offsetWidth) return;
            if (!ink.isConnected) {
                list.appendChild(ink);
                list.classList.add("has-ink");
            }
            ink.classList.toggle("ready", slide);
            ink.style.width = `${tab.offsetWidth}px`;
            ink.style.transform = `translateX(${tab.offsetLeft}px)`;
        };
        new MutationObserver(() => place(true)).observe(list, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
        new ResizeObserver(() => place(false)).observe(list);
        if (document.fonts) document.fonts.ready.then(() => place(false));
    }

    /* ---------- Last-seen data first (2026-10-23) ---------- */
    // The site's data service can take a few seconds to wake after a quiet
    // spell, so each phone keeps a copy of what it last loaded. loadFresh shows
    // that copy at once (show(data, true)), then fetches the current answer and
    // shows it too (show(data, false)) only when it differs. Fresh data waits
    // for any open popup to close, so nothing changes under the reader. Copies
    // live in this browser only; when it can't store them, pages just wait as
    // before. maxAgeHours skips an older copy (photo links expire). Rejects
    // (with err.status) only when there was no copy to show and the fetch failed.
    const CACHE_PREFIX = "seaSerpents.cache:";
    const CACHE_ORDER = "seaSerpents.cacheOrder";
    const CACHE_MAX = 30; // copies kept, the least recently used dropped first

    function readCopy(url, maxAgeHours) {
        try {
            const saved = JSON.parse(localStorage.getItem(CACHE_PREFIX + url) || "null");
            if (!saved || (maxAgeHours && Date.now() - saved.at > maxAgeHours * 3600e3)) return null;
            return saved.text;
        } catch (e) {
            return null;
        }
    }

    function forgetCopy(url) {
        try { localStorage.removeItem(CACHE_PREFIX + url); } catch (e) { /* nothing kept */ }
    }

    function saveCopy(url, text) {
        try {
            const order = JSON.parse(localStorage.getItem(CACHE_ORDER) || "[]").filter(u => u !== url);
            order.push(url);
            while (order.length > CACHE_MAX) localStorage.removeItem(CACHE_PREFIX + order.shift());
            localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ at: Date.now(), text }));
            localStorage.setItem(CACHE_ORDER, JSON.stringify(order));
        } catch (e) {
            // Full, or not allowed: the page works without copies.
        }
    }

    function whenNoPopup(fn) {
        if (!document.querySelector("dialog[open]")) return fn();
        document.addEventListener("close", function closed() {
            setTimeout(() => {
                if (document.querySelector("dialog[open]")) return;
                document.removeEventListener("close", closed, true);
                fn();
            }, 0);
        }, true);
    }

    async function loadFresh(url, show, { maxAgeHours } = {}) {
        let copy = readCopy(url, maxAgeHours);
        if (copy != null) {
            try {
                show(JSON.parse(copy), true);
            } catch (e) {
                copy = null;
            }
        }
        let text;
        try {
            const res = await fetch(url);
            if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
            text = await res.text();
        } catch (e) {
            if (e.status === 404) forgetCopy(url);
            if (copy == null) throw e;
            return; // the copy stays up
        }
        saveCopy(url, text);
        if (text !== copy) whenNoPopup(() => keepFocus(() => show(JSON.parse(text), false)));
    }

    // Redrawing can replace the button a closed popup just gave focus back to;
    // focus moves to its copy in the new drawing, so it isn't lost.
    function keepFocus(fn) {
        const was = document.activeElement;
        fn();
        if (!was || was === document.body || was.isConnected) return;
        const same = [...document.querySelectorAll(was.tagName)].find(el => el.outerHTML === was.outerHTML);
        if (same) same.focus({ preventScroll: true });
    }

    window.SiteUI = { icon, openDialog, closeDialog, setupDropZone, slidingTabs, loadFresh };
})();
