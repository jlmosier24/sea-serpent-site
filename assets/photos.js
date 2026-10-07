// Spotswood Sea Serpents: the photo viewer shared by the Gallery and the home
// page -- one photo at a time from a list, with its meet, Previous and Next
// (the arrow keys too), and Download. Styles live in /assets/site.css.
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
        dialog.querySelector(".viewer-prev").addEventListener("click", () => step(-1));
        dialog.querySelector(".viewer-next").addEventListener("click", () => step(1));
        dialog.addEventListener("keydown", (event) => {
            if (photos.length < 2) return;
            if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
            if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
        });
        return dialog;
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
        img.src = photo.url;
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
