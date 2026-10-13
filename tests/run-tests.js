/* SlotSync — node smoke tests (no dependencies).
 * Run: node tests/run-tests.js
 * Loads the browser modules via globalThis and exercises:
 *   1. .ics structural validation (VEVENT/RRULE/EXDATE, CRLF, 75-octet folding)
 *   2. Google / Outlook URL builders (valid, correctly encoded URLs)
 *   3. Config encode/decode round-trip (incl. unicode names)
 *   4. Slot generation across a semester with blackouts / overrides / claims
 *   5. .ics import: parse + expand + blackout suggestions
 */
'use strict';

require('../js/calendar.js');
require('../js/config.js');
require('../js/slots.js');

const Cal = globalThis.SlotSyncCalendar;
const Cfg = globalThis.SlotSyncConfig;
const Slots = globalThis.SlotSyncSlots;

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.error('FAIL  ' + name); }
}
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ')'); }
function section(t) { console.log('\n== ' + t + ' =='); }

/* ---------- 1 · .ics generation ---------- */
section('ics generation');

const ev = Cal.buildVEvent({
  uid: 'test-1@slotsync',
  dtstamp: new Date(Date.UTC(2025, 7, 25, 12, 0, 0)),
  summary: 'Office hours — Dr. Zoë Åström (ECON 201), "special" topics; week 1, part 2 \\ notes',
  description: 'Line one.\nLine two, with comma; and semicolon.',
  location: 'Warren Hall 312',
  startDate: '2025-09-01', startMin: 14 * 60,
  endDate: '2025-09-01', endMin: 16 * 60,
  rrule: { byday: ['MO'], until: '2025-12-08' },
  exdates: [{ date: '2025-10-13', min: 14 * 60 }, { date: '2025-11-24', min: 14 * 60 }]
});

ok(ev.indexOf('BEGIN:VEVENT') === 0, 'VEVENT begins correctly');
ok(ev.indexOf('END:VEVENT') > 0, 'VEVENT ends correctly');
ok(/UID:test-1@slotsync/.test(ev), 'UID present');
ok(/DTSTAMP:20250825T120000Z/.test(ev), 'DTSTAMP UTC format');
ok(/DTSTART:20250901T140000/.test(ev), 'DTSTART floating local');
ok(/DTEND:20250901T160000/.test(ev), 'DTEND floating local');
ok(/RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20251208T235900/.test(ev), 'RRULE weekly + floating UNTIL');
ok(/EXDATE:20251013T140000,20251124T140000/.test(ev), 'EXDATE list');
ok(ev.indexOf('SUMMARY:') !== -1 && ev.indexOf('Dr. Zoë Åström') !== -1, 'unicode survives escaping');
ok(/\\;/.test(ev) && /\\,/.test(ev) && /\\\\/.test(ev), 'TEXT escaping (; , \\)');
ok(/DESCRIPTION:.*\\n/.test(ev.replace(/\r\n[ ]/g, '')), 'newline escaped as \\n in DESCRIPTION');

/* unfolding the event must reproduce single logical lines; each physical line ≤ 75 octets */
ev.split('\r\n').forEach(function (line, i) {
  ok(Buffer.byteLength(line, 'utf8') <= 75, 'folded line ' + i + ' ≤ 75 octets (' + Buffer.byteLength(line, 'utf8') + ')');
});
const unfolded = Cal.unfold(ev);
ok(unfolded.some(function (l) { return l.indexOf('SUMMARY:') === 0; }), 'unfold restores SUMMARY');
ok(unfolded.length < ev.split('\r\n').length || Buffer.byteLength(ev, 'utf8') <= 75 * ev.split('\r\n').length,
  'folding actually happened for long content');

const cal = Cal.buildCalendar([ev], { name: 'Test cal' });
ok(cal.indexOf('BEGIN:VCALENDAR\r\n') === 0, 'VCALENDAR starts with CRLF structure');
ok(/\r\nEND:VCALENDAR\r\n$/.test(cal), 'VCALENDAR ends with CRLF');
ok(/VERSION:2\.0\r\n/.test(cal) && /PRODID:/.test(cal), 'VERSION + PRODID');
ok(!/[^\r]\n/.test(cal), 'no bare LF (all CRLF)');

