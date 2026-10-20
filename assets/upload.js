// Spotswood Sea Serpents: the "Share photos" dialog, shared by the Photos page
// and the home page. Photos are resized and stripped of their metadata in the
// browser, their meet is looked up from the date each was taken, and they're
// sent for review. Styles live in /assets/site.css.
//
// Load it after /assets/site.js and /assets/meets.js, at the end of <body>
// (it adds its dialog to the page), and open it with PhotoUpload.open(button).
(function () {
    "use strict";

    const { escapeHtml, plural } = Meets;

    /* ---------------- Getting photos ready in the browser ---------------- */
    const MAX_PHOTOS = 20;
    const MAX_DIMENSION = 1600;
    const THUMB_DIMENSION = 240;
    // The server reads each photo's date from the original file. A JPEG keeps
    // it near the start; a HEIC can keep it anywhere, so all of one goes.
    const ORIGINAL_HEAD_BYTES = 256 * 1024;
    const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;

    function isHeic(file) {
        return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
    }

    function isPhotoFile(file) {
        return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|hei[cf])$/i.test(file.name);
    }

    function originalBytes(file) {
        return isHeic(file) && file.size <= MAX_ORIGINAL_BYTES ? file : file.slice(0, ORIGINAL_HEAD_BYTES);
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // Both decoders apply the photo's EXIF rotation, so portrait shots stay upright once that metadata is gone.
    // createImageBitmap comes first: the site's content rules block the blob: link an <img> would need.
    async function decodeImage(file) {
        if (window.createImageBitmap) {
            try {
                return await createImageBitmap(file, { imageOrientation: 'from-image' });
            } catch (err) {
                console.warn('createImageBitmap failed, trying <img>:', err);
            }
        }
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            return img;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    // Redrawing through a canvas leaves all metadata behind (phones record GPS
    // there) and shrinks multi-MB originals.
    function drawScaled(image, maxDimension) {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        const scale = Math.min(1, maxDimension / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        // JPEG has no transparency -- without this, transparent areas encode as black.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas;
    }

    // Says why a photo couldn't be opened, so whoever's uploading knows what to try next.
    async function unreadablePhotoMessage(file) {
        let readable = file.size > 0;
        if (readable) {
            try { await file.slice(0, 1).arrayBuffer(); } catch (e) { readable = false; }
        }
        if (!readable) return 'Couldn\'t open this photo. If it\'s only stored in the cloud, save it to your phone first.';
        if (isHeic(file)) return 'This browser can\'t read HEIC photos. Try a JPEG or PNG.';
        return 'Couldn\'t read this photo. Try a different one, or a JPEG or PNG.';
    }

    /* ---------------- Upload dialog ---------------- */
    // The dialog is added to the page the first time a page loads this file.
    document.body.insertAdjacentHTML('beforeend', `
    <dialog class="dialog" id="uploadDialog" aria-labelledby="uploadTitle">
        <div class="dialog-grab" aria-hidden="true"></div>
        <div class="dialog-head">
            <div><h2 id="uploadTitle">Share photos</h2><p id="uploadSubtitle">Photos are reviewed before they go live.</p></div>
            <button type="button" class="dialog-close" data-close-dialog aria-label="Close"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
        <div class="dialog-body" id="uploadBody"></div>
        <input type="file" id="morePicker" accept="image/*" multiple hidden>
    </dialog>`);
    const uploadDialog = document.getElementById('uploadDialog');
    const uploadBody = document.getElementById('uploadBody');
    const morePicker = document.getElementById('morePicker');
    const UPLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>';
    const REMOVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';

    // Each picked photo: { id, file, state: 'reading' | 'ready' | 'unchecked', thumb, copy, original, tag }.
    let upload = newUpload();
    let nextItemId = 1;

    function newUpload() {
        return { step: 'choose', items: [], problems: [], sending: false, progress: '', sent: 0, noDate: 0 };
    }

    // Esc doesn't close the dialog partway through sending.
    uploadDialog.addEventListener('cancel', (event) => { if (upload.sending) event.preventDefault(); });
    uploadDialog.addEventListener('close', () => { if (!upload.sending) upload = newUpload(); });
    morePicker.addEventListener('change', () => {
        if (morePicker.files.length) addFiles([...morePicker.files]);
        morePicker.value = '';
    });
    // More photos can be dropped anywhere on the dialog (the drop zone handles its own,
    // and marks them handled); without this the browser would open a dropped photo itself.
    uploadDialog.addEventListener('dragover', (event) => event.preventDefault());
    uploadDialog.addEventListener('drop', (event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        const files = [...(event.dataTransfer ? event.dataTransfer.files : [])];
        if (files.length && !upload.sending && upload.step !== 'done') addFiles(files);
    });

    async function addFiles(files) {
        const mine = upload;
        const images = files.filter(isPhotoFile);
        mine.problems = [];
        const skipped = files.length - images.length;
        if (skipped) mine.problems.push(`${plural(skipped, 'file was', 'files were')} skipped because ${skipped === 1 ? 'it isn\'t' : 'they aren\'t'} a photo.`);
        const room = MAX_PHOTOS - mine.items.length;
        if (images.length > room) mine.problems.push(`You can share up to ${MAX_PHOTOS} photos at a time.`);
        const added = images.slice(0, Math.max(0, room)).map(file => ({ id: nextItemId++, file, state: 'reading' }));
        mine.items.push(...added);
        if (mine.items.length) mine.step = 'review';
        renderUpload();
        // One at a time, so a phone never holds several full-size photos in memory at once.
        for (const item of added) {
            await readItem(item, mine);
            if (upload !== mine) return; // the dialog was closed and reset
            renderUpload();
        }
    }

    // Makes the photo's resized copy and thumbnail, then asks the server where it will go.
    async function readItem(item, mine) {
        let image;
        try {
            image = await decodeImage(item.file);
            item.thumb = drawScaled(image, THUMB_DIMENSION).toDataURL('image/jpeg', 0.7);
            item.copy = await new Promise(resolve => drawScaled(image, MAX_DIMENSION).toBlob(resolve, 'image/jpeg', 0.85));
            if (!item.copy) throw new Error('Could not encode the photo');
        } catch (err) {
            console.error('Could not prepare photo:', err);
            mine.items = mine.items.filter(i => i !== item);
            mine.problems.push(`${item.file.name}: ${await unreadablePhotoMessage(item.file)}`);
            if (!mine.items.length) mine.step = 'choose';
            return;
        } finally {
            if (image && image.close) image.close();
        }
        item.original = originalBytes(item.file);
        try {
            const res = await fetch('/api/galleryPhotoDate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ originalBase64: await blobToBase64(item.original) })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            item.tag = (await res.json()).tag;
            item.state = 'ready';
        } catch (err) {
            // The upload reads the date again, so the photo can still go; the dialog just can't say where yet.
            console.error('Could not check the photo\'s date:', err);
            item.state = 'unchecked';
        }
    }

    function caption(item) {
        if (item.state === 'reading') return ['wait', 'Reading date…'];
        if (item.state === 'unchecked') return ['wait', 'Date not checked'];
        if (!item.tag) return ['none', 'No date found'];
        if (item.tag.key === 'other') return ['other', 'Another day'];
        return ['', item.tag.label];
    }

    function sortNote(items) {
        const ready = items.filter(i => i.state === 'ready');
        const meet = ready.filter(i => i.tag && i.tag.key !== 'other').length;
        const other = ready.filter(i => i.tag && i.tag.key === 'other').length;
        const none = ready.filter(i => !i.tag).length;
        const parts = [meet && `${meet} matched to a meet`, other && `${other} from another day`, none && `${none} with no date`].filter(Boolean);
        return parts.length ? `${parts.join(', ')}.` : '';
    }

    function problemsHtml(problems) {
        return problems.length ? `<div class="upload-problems" role="alert">${problems.map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div>` : '';
    }

    const HELP = 'Only share photos you took or have permission to share.';

    function renderUpload() {
        const u = upload;
        // Re-rendering replaces the buttons, so focus goes back to the matching one.
        const focusKey = uploadBody.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
        document.getElementById('uploadTitle').textContent = u.step === 'done' ? 'Thank you!' : 'Share photos';
        document.getElementById('uploadSubtitle').hidden = u.step === 'done';
        uploadDialog.querySelector('.dialog-close').disabled = u.sending;

        if (u.step === 'choose') {
            uploadBody.innerHTML = `
                <div class="dropzone" id="uploadDrop">
                    ${UPLOAD_ICON}
                    <p><b>Drag photos here</b></p>
                    <p class="muted">You can pick several at once</p>
                    <button type="button" class="btn" data-browse data-focus="browse">Choose photos</button>
                </div>
                <p class="field-help">We sort photos into meets by the date each one was taken. ${HELP}</p>
                ${problemsHtml(u.problems)}
                <div class="dialog-actions"><button type="button" class="btn" data-close-dialog>Cancel</button></div>`;
            SiteUI.setupDropZone(document.getElementById('uploadDrop'), { accept: 'image/*', multiple: true, onFiles: addFiles });
        } else if (u.step === 'review') {
            const reading = u.items.some(i => i.state === 'reading');
            const count = u.items.length;
            uploadBody.innerHTML = `
                <ul class="thumbs">${u.items.map((item, i) => {
                    const [kind, text] = caption(item);
                    return `
                        <li class="thumb">
                            <div class="thumb-photo">
                                ${item.thumb ? `<img src="${item.thumb}" alt="">` : ''}
                                ${u.sending ? '' : `<button type="button" class="thumb-remove" data-remove="${item.id}" data-focus="remove-${item.id}" aria-label="Remove photo ${i + 1}">${REMOVE_ICON}</button>`}
                            </div>
                            <p class="thumb-caption ${kind}">${escapeHtml(text)}</p>
                        </li>`;
                }).join('')}</ul>
                ${reading ? '' : `<p class="sort-note" role="status">${escapeHtml(sortNote(u.items))}</p>`}
                ${u.sending || count >= MAX_PHOTOS ? '' : `<button type="button" class="btn small" id="addMore" data-focus="more">${UPLOAD_ICON}Add more photos</button>`}
                <p class="field-help">${HELP}</p>
                ${problemsHtml(u.problems)}
                <div class="dialog-actions">
                    ${u.sending ? '' : '<button type="button" class="btn" data-close-dialog>Cancel</button>'}
                    <button type="button" class="btn primary" id="submitPhotos" data-focus="submit"${reading || u.sending ? ' disabled' : ''}>${u.sending ? escapeHtml(u.progress) : `Submit ${plural(count, 'photo', 'photos')} for review`}</button>
                </div>`;
            uploadBody.querySelectorAll('[data-remove]').forEach((button, i) => button.addEventListener('click', () => {
                u.items = u.items.filter(item => item.id !== Number(button.dataset.remove));
                u.problems = [];
                if (!u.items.length) u.step = 'choose';
                renderUpload();
                // The removed photo's button is gone, so focus moves to the next one (or the way to add more).
                const buttons = uploadBody.querySelectorAll('[data-remove]');
                const next = buttons[Math.min(i, buttons.length - 1)] || uploadBody.querySelector('[data-focus="more"], [data-focus="browse"]');
                if (next) next.focus();
            }));
            const more = document.getElementById('addMore');
            if (more) more.addEventListener('click', () => morePicker.click());
            document.getElementById('submitPhotos').addEventListener('click', submitPhotos);
        } else {
            const noDate = u.noDate ? ` ${plural(u.noDate, 'photo has', 'photos have')} no date, so ${u.noDate === 1 ? 'it' : 'they'} will show under All photos.` : '';
            uploadBody.innerHTML = `
                <div class="upload-done">
                    <div class="done-icon">${CHECK_ICON}</div>
                    <p class="done-title">${plural(u.sent, 'photo is', 'photos are')} waiting for review</p>
                    <p class="done-note">We sort photos into meets by the date they were taken.${escapeHtml(noDate)}</p>
                </div>
                <div class="dialog-actions centered"><button type="button" class="btn primary" data-close-dialog data-focus="done">Done</button></div>`;
            uploadBody.querySelector('[data-focus="done"]').focus();
            return;
        }
        if (focusKey) {
            const again = uploadBody.querySelector(`[data-focus="${focusKey}"]`);
            if (again && !again.disabled) again.focus();
        }
    }

    async function submitPhotos() {
        const u = upload;
        const items = [...u.items];
        u.sending = true;
        u.problems = [];
        // One at a time, like reading them, and only photos that haven't gone through yet.
        for (let i = 0; i < items.length; i++) {
            u.progress = items.length > 1 ? `Uploading ${i + 1} of ${items.length}…` : 'Uploading…';
            renderUpload();
            const item = items[i];
            try {
                const res = await fetch('/api/uploadGalleryPhoto', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dataBase64: await blobToBase64(item.copy), originalBase64: await blobToBase64(item.original || originalBytes(item.file)) })
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
                const saved = await res.json();
                u.sent++;
                if (!saved.tag) u.noDate++;
                u.items = u.items.filter(other => other !== item);
            } catch (err) {
                console.error('Upload failed:', err);
            }
        }
        u.sending = false;
        if (u.items.length) u.problems.push(`${plural(u.items.length, 'photo', 'photos')} didn't go through. Please try again.`);
        else u.step = 'done';
        renderUpload();
    }

    // Opens the dialog; focus goes back to the trigger when it closes.
    function open(trigger) {
        if (!upload.sending) upload = newUpload();
        renderUpload();
        SiteUI.openDialog(uploadDialog, trigger);
    }

    window.PhotoUpload = { open };
})();
