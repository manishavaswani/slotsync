/* SlotSync — js/calendar.js
 * Calendar utilities, hand-rolled (no libraries, no CDN):
 *  - RFC 5545 .ics generator (VEVENT with DTSTAMP/UID/DTSTART/DTEND,
 *    weekly RRULE recurrence, EXDATE exceptions, 75-octet line folding)
 *  - Google Calendar template URL + Outlook web deep-link builders
 *  - Minimal .ics importer (unfold, parse VEVENTs, expand weekly recurrences)
 *    used to auto-suggest blackout dates from the professor's own calendar.
 *
 * Time model: all generated events use *floating local time*
 * (DTSTART:20250901T140000 — no Z, no TZID). Each importing calendar renders
 * the event in the viewer's local timezone. The file itself carries an
 * X-WR-CALDESC note stating this. This avoids inventing timezone data the
 * app does not have.
 *
 * Exposed as window.SlotSyncCalendar (classic script, no build step).
 * Also attaches to globalThis so node smoke tests can load it directly.
 */
(function (global) {
  'use strict';

  /* ---------- date/time primitives (all local, no Date timezone surprises) ---------- */

  var DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; // JS getDay() order
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 'YYYY-MM-DD' <-> local Date (noon to dodge DST edge cases)
  function parseDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  }

  function formatDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(iso, n) {
    var d = parseDate(iso);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return formatDate(d);
  }

  function dayOfWeek(iso) { // 0=Sunday … 6=Saturday
    var d = parseDate(iso);
    return d ? d.getDay() : -1;
  }

  function compareDates(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // 'HH:MM' -> minutes since midnight
  function parseTime(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  function formatTime(mins) {
    return pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
  }

  // RFC 5545 floating local DATE-TIME: YYYYMMDDTHHMMSS
  function icsLocal(dateIso, minutes) {
    return dateIso.replace(/-/g, '') + 'T' + formatTime(minutes).replace(':', '') + '00';
  }

  // RFC 5545 UTC DATE-TIME (for DTSTAMP): YYYYMMDDTHHMMSSZ
  function icsUtc(d) {
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
      'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }

  // YYYYMMDDTHHMMSS (floating) — used by Google/Outlook deep links
  function compactLocal(dateIso, minutes) {
    return dateIso.replace(/-/g, '') + 'T' + formatTime(minutes).replace(':', '') + '00';
  }

  /* ---------- RFC 5545 text encoding ---------- */

  // Escape TEXT values: backslash, semicolon, comma, newlines (RFC 5545 §3.3.11)
  function escapeText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  function utf8Length(s) {
    if (typeof TextEncoder !== 'undefined') { return new TextEncoder().encode(s).length; }
    return unescape(encodeURIComponent(s)).length; // node fallback
  }

  /* Fold a content line to ≤75 octets (excluding CRLF), continuation lines
   * start with a single space (RFC 5545 §3.1). Never split a UTF-8 sequence. */
  function foldLine(line) {
    if (utf8Length(line) <= 75) return line;
    var out = [], cur = '', curLen = 0, limit = 75;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var chLen = utf8Length(ch);
      if (curLen + chLen > limit) {
        out.push(cur);
        cur = ' ' + ch;          // continuation line begins with a space
        curLen = 1 + chLen;
        limit = 75;
      } else {
        cur += ch;
        curLen += chLen;
      }
    }
    out.push(cur);
    return out.join('\r\n');
  }

  /* ---------- .ics generation ---------- */

  var uidCounter = 0;

  function makeUid(domain) {
    uidCounter++;
    return 'slotsync-' + Date.now().toString(36) + '-' + uidCounter.toString(36) +
      '-' + Math.random().toString(36).slice(2, 8) + '@' + (domain || 'slotsync.local');
  }

  /* Build one VEVENT.
   * ev = {
   *   uid?, dtstamp?(Date), summary, description?, location?,
   *   startDate:'YYYY-MM-DD', startMin:int, endDate?, endMin:int,
   *   rrule?: { byday:['MO','WE'], until:'YYYY-MM-DD' },
   *   exdates?: [{date:'YYYY-MM-DD', min:int}]   // floating local date-times
   * }
   */
  function buildVEvent(ev) {
    var lines = [];
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + (ev.uid || makeUid()));
    lines.push('DTSTAMP:' + icsUtc(ev.dtstamp || new Date()));
    lines.push('DTSTART:' + icsLocal(ev.startDate, ev.startMin));
    lines.push('DTEND:' + icsLocal(ev.endDate || ev.startDate, ev.endMin));
    lines.push('SUMMARY:' + escapeText(ev.summary || 'Event'));
    if (ev.location) lines.push('LOCATION:' + escapeText(ev.location));
    if (ev.description) lines.push('DESCRIPTION:' + escapeText(ev.description));
    if (ev.rrule) {
      var parts = ['FREQ=WEEKLY'];
      if (ev.rrule.byday && ev.rrule.byday.length) parts.push('BYDAY=' + ev.rrule.byday.join(','));
      if (ev.rrule.until) {
        // Floating DTSTART → floating UNTIL (RFC 5545 §3.3.10)
        parts.push('UNTIL=' + icsLocal(ev.rrule.until, 23 * 60 + 59));
      }
      lines.push('RRULE:' + parts.join(';'));
    }
    if (ev.exdates && ev.exdates.length) {
      lines.push('EXDATE:' + ev.exdates.map(function (x) { return icsLocal(x.date, x.min); }).join(','));
    }
    if (ev.url) lines.push('URL:' + ev.url);
    lines.push('END:VEVENT');
    return lines.map(foldLine).join('\r\n');
  }

  /* Wrap VEVENT strings into a full VCALENDAR document (CRLF line endings). */
  function buildCalendar(vevents, opts) {
    opts = opts || {};
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SlotSync//Office Hours//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + escapeText(opts.name || 'SlotSync Office Hours'),
      'X-WR-CALDESC:' + escapeText(opts.description ||
        'Generated by SlotSync. Times are floating local time: your calendar shows them in your own timezone.')
    ];
    var body = lines.map(foldLine).join('\r\n') + '\r\n' +
      vevents.join('\r\n') + '\r\n' +
      'END:VCALENDAR\r\n';
    return body;
  }

  /* ---------- Google Calendar / Outlook deep links ---------- */

  /* Google "render template" URL. Times are floating local; ctz pins the
   * timezone when the caller knows it (browser passes its own). */
  function googleUrl(opts) {
    var q = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
    q += '&text=' + encodeURIComponent(opts.title || 'Office hours');
    q += '&dates=' + compactLocal(opts.startDate, opts.startMin) + '/' +
      compactLocal(opts.endDate || opts.startDate, opts.endMin);
    var ctz = opts.ctz || (typeof Intl !== 'undefined' && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().timeZone : null);
    if (ctz) q += '&ctz=' + encodeURIComponent(ctz);
    if (opts.details) q += '&details=' + encodeURIComponent(opts.details);
    if (opts.location) q += '&location=' + encodeURIComponent(opts.location);
    return q;
  }

  /* Outlook on the web deep link (ISO-8601 local datetimes). */
  function outlookUrl(opts) {
    function iso(date, min) {
      return date + 'T' + formatTime(min) + ':00';
    }
    var q = 'https://outlook.live.com/calendar/deeplink/compose?path=/calendar/action/compose&rru=addevent';
    q += '&subject=' + encodeURIComponent(opts.title || 'Office hours');
    q += '&startdt=' + encodeURIComponent(iso(opts.startDate, opts.startMin));
    q += '&enddt=' + encodeURIComponent(iso(opts.endDate || opts.startDate, opts.endMin));
    if (opts.body) q += '&body=' + encodeURIComponent(opts.body);
    if (opts.location) q += '&location=' + encodeURIComponent(opts.location);
    return q;
  }

  /* ---------- .ics import (parse + expand) ---------- */

  /* Unfold continuation lines, split on CRLF/LF. */
  function unfold(text) {
    var raw = String(text || '').split(/\r\n|\r|\n/);
    var lines = [];
    for (var i = 0; i < raw.length; i++) {
      var l = raw[i];
      if ((l.charAt(0) === ' ' || l.charAt(0) === '\t') && lines.length) {
        lines[lines.length - 1] += l.slice(1);
      } else if (l.length) {
        lines.push(l);
      }
    }
    return lines;
  }

  function unescapeText(s) {
    return String(s || '')
      .replace(/\\n/gi, '\n')
      .replace(/\\;/g, ';')
      .replace(/\\,/g, ',')
      .replace(/\\\\/g, '\\');
  }

  // Parse a DATE-TIME / DATE value (floating, UTC, or date-only).
  function parseIcsDateTime(v) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(v || '');
    if (!m) return null;
    return {
      date: m[1] + '-' + m[2] + '-' + m[3],
      min: m[4] ? (+m[4]) * 60 + (+m[5]) : 0,
      dateOnly: !m[4]
    };
  }

  function parseRRule(v) {
    var rule = {};
    String(v || '').split(';').forEach(function (part) {
      var kv = part.split('=');
      if (kv.length === 2) rule[kv[0].toUpperCase()] = kv[1].toUpperCase();
    });
    if (rule.BYDAY) rule.BYDAY = rule.BYDAY.split(',');
    if (rule.COUNT) rule.COUNT = parseInt(rule.COUNT, 10);
    if (rule.UNTIL) {
      var u = parseIcsDateTime(rule.UNTIL);
      rule.UNTIL = u ? u.date : null;
    }
    return rule;
  }

  /* Parse a VCALENDAR string into plain event objects:
   * { uid, summary, location, start:{date,min}, end:{date,min}, rrule?, exdates:['YYYY-MM-DDTHH:MM'] } */
  function parseIcs(text) {
    var lines = unfold(text);
    var events = [], cur = null, i, m;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
      if (line === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; continue; }
      if (!cur) continue;
      m = /^([A-Z0-9-]+)(?:;[^:]*)?:(.*)$/.exec(line);
      if (!m) continue;
      var prop = m[1], val = m[2];
      if (prop === 'DTSTART') { cur.start = parseIcsDateTime(val); }
      else if (prop === 'DTEND') { cur.end = parseIcsDateTime(val); }
      else if (prop === 'SUMMARY') { cur.summary = unescapeText(val); }
      else if (prop === 'LOCATION') { cur.location = unescapeText(val); }
      else if (prop === 'UID') { cur.uid = val; }
      else if (prop === 'RRULE') { cur.rrule = parseRRule(val); }
      else if (prop === 'EXDATE') {
        val.split(',').forEach(function (x) {
          var d = parseIcsDateTime(x);
          if (d) cur.exdates.push(d.date);
        });
      }
    }
    // default end = start + 60min when DTEND is missing
    events.forEach(function (ev) {
      if (!ev.end) ev.end = { date: ev.start.date, min: ev.start.min + 60 };
    });
    return events;
  }

  /* Expand parsed events into concrete busy intervals within [fromDate, toDate]
   * (inclusive, 'YYYY-MM-DD'). Weekly RRULEs are expanded by weekday; EXDATEs
   * are skipped. Returns [{date, startMin, endMin, summary}]. */
  function expandBusy(events, fromDate, toDate) {
    var busy = [];
    events.forEach(function (ev) {
      if (!ev.start) return;
      var duration = ((parseDate(ev.end.date) - parseDate(ev.start.date)) / 60000) + ev.end.min - ev.start.min;
      if (!(duration > 0)) duration = 60; // defensive: DTEND missing/zero-length
      function push(dateIso) {
        if (compareDates(dateIso, fromDate) < 0 || compareDates(dateIso, toDate) > 0) return;
        if (ev.exdates && ev.exdates.indexOf(dateIso) !== -1) return;
        busy.push({ date: dateIso, startMin: ev.start.min, endMin: ev.start.min + duration, summary: ev.summary || 'Busy' });
      }
      if (!ev.rrule || ev.rrule.FREQ !== 'WEEKLY') {
        push(ev.start.date);
        return;
      }
      var days = (ev.rrule.BYDAY && ev.rrule.BYDAY.length)
        ? ev.rrule.BYDAY.map(function (c) { return DAY_CODES.indexOf(c.slice(-2)); })
        : [dayOfWeek(ev.start.date)];
      var until = ev.rrule.UNTIL || toDate;
      var count = ev.rrule.COUNT || Infinity;
      var cursor = ev.start.date, emitted = 0;
      for (var guard = 0; guard < 7 * 600 && compareDates(cursor, until) <= 0 && compareDates(cursor, toDate) <= 0; guard++) {
        if (days.indexOf(dayOfWeek(cursor)) !== -1 && compareDates(cursor, ev.start.date) >= 0) {
          push(cursor);
          emitted++;
          if (emitted >= count) break;
        }
        cursor = addDays(cursor, 1);
      }
    });
    return busy;
  }

  /* ---------- blackout suggestions from an imported calendar ---------- */

  /* Given slot blocks ([{day, startMin, endMin, ...}]) covering a semester and a
   * busy interval list, return the dates on which at least one block window
   * collides with a busy interval → suggested blackout dates. */
  function suggestBlackouts(blocks, semesterStart, semesterEnd, icsText) {
    var events = parseIcs(icsText);
    var busy = expandBusy(events, semesterStart, semesterEnd);
    var suggestions = {};
    busy.forEach(function (b) {
      var dow = dayOfWeek(b.date);
      blocks.forEach(function (blk) {
        if (blk.day !== dow) return;
        if (b.startMin < blk.endMin && b.endMin > blk.startMin) {
          if (!suggestions[b.date]) suggestions[b.date] = [];
          suggestions[b.date].push(b.summary);
        }
      });
    });
    return Object.keys(suggestions).sort().map(function (date) {
      return { date: date, reasons: suggestions[date] };
    });
  }

  /* ---------- exports ---------- */

  global.SlotSyncCalendar = {
    DAY_CODES: DAY_CODES,
    DAY_NAMES: DAY_NAMES,
    pad2: pad2,
    parseDate: parseDate,
    formatDate: formatDate,
    addDays: addDays,
    dayOfWeek: dayOfWeek,
    compareDates: compareDates,
    parseTime: parseTime,
    formatTime: formatTime,
    icsLocal: icsLocal,
    icsUtc: icsUtc,
    escapeText: escapeText,
    foldLine: foldLine,
    makeUid: makeUid,
    buildVEvent: buildVEvent,
    buildCalendar: buildCalendar,
    googleUrl: googleUrl,
    outlookUrl: outlookUrl,
    unfold: unfold,
    parseIcs: parseIcs,
    expandBusy: expandBusy,
    suggestBlackouts: suggestBlackouts
  };
})(typeof window !== 'undefined' ? window : globalThis);