/* ---------- 2 · URL builders ---------- */
section('URL builders');

const g = Cal.googleUrl({
  title: 'Office hours — Åström & Lee', startDate: '2025-09-02', startMin: 14 * 60,
  endDate: '2025-09-02', endMin: 14 * 60 + 20,
  details: 'Requested by: 小明 <x@uni.edu>', location: 'https://zoom.us/j/123?pwd=a&b=c', ctz: 'America/New_York'
});
const gUrl = new URL(g);
eq(gUrl.host, 'calendar.google.com', 'Google host');
eq(gUrl.pathname, '/calendar/render', 'Google path');
eq(gUrl.searchParams.get('action'), 'TEMPLATE', 'Google action=TEMPLATE');
eq(gUrl.searchParams.get('text'), 'Office hours — Åström & Lee', 'Google text decoded');
eq(gUrl.searchParams.get('dates'), '20250902T140000/20250902T142000', 'Google dates compact local');
eq(gUrl.searchParams.get('ctz'), 'America/New_York', 'Google ctz');
eq(gUrl.searchParams.get('details'), 'Requested by: 小明 <x@uni.edu>', 'Google details unicode round-trip');
eq(gUrl.searchParams.get('location'), 'https://zoom.us/j/123?pwd=a&b=c', 'Google location with & = preserved');

const o = Cal.outlookUrl({
  title: 'Office hours', startDate: '2025-09-02', startMin: 9 * 60 + 5,
  endDate: '2025-09-02', endMin: 9 * 60 + 25, body: 'Body text', location: 'Room 4'
});
const oUrl = new URL(o);
eq(oUrl.host, 'outlook.live.com', 'Outlook host');
eq(oUrl.searchParams.get('rru'), 'addevent', 'Outlook rru=addevent');
eq(oUrl.searchParams.get('subject'), 'Office hours', 'Outlook subject');
eq(oUrl.searchParams.get('startdt'), '2025-09-02T09:05:00', 'Outlook startdt ISO');
eq(oUrl.searchParams.get('enddt'), '2025-09-02T09:25:00', 'Outlook enddt ISO');
eq(oUrl.searchParams.get('location'), 'Room 4', 'Outlook location');

/* ---------- 3 · config round-trip ---------- */
section('config encode/decode');

const cfg = Cfg.emptyConfig();
cfg.prof = { name: 'Dr. Zoë Åström 中文 — “quotes”', course: 'ECON 201 · 中文课', email: 'za@uni.edu' };
cfg.semester = { start: '2025-09-01', end: '2025-12-12' };
cfg.blocks = [
  { id: 'bA', day: 2, start: '14:00', end: '16:00', slotMin: 20, loc: { mode: 'zoom', value: 'https://zoom.us/j/111' } },
  { id: 'bB', day: 4, start: '10:00', end: '11:00', slotMin: 15, loc: { mode: 'room', value: 'Warren 312' } }
];
cfg.blackouts = ['2025-10-14', '2025-11-27'];
cfg.overrides = [{ week: '2025-10-06', cancel: true }, { week: '2025-11-03', blockId: 'bA', day: 3, start: '15:00', end: '17:00' }];
cfg.rules = { cap: 2, horizonDays: 14, bufferMin: 5 };
cfg.claimed = [{ date: '2025-09-02', startMin: 840, name: 'First Student' }];

const encoded = Cfg.encodeConfig(cfg);
ok(/^[A-Za-z0-9_-]+$/.test(encoded), 'base64url alphabet only');
const rt = Cfg.decodeConfig(encoded);
ok(rt.ok, 'round-trip decodes: ' + rt.errors.join('; '));
eq(JSON.stringify(rt.config), JSON.stringify(Cfg.validateConfig(cfg).config), 'round-trip deep equality');
eq(rt.config.prof.name, cfg.prof.name, 'unicode name exact');

