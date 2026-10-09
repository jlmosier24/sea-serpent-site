# Spotswood Sea Serpents: standing rules

Website for the Spotswood Sea Serpents summer swim team: homepage with meet cards, swimmer stats, photo gallery, and an admin area for meets, results, and photos. The redesign spec is in `design/` (HANDOFF.md, PROMPTS.md, mockups/, fixtures/). The mockups are a spec, not code to copy.

`design/` and `sample-data/` hold real kids' names, times, and photos. Both are gitignored: never commit, push, or publish them, and keep real names out of code comments and commit messages too.

## How to work
- Use the existing stack: static HTML pages, Azure Functions (Node; one folder per function with function.json and index.js), Azure Table and Blob Storage, Azure Static Web Apps. Do not add frameworks, databases, or services without asking.
- Plan first and wait for approval before editing. One step per branch, reviewed on its pull request's preview link. Merging to main deploys the live site.
- Do not invent data. Ask if something is not in the results sheets, the admin form, or the mockups.
- Mockup-only items must never ship: the dark "Mock controls" bars, sample data (Highland Divers meet, 84° forecast, "Test Pool", example swimmers), Win/Loss and Forecast switches, placeholder gallery tags, "Sample numbers", "mock today", fake delays, base64 images, and `href="#"` links.
- Treat numbers in design/fixtures/EXPECTED.md as cross-checks, not truth. Investigate differences. (Its relay counts leave out exhibition relays; the importer's include them.)
- Never name an Azure Function folder starting with "admin". Admin pages and APIs are protected by route rules in staticwebapp.config.json (the "administrator" role).

## Design rules
- Fonts: Poppins (headings, big numbers), Inter (body).
- Colors: brand green #1A6B2E, ink #10240F, muted #5B6B58, gold #F2B327 with ink #2A1E00, soft tint #F4F7E4 (border #DCE3C4), gold tint #FFF6D8 (border #EACB6A). Page gradient #D9E8BC to #FAFBF4.
- White cards (28px radius) on the tinted page. Insets inside cards use the soft tint with a thin border.
- Gold means celebration only (WIN chip, Most improved, 1st places, PB, podium numbers, Biggest drop). Green means data, actions, and links.
- No red on pages parents and kids see. Losses use a muted gray-green. Red is for admin Delete only.
- Never rely on color alone. Always include text or an icon.
- Dialogs: white, centered on desktop (max 520px), bottom sheet under 600px, Esc closes, focus returns to the trigger, Tab stays inside, page scroll locked, `role="dialog"` and `aria-modal`.
- Focus ring: 3px gold. Target WCAG AA contrast.

## Content rules
- "vs." means home and "at" means away. Titles use the short name ("vs. Massad"); score rows use the full name ("Curtis Park Seahawks 511").
- Dates: the full month and day everywhere, like "July 22" and "July 13 · Final". Times: "6:00pm".
- Stat labels in the meet popup (update 4): "Top-3 finishes" ("26 were 1st"), "Personal bests" ("by 74 swimmers"), "Point scorers" ("of 109 swimmers"), "Time dropped" ("2:56", "off best times"). The score banner always reads "Final team score" (update 5).

## Data rules
- Times are stored as seconds. 50yd and 50m are different events.
- Results sheets are saved for both teams, so a meet's full results can be shown. Stats, swimmer pages, and the swimmer list are Spotswood only. A tie for first counts as a win. Exhibition is not scored.
- Team scores are added up from the sheet's points on import. The admin can type a score in, and an import never overwrites a typed-in score.
- Most improved: the biggest percent drop below seed time across a swimmer's swims, at least 2%, shown in seconds with the event. (Not shown anywhere since 2026-10-07, when the user dropped the swimmer page's stat strip because the badges covered most of it.) Personal best: faster than the swimmer's previous best in that event, meaning their earlier swims on the site. A first swim in an event is not a PB, even when it beats the seed time (the user's choice, 2026-10-07). Barrier Breaker and Time Dropper still measure against seed times.
- Badges follow design/update-2/UPDATE.md, section 3, as changed by design/update-4/UPDATE.md, sections C to E: no levels; a badge that counts something lists every instance, newest first, and its pill is that list's count or total; Meet Attendance; a fixed display order with New first. Every Spotswood swimmer's badges are worked out again after each import or meet delete and saved in the SwimmerBadges table. Only legal, timed swims count (Meet Attendance also counts a meet with a DQ); each relay leg is 25 m (yards converted). Anchor counts only 100m relays, since the sheets list 4 of a 125m relay's 5 swimmers.
- Converted seeds (update 4, rule A): a seed equal to the swimmer's own earlier time in the other course x 1.11 was converted between yards and meters; the importer flags it, and it's left out of every comparison with the seed.
- The meet popup's Personal bests tile counts PBs the site's way (against earlier swims), not "faster than seed". Point scorers and Top point scorers use individual points only. Points by age group (update 5) uses the sheet's points column: All adds up to the team score, and Boys and Girls together do too; an 8 & under relay's points are split among its listed swimmers by their own age. Biggest time drops (update 5) are one per age group, all ages, chosen by percent below a real seed and shown in seconds; slow seeds aren't filtered out, since every one checked in 2026 was the swimmer's own earlier time.
- Opponent names come from the admin meet record, not the PDF.
- Re-importing a meet replaces its results.
- Photos: nothing goes live before review. A photo's meet comes from the date it was taken, read on the server without exposing the photo's GPS location.
