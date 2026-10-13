# SlotSync

Office hours scheduler for professors. A fully static web app — no backend,
no build step, no accounts. The professor configures weekly office-hour blocks
once; the whole schedule is encoded into a single shareable booking link.
Students open the link, pick a slot, and send a prefilled request.

## Features

### 1. Professor setup
- **Weekly recurring blocks** — day of week, start/end time, slot length
  (10/15/20/30 min). Add as many blocks as you teach.
- **Location per block** — in-person (room text), Zoom, Microsoft Teams, or
  Google Meet. There are no accounts or API integrations, so you create one
  *standing meeting* in your conferencing tool and paste its link; SlotSync
  attaches the right link to every booking in that block.
- **Semester dates** — start/end bound the whole schedule.
- **Blackout dates** — holidays, conferences, travel days.
- **Per-week overrides** — cancel an entire week, or move one block to a
  different day/time for a single week.
- **Booking rules** — per-student weekly cap (fairness), booking horizon (how
  far ahead students may book), buffer between slots.
- **Import your calendar (.ics)** — upload an export from Google/Outlook/Apple
  and SlotSync scans it locally for events that collide with your blocks,
  suggesting them as blackout dates. The file never leaves your browser.

### 2. Booking links (state-in-URL)
There is no server, so the link *is* the database: the entire configuration is
serialized to JSON and base64url-encoded into a `#book=…` hash. Post the link
on your syllabus or LMS. Changing anything produces a fresh link — old links
keep the old schedule.

**An honest note on how booking works without a backend.** A booking cannot be
"recorded" anywhere, so SlotSync uses a *request flow*: the student picks a
slot and gets (a) a prefilled `mailto:` email to the professor with the slot
details, and (b) a calendar entry for themselves. The professor confirms by
replying. To make a taken slot disappear for future visitors, the professor
marks it as *claimed* in the app and re-shares the updated link. The UI says
all of this plainly to both sides.

### 3. Student view (same app, detects the `#book=` hash)
- Clean booking page with professor name/course, rules summary, and
  week-by-week navigation through the booking window.
- Slot cards with location badges (Room / Zoom / Teams / Meet), plus "Taken"
  (claimed) and "Moved" (override) badges; blackouts, canceled weeks, and
  past dates never appear.
- Pick a slot → enter name/email (+ optional topic) → get four outputs:
  1. **Prefilled request email** to the professor (`mailto:`)
  2. **`.ics` download** — the meeting link or room in the `LOCATION` field
  3. **Add to Google Calendar** (`calendar.google.com/calendar/render?action=TEMPLATE…`)
  4. **Add to Outlook** (`outlook.live.com/calendar/deeplink/compose…`)

### 4. Calendar utilities (`js/calendar.js`, hand-rolled — no libraries)
- **RFC 5545 `.ics` generator** — `VCALENDAR`/`VEVENT` with `DTSTAMP`, `UID`,
  `DTSTART`/`DTEND`, weekly `RRULE` recurrence with `UNTIL`, `EXDATE`
  exceptions for blackouts/canceled weeks, correct `TEXT` escaping, CRLF line
  endings, and 75-octet line folding that never splits UTF-8 sequences.
  Times are *floating local* (no `TZID`): the file carries an
  `X-WR-CALDESC` note and each calendar app renders the events in the
  viewer's own timezone.
- **Google Calendar and Outlook web deep-link builders.**
- **`.ics` importer** — unfolds lines, parses `VEVENT`s (`DTSTART`, `DTEND`,
  `SUMMARY`, `RRULE` weekly with `BYDAY`/`UNTIL`/`COUNT`, `EXDATE`), expands
  recurring events into busy intervals, and maps collisions with your blocks
  to suggested blackout dates.
- **"Add all my office hours to my calendar"** — one recurring `VEVENT` per
  block for the professor's own calendar, with `EXDATE`s for every blackout
  and canceled week and single events for moved weeks.

## Screenshots

<!-- Add screenshots after deploying, e.g.:
![Professor setup — weekly blocks](docs/screenshot-professor-setup.png)
![Student booking page](docs/screenshot-student-booking.png)
![Booking outputs — email, .ics, Google/Outlook](docs/screenshot-booking-result.png)
-->

