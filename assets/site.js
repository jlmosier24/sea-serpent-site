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
                        <a class="brand" href="/"><img src="/assets/logo.png" alt=""><span class="brand-name">${admin ? "Sea Serpents Admin" : "Spotswood Sea Serpents"}</span></a>
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

    window.SiteUI = { icon, openDialog, closeDialog, setupDropZone };
})();
