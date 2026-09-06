// Adds a handful of placeholder photos to the local gallery fixture, purely
// for previewing gallery.html / the draft home page's layout. These are
// generated SVGs (not real team photos -- we don't have any yet), so
// there's nothing sensitive here, but the file they land in is the same
// gitignored sample-data/ as the real season data, and stays local-only.
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "..", "sample-data", "gallery-public.json");

const PHOTOS = [
    { color: "#2F8F3E", label: "Team Practice" },
    { color: "#F0B429", label: "Relay Warmup", caption: "Relay warmups before the Fox Point meet", submittedBy: "Coach Dana" },
    { color: "#1F6B2B", label: "Meet Day" },
    { color: "#2D6B34", label: "Pool Time", caption: "Free swim after practice" },
    { color: "#D19B1F", label: "Awards Ceremony", caption: "Ribbons for the 9-10 girls", submittedBy: "Mosier family" },
    { color: "#17261A", label: "Go Sea Serpents!" }
];

function svgDataUrl(color, label) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><rect width='400' height='300' fill='${color}'/><path d='M40 220c30-40 60-40 90 0s60 40 90 0 60-40 90 0 60 40 90 0' stroke='white' stroke-width='6' fill='none' stroke-linecap='round' opacity='0.35'/><text x='200' y='160' font-family='sans-serif' font-size='24' font-weight='700' fill='white' text-anchor='middle'>${label}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const now = Date.now();
const photos = PHOTOS.map((p, i) => ({
    id: `test-photo-${i + 1}`,
    url: svgDataUrl(p.color, p.label),
    blobName: `test-photo-${i + 1}.svg`,
    caption: p.caption || "",
    submittedBy: p.submittedBy || "",
    status: "approved",
    submittedAt: new Date(now - i * 3 * 60 * 60 * 1000).toISOString() // spread a few hours apart, newest first
}));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(photos, null, 2));
console.log(`Wrote ${photos.length} test photos to ${OUT}`);