_coming soon_

## Tech

- Vanilla HTML/CSS/JS. No framework, no bundler, no build step, **no CDN
  dependencies** — the `.ics` generator/importer and the URL builders are
  hand-rolled in `js/calendar.js`.
- Browser modules attach to `window.*` (`SlotSyncCalendar`, `SlotSyncConfig`,
  `SlotSyncSlots`) and also load under plain node for the test suite.

## Run locally

Option A — just open the file:

```
open index.html        # macOS
start index.html       # Windows
xdg-open index.html    # Linux
```

Option B — serve it (recommended, behaves exactly like hosting):

```
cd slotsync
python3 -m http.server 8000
# then visit http://localhost:8000
```

Any static server works (`npx serve`, nginx, …). Fully offline-capable — no
network calls are made at all.

## Tests

```
node tests/run-tests.js                 # smoke tests (87 assertions)
node --check app.js js/*.js             # syntax check
NODE_PATH=$(npm root -g) node tests/e2e.js   # browser e2e (needs playwright + chromium)
```

The smoke tests validate `.ics` structure (VEVENT/RRULE/EXDATE, CRLF,
75-octet folding), the Google/Outlook URL builders, the config
encode/decode round-trip (including unicode names), slot generation across a
semester with blackouts/overrides/claims, and `.ics` import + blackout
suggestions. The e2e test drives a real browser through professor setup →
booking link → student booking → `.ics`/Google/Outlook/mailto outputs, and
fails on any console error.

## Put it on GitHub (step-by-step, no git experience needed)

1. Create a free account at <https://github.com> and sign in.
2. Click the **+** in the top-right corner → **New repository**.
3. Name it `slotsync`, leave it **Public**, do **not** check "Add a README"
   (this repo already has one), click **Create repository**.
4. Install git if you don't have it: <https://git-scm.com/downloads>
   (accept the defaults during install).
5. Open a terminal (macOS/Linux) or **Git Bash** (Windows) and run:

   ```
   cd path/to/slotsync          # the folder containing index.html
   git init                     # only if this isn't already a git repo
   git add .
   git commit -m "Initial commit: SlotSync"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/slotsync.git
   git push -u origin main
   ```

   Replace `YOUR-USERNAME` with your GitHub username. When asked to sign in,
   use the browser window that opens (or a personal access token).
6. Refresh your repository page on GitHub — you should see all the files.

## Deploy to GitHub Pages

1. In your GitHub repository, click **Settings** → **Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Under **Branch**, select **main** and **/ (root)**, click **Save**.
4. Wait a minute, then reload the page — GitHub shows your site URL:
   `https://YOUR-USERNAME.github.io/slotsync/`

That's it — the app is a plain static site, so no build configuration is
needed. Booking links are portable across hosting: a `#book=…` link works on
any copy of the app, because all state travels inside the URL hash.

## Embed in your personal website

```html
<iframe
  src="https://YOUR-USERNAME.github.io/slotsync/"
  style="width:100%; max-width:1020px; height:800px; border:1px solid #e2d9c9; border-radius:4px;"
  title="SlotSync — office hours scheduler"
  loading="lazy">
</iframe>
```

To embed a specific booking page (student view), include the full hash:

```html
<iframe src="https://YOUR-USERNAME.github.io/slotsync/#book=eyJ2IjoxLC…" …></iframe>
```

## Repository layout

```
slotsync/
├── index.html
├── styles.css
├── app.js              # UI wiring, both professor and student modes
├── js/
│   ├── calendar.js     # RFC 5545 .ics generator/importer, Google/Outlook URLs
│   ├── config.js       # state-in-URL: base64url config encode/decode
│   └── slots.js        # slot generation (blackouts, overrides, caps, claims)
├── tests/
│   ├── run-tests.js    # node smoke tests (no dependencies)
│   └── e2e.js          # Playwright browser e2e
├── README.md
├── LICENSE             # MIT
└── .gitignore
```

## License

MIT — see [LICENSE](LICENSE).
