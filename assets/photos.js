// Spotswood Sea Serpents: the photo viewer shared by the Photos page and the home
// page -- one photo at a time from a list, with its meet, Previous and Next
// (the arrow keys too, or a swipe on a touch screen), and Download. Styles live in /assets/site.css.
//
// Load it after /assets/site.js and WITHOUT defer, so a page's own script
// at the end of <body> can already use window.Photos.
(function () {
    "use strict";

    const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>';

    let photos = [];
    let index = 0;

    // Built on first use, so pages don't each carry a copy of the markup.
    function viewer() {
        let dialog = document.getElementById("photoViewer");
        if (dialog) return dialog;
        dialog = document.createElement("dialog");
        dialog.className = "dialog wide";
        dialog.id = "photoViewer";
        dialog.setAttribute("aria-labelledby", "photoViewerTitle");
        dialog.innerHTML = `
            <div class="dialog-grab" aria-hidden="true"></div>
            <div class="dialog-head">
                <h2 id="photoViewerTitle"></h2>
                <button type="button" class="dialog-close" data-close-dialog aria-label="Close">${CLOSE_ICON}</button>
            </div>
            <div class="dialog-body">
                <div class="viewer-top">
                    <span class="pill viewer-tag"></span>
                    <a class="btn small quiet viewer-download">${DOWNLOAD_ICON}Download</a>
                </div>
                <img class="viewer-photo" alt="">
                <p class="viewer-caption"></p>
                <div class="viewer-nav">
                    <button type="button" class="btn viewer-prev"><span aria-hidden="true">←</span> Previous</button>
                    <button type="button" class="btn viewer-next">Next <span aria-hidden="true">→</span></button>
                </div>
            </div>`;
        document.body.appendChild(dialog);
        // Each photo fades in once it has loaded (see render).
        const img = dialog.querySelector(".viewer-photo");
        const loaded = () => img.classList.remove("is-loading");
        img.addEventListener("load", loaded);
        img.addEventListener("error", loaded);
        setUpSwipe(img);
        dialog.querySelector(".viewer-prev").addEventListener("click", () => step(-1));
        dialog.querySelector(".viewer-next").addEventListener("click", () => step(1));
        dialog.addEventListener("keydown", (event) => {
            if (photos.length < 2) return;
            if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
            if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
        });
        return dialog;
    }

    // Swipe on a touch screen: the photo follows the finger sideways. Let go
    // past a fifth of its width, or flick, and it slides off while the next one
    // (left) or previous one (right) comes in from the other side; otherwise it
    // springs back. Up and down stay with the page, and mice use the buttons.
    const SWIPE_START_PX = 8;
    const SWIPE_SHARE = 0.2;
    const FLICK_PX_PER_MS = 0.5;
    const FLICK_MIN_PX = 30;
    const SLIDE_OUT_MS = 200;
    const SLIDE_IN_PX = 40;

    function setUpSwipe(img) {
        img.draggable = false;
        let drag = null;
        img.addEventListener("pointerdown", (event) => {
            if (event.pointerType === "mouse" || photos.length < 2 || !event.isPrimary || sliding) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, moving: false, dx: 0 };
        });
        img.addEventListener("pointermove", (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if (!drag.moving) {
                if (Math.abs(dx) < SWIPE_START_PX && Math.abs(dy) < SWIPE_START_PX) return;
                if (Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
                drag.moving = true;
                img.setPointerCapture(event.pointerId);
                img.classList.add("is-dragging");
            }
            drag.dx = dx;
            img.style.transform = `translateX(${dx}px)`;
        });
        const release = (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            const { moving, dx, time } = drag;
            drag = null;
            if (!moving) return;
            img.classList.remove("is-dragging");
            const speed = Math.abs(dx) / Math.max(1, event.timeStamp - time);
            const far = Math.abs(dx) > img.clientWidth * SWIPE_SHARE;
            const flick = speed > FLICK_PX_PER_MS && Math.abs(dx) > FLICK_MIN_PX;
            if (event.type === "pointerup" && (far || flick)) slideTo(img, dx < 0 ? 1 : -1);
            else img.style.transform = "";
        };
        img.addEventListener("pointerup", release);
        img.addEventListener("pointercancel", release);
    }

    let sliding = false;

    function slideTo(img, delta) {
        // With reduced motion, just the photo's usual fade.
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
            img.style.transform = "";
            step(delta);
            return;
        }
        sliding = true;
        img.style.transform = `translateX(${delta > 0 ? "-" : ""}100%)`;
        img.style.opacity = "0";
        setTimeout(() => {
            // The next photo starts a little to the other side and comes in as it fades in.
            img.classList.add("is-dragging");
            img.style.transform = `translateX(${delta > 0 ? SLIDE_IN_PX : -SLIDE_IN_PX}px)`;
            img.style.opacity = "";
            step(delta);
            img.getBoundingClientRect(); // apply the start before the move
            img.classList.remove("is-dragging");
            img.style.transform = "";
            sliding = false;
        }, SLIDE_OUT_MS);
    }

    function show(selector, visible) {
        viewer().querySelector(selector).hidden = !visible;
    }

    function render() {
        const dialog = viewer();
        const photo = photos[index];
        dialog.querySelector("#photoViewerTitle").textContent = `Photo ${index + 1} of ${photos.length}`;

        const label = photo.tag ? photo.tag.label : "";
        dialog.querySelector(".viewer-tag").textContent = label;
        show(".viewer-tag", !!label);
        const download = dialog.querySelector(".viewer-download");
        if (photo.downloadUrl) download.href = photo.downloadUrl;
        else download.removeAttribute("href");
        show(".viewer-download", !!photo.downloadUrl);
        show(".viewer-top", !!label || !!photo.downloadUrl);

        const img = dialog.querySelector(".viewer-photo");
        if (img.getAttribute("src") !== photo.url) {
            img.classList.add("is-loading");
            img.src = photo.url;
            // One already in the browser's cache can be ready at once.
            if (img.complete) img.classList.remove("is-loading");
        }
        img.alt = photo.caption || (photo.tag && photo.tag.key !== "other" ? `Team photo from ${label}` : "Team photo");
        // Older photos were uploaded with captions; new ones don't have any.
        const caption = [photo.caption, photo.submittedBy && `— ${photo.submittedBy}`].filter(Boolean).join(" ");
        dialog.querySelector(".viewer-caption").textContent = caption;
        show(".viewer-caption", !!caption);
        show(".viewer-nav", photos.length > 1);
    }

    function step(delta) {
        index = (index + delta + photos.length) % photos.length;
        render();
    }

    // Opens photos[startIndex] (each photo as /api/galleryPublic lists it);
    // Previous and Next go around the list.
    function open(list, startIndex, opener) {
        if (!list.length) return;
        photos = list;
        index = Math.max(0, Math.min(startIndex, list.length - 1));
        render();
        SiteUI.openDialog(viewer(), opener);
    }

    window.Photos = { open };
})();
