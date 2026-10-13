# SPEC — SlotSync (App 5)

Office hours scheduler for professors. Static web app, zero backend, no build step. Suite visual language (warm neutrals, serif headings, no gradients, no emojis). State-in-URL architecture: the professor's schedule config is encoded (base64 JSON) into shareable booking links, so students can book without any server.

## Deliverable
Repo folder: `/mnt/agents/output/academic-apps/slotsync/` — index.html, styles.css, app.js, js/ modules, README.md, LICENSE (MIT), .gitignore. git init + commit.

## Features

### 1. Professor setup (Professor view)
- Weekly recurring office-hour blocks: day(s) of week, start/end time, slot length (10/15/20/30 min), location mode per block: **in-person** (room text), **Zoom** (paste meeting link), **Teams** (paste meeting link), **Google Meet** (paste link) — UI explains: without accounts/APIs the professor pastes their standing meeting links; app attaches the right link to each booking
- Semester dates: start/end, blackout dates (holidays, conferences), per-week overrides (cancel/move a specific week)
- Booking rules: per-student cap per week (fairness), how far ahead students may book, buffer between slots
- Professor identity: name, course(s), reply email

### 2. Booking link generation (state-in-URL)
- "Copy booking link" → app URL + `#book=` + base64url-encoded config (schedule, rules, meeting links, professor name/email)
- Since static hosting = no shared database, bookings work via **request flow**: student picks a slot → app generates (a) a prefilled email (mailto:) to the professor with slot details, and (b) an .ics download for the student. UI is honest: professor confirms by reply; a "claimed slots" list can optionally be appended to the link by the professor when they update it.
- Also generate a plain "Add all my office hours to calendar" .ics for the professor's own calendar

### 3. Student view (same app, detects #book= hash)
- Clean booking page: professor name/course, available slots by week (respecting caps/blackouts/overrides), slot cards with location icon (room / Zoom / Teams / Meet badge)
- Pick a slot → confirm name/email → get: .ics download (event with meeting link/room in location field), "Add to Google Calendar" URL (calendar.google.com/calendar/render?action=TEMPLATE...), "Add to Outlook" URL (outlook.live.com/calendar/deeplink/compose...), prefilled mailto request to professor
- Detects hash config → student mode; no hash → professor mode

### 4. Calendar utilities (js/calendar.js)
- RFC 5545 .ics generator (recurring RRULE weekly events + exceptions via EXDATE; single events) — validated structure (BEGIN:VCALENDAR/VEVENT, DTSTAMP, UID, DTSTART/DTEND with TZID handling via floating local time + explicit note)
- Google Calendar + Outlook web deep-link builders
- .ics import: professor can import their existing calendar .ics to auto-mark blackout conflicts (parse VEVENT date ranges; mark colliding slots as "busy" suggestions)

## Quality bar
- node --check all JS; no CDN dependencies required (build .ics by hand)
- node smoke tests: .ics output parses structurally (fixtures validated for VEVENT/RRULE/EXDATE correctness), Google/Outlook URL builders, config encode/decode round-trip, slot generation across semester with blackouts/overrides/caps
- Browser e2e if harness available: professor configures a semester → copies booking link → open link in fresh context → student books a slot → .ics + Google link + mailto generated; zero console errors
- README: sibling structure (features, local run, GitHub push, Pages deploy, embed) + honest note on no-backend booking flow