const link = Cfg.buildBookingLink('https://me.github.io/slotsync/#old=1', cfg);
ok(link === 'https://me.github.io/slotsync/#book=' + encoded, 'booking link replaces old hash');
eq(Cfg.extractBookParam('#book=' + encoded), encoded, 'extractBookParam');
const bad = Cfg.decodeConfig('!!!not-base64!!!');
ok(!bad.ok, 'corrupt link rejected gracefully');

/* ---------- 4 · slot generation ---------- */
section('slot generation');

/* Semester Mon 2025-09-01 → Fri 2025-12-12 (15 weeks).
 * Block A: Tue 14:00–16:00, 20-min slots, 5-min buffer → floor(120/25)=4 slots/day.
 * Block B: Thu 10:00–11:00, 15-min, buffer 5 → 3 slots/day. */
const all = Slots.generateSlots(cfg, {});
const tuesdays = all.filter(s => Cal.dayOfWeek(s.date) === 2 && !s.moved);
const thursdays = all.filter(s => Cal.dayOfWeek(s.date) === 4);
/* Tue block: 840→960 with step 25 → s ∈ {840,865,890,915,940} = 5 slots/day.
 * 15 Tuesdays, minus blackout Oct 14, minus canceled-week Tue Oct 7,
 * minus moved-week Tue Nov 4 → 12 days × 5 = 60 */
eq(tuesdays.length, 60, 'tuesday slots after blackout/cancel/move');
/* Thu occurrences: 15, minus blackout Nov 27, minus canceled week Oct 6 → 13 days × 3 = 39 */
eq(thursdays.length, 39, 'thursday slots after blackout/cancel');
/* moved block: Wed Nov 5, 900→1020 step 25 → {900,925,950,975,1000} = 5 slots */
const moved = all.filter(s => s.moved);
eq(moved.length, 5, 'moved-override slots');
eq(moved[0].date, '2025-11-05', 'moved to Wednesday');
eq(moved[0].startMin, 900, 'moved start 15:00');
/* and the original Tue Nov 4 instance is gone */
ok(!all.some(s => s.date === '2025-11-04' && !s.moved), 'original instance removed in move week');
ok(all.every(s => s.date !== '2025-10-14'), 'blackout date has no slots');
ok(all.every(s => Slots.weekStart(s.date) !== '2025-10-06'), 'canceled week has no slots');
/* claims */
const claimed = all.filter(s => s.taken);
eq(claimed.length, 1, 'one claimed slot');
eq(claimed[0].date, '2025-09-02', 'claimed slot date');
/* claimed slot belongs to week 2025-09-01 */
eq(Slots.claimedInWeek(cfg, '2025-09-01', 'first student'), 1, 'claimedInWeek by name');
eq(Slots.claimedInWeek(cfg, '2025-09-08', 'first student'), 0, 'claimedInWeek other week');
/* weeks */
const weeks = Slots.semesterWeeks(cfg);
eq(weeks[0], '2025-09-01', 'first week Monday');
eq(weeks.length, 15, 'semester week count');
/* weekly cap sanity: cap=2, 1 claimed → room for 1 more */
ok(Slots.claimedInWeek(cfg, '2025-09-01', 'first student') < cfg.rules.cap, 'cap not yet exceeded');

/* ---------- 5 · professor calendar export ---------- */
section('professor .ics export');

const pevs = Slots.professorCalendarEvents(cfg);
eq(pevs.length, 3, 'two recurring blocks + one moved single event');
const evA = pevs[0], evB = pevs[1];
eq(evA.startDate, '2025-09-02', 'block A first occurrence (Tue)');
ok(evA.rrule && evA.rrule.byday[0] === 'TU' && evA.rrule.until === '2025-12-12', 'block A RRULE');
/* EXDATEs for block A: blackout Oct 14 (Tue), canceled-week Tue Oct 7, moved-week Tue Nov 4 */
const exA = evA.exdates.map(x => x.date).sort();
eq(JSON.stringify(exA), JSON.stringify(['2025-10-07', '2025-10-14', '2025-11-04']), 'block A EXDATEs');
eq(evB.startDate, '2025-09-04', 'block B first occurrence (Thu)');
const exB = evB.exdates.map(x => x.date).sort();
eq(JSON.stringify(exB), JSON.stringify(['2025-10-09', '2025-11-27']), 'block B EXDATEs');
eq(pevs[2].startDate, '2025-11-05', 'moved single event date');
ok(!pevs[2].rrule, 'moved event is single (no RRULE)');
const pcal = Cal.buildCalendar(pevs.map(e => Cal.buildVEvent(e)), {});
eq((pcal.match(/BEGIN:VEVENT/g) || []).length, 3, 'export has 3 VEVENTs');

/* ---------- 6 · .ics import + blackout suggestions ---------- */
section('ics import');

const imported = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:x1@uni',
  'DTSTAMP:20250820T000000Z',
  'DTSTART:20250902T143000',
  'DTEND:20250902T153000',
  'SUMMARY:Faculty meeting',
  'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20250930T235900',
  'EXDATE:20250916T143000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:x2@uni',
  'DTSTAMP:20250820T000000Z',
  'DTSTART:20251016T100000',
  'DTEND:20251016T120000',
  'SUMMARY:Conference day',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const parsed = Cal.parseIcs(imported);
eq(parsed.length, 2, 'parsed two VEVENTs');
eq(parsed[0].summary, 'Faculty meeting', 'parsed SUMMARY');
eq(parsed[0].rrule.FREQ, 'WEEKLY', 'parsed RRULE freq');
eq(parsed[0].exdates[0], '2025-09-16', 'parsed EXDATE');

const busy = Cal.expandBusy(parsed, '2025-09-01', '2025-12-12');
/* faculty meeting: Tuesdays Sep 2,9,23,30 (16th excluded) = 4; conference: Oct 16 → 5 busy */
eq(busy.length, 5, 'expanded busy intervals');
ok(!busy.some(b => b.date === '2025-09-16'), 'EXDATE excluded from expansion');

const sug = Cal.suggestBlackouts(
  [{ day: 2, startMin: 840, endMin: 960 }, { day: 4, startMin: 600, endMin: 660 }],
  '2025-09-01', '2025-12-12', imported);
const sugDates = sug.map(s => s.date);
/* colliding Tuesdays: Sep 2, 9, 23, 30 (14:30–15:30 overlaps 14:00–16:00);
 * Oct 16 is a Thursday: conference 10:00–12:00 overlaps Thu block 10:00–11:00 */
eq(JSON.stringify(sugDates), JSON.stringify(['2025-09-02', '2025-09-09', '2025-09-23', '2025-09-30', '2025-10-16']),
  'blackout suggestions');
ok(sug[0].reasons[0] === 'Faculty meeting', 'suggestion carries reason');

/* ---------- 7 · student slot event ---------- */
section('student slot event');

const slot = all.find(s => s.date === '2025-09-04' && s.startMin === 600); // Thu 10:00 room block
const sev = Slots.slotEvent(cfg, slot, { name: 'Ada', email: 'ada@uni.edu', topic: 'PS3' });
eq(sev.location, 'Warren 312', 'room goes into LOCATION');
ok(sev.description.indexOf('Ada <ada@uni.edu>') !== -1, 'student in DESCRIPTION');
ok(sev.description.indexOf('request flow') !== -1, 'honest request-flow note in DESCRIPTION');
const zslot = all.find(s => s.date === '2025-09-02' && s.startMin === 865);
const zev = Slots.slotEvent(cfg, zslot, { name: 'Ada', email: 'a@u.edu' });
eq(zev.location, 'https://zoom.us/j/111', 'Zoom link goes into LOCATION');
ok(zev.description.indexOf('Meeting link: https://zoom.us/j/111') !== -1, 'Zoom link also in DESCRIPTION');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
