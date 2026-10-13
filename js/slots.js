/* SlotSync — js/slots.js
 * Slot generation across a semester: weekly recurring blocks, blackout dates,
 * per-week overrides (cancel a week / move one block for one week), buffers,
 * booking horizon, weekly caps (as declared rules), and claimed slots.
 *
 * Depends on window.SlotSyncCalendar. Exposed as window.SlotSyncSlots
 * (classic script; also loads under node for smoke tests).
 */
(function (global) {
  'use strict';

  var Cal = (typeof window !== 'undefined' ? window : globalThis).SlotSyncCalendar;

  /* Monday of the ISO week containing dateIso. */
  function weekStart(dateIso) {
    var dow = Cal.dayOfWeek(dateIso);          // 0=Sun … 6=Sat
    var back = (dow + 6) % 7;                  // days since Monday
    return Cal.addDays(dateIso, -back);
  }

  function weekLabel(mondayIso) {
    var sun = Cal.addDays(mondayIso, 6);
    return 'Week of ' + mondayIso + ' – ' + sun;
  }

  /* All week Mondays intersecting the semester, in order. */
  function semesterWeeks(cfg) {
    var weeks = [];
    var first = weekStart(cfg.semester.start);
    var cur = first;
    for (var guard = 0; guard < 80 && Cal.compareDates(cur, cfg.semester.end) <= 0; guard++) {
      weeks.push(cur);
      cur = Cal.addDays(cur, 7);
    }
    return weeks;
  }

  function isWeekCanceled(cfg, mondayIso) {
    return cfg.overrides.some(function (o) { return o.week === mondayIso && o.cancel; });
  }

  /* Effective blocks for a given date: apply move-overrides for that week. */
  function blocksForDate(cfg, dateIso) {
    var monday = weekStart(dateIso);
    var dow = Cal.dayOfWeek(dateIso);
    var result = [];
    cfg.blocks.forEach(function (blk) {
      var moved = null;
      cfg.overrides.forEach(function (o) {
        if (!o.cancel && o.week === monday && o.blockId === blk.id) moved = o;
      });
      if (moved) {
        if (moved.day === dow) {
          result.push({ block: blk, startMin: Cal.parseTime(moved.start), endMin: Cal.parseTime(moved.end), moved: true });
        }
        return; // moved block does NOT also appear on its original day this week
      }
      if (blk.day === dow) {
        result.push({ block: blk, startMin: Cal.parseTime(blk.start), endMin: Cal.parseTime(blk.end), moved: false });
      }
    });
    return result;
  }

  /* Generate bookable slots for a date range.
   * opts: { fromDate, toDate, today } (all 'YYYY-MM-DD'; today defaults to now,
   * used only to mark past slots). Slots outside the booking horizon are
   * simply not generated (the range is already clamped by the caller/UI).
   * Returns [{date, startMin, endMin, week, blockId, loc, moved, taken, past}]. */
  function generateSlots(cfg, opts) {
    opts = opts || {};
    var from = opts.fromDate || cfg.semester.start;
    var to = opts.toDate || cfg.semester.end;
    if (Cal.compareDates(from, cfg.semester.start) < 0) from = cfg.semester.start;
    if (Cal.compareDates(to, cfg.semester.end) > 0) to = cfg.semester.end;
    var today = opts.today || Cal.formatDate(new Date());
    var buffer = cfg.rules.bufferMin || 0;
    var claimed = {};
    (cfg.claimed || []).forEach(function (c) { claimed[c.date + '@' + c.startMin] = c; });

    var slots = [];
    for (var d = from, guard = 0; Cal.compareDates(d, to) <= 0 && guard < 400; d = Cal.addDays(d, 1), guard++) {
      if (cfg.blackouts.indexOf(d) !== -1) continue;
      var monday = weekStart(d);
      if (isWeekCanceled(cfg, monday)) continue;
      blocksForDate(cfg, d).forEach(function (inst) {
        var blk = inst.block;
        for (var s = inst.startMin; s + blk.slotMin <= inst.endMin; s += blk.slotMin + buffer) {
          slots.push({
            date: d,
            startMin: s,
            endMin: s + blk.slotMin,
            week: monday,
            blockId: blk.id,
            loc: { mode: blk.loc.mode, value: blk.loc.value },
            moved: inst.moved,
            taken: !!claimed[d + '@' + s],
            past: Cal.compareDates(d, today) < 0
          });
        }
      });
    }
    slots.sort(function (a, b) {
      return Cal.compareDates(a.date, b.date) || (a.startMin - b.startMin);
    });
    return slots;
  }

  /* Slots for one week (Monday), horizon/claims applied. */
  function slotsForWeek(cfg, mondayIso, opts) {
    opts = opts || {};
    return generateSlots(cfg, {
      fromDate: mondayIso,
      toDate: Cal.addDays(mondayIso, 6),
      today: opts.today
    });
  }

  /* How many slots a student has already claimed in a week (from cfg.claimed). */
  function claimedInWeek(cfg, mondayIso, emailOrName) {
    var key = String(emailOrName || '').trim().toLowerCase();
    if (!key) return 0;
    var n = 0;
    (cfg.claimed || []).forEach(function (c) {
      if (weekStart(c.date) === mondayIso && String(c.name || '').trim().toLowerCase() === key) n++;
    });
    return n;
  }

  /* ---------- professor's own calendar export ---------- */

  /* Build VEVENT descriptors for "Add all my office hours to my calendar":
   * one weekly-recurring event per block (RRULE … UNTIL semester end), with
   * EXDATEs for blackouts and fully canceled weeks, plus single VEVENTs for
   * move-overrides. Times are floating local (see js/calendar.js note). */
  function professorCalendarEvents(cfg) {
    var events = [];
    var title = function () {
      return 'Office hours' + (cfg.prof.course ? ' — ' + cfg.prof.course : '') +
        (cfg.prof.name ? ' (' + cfg.prof.name + ')' : '');
    };
    var locText = function (loc) {
      if (loc.mode === 'room') return loc.value || 'Office (room TBA)';
      return loc.value || '';
    };
    var descFor = function (blk) {
      return 'Weekly office hours block, ' + Cal.formatTime(Cal.parseTime(blk.start)) +
        '–' + Cal.formatTime(Cal.parseTime(blk.end)) +
        ', ' + blk.slotMin + '-minute slots. Generated by SlotSync.';
    };
    cfg.blocks.forEach(function (blk) {
      var sMin = Cal.parseTime(blk.start), eMin = Cal.parseTime(blk.end);
      // find the first in-semester occurrence of this weekday
      var first = cfg.semester.start;
      while (Cal.dayOfWeek(first) !== blk.day && Cal.compareDates(first, cfg.semester.end) <= 0) {
        first = Cal.addDays(first, 1);
      }
      if (Cal.compareDates(first, cfg.semester.end) > 0) return;
      // EXDATEs: blackouts on this weekday + dates inside canceled weeks
      var exdates = [];
      cfg.blackouts.forEach(function (d) {
        if (Cal.dayOfWeek(d) === blk.day &&
            Cal.compareDates(d, first) >= 0 && Cal.compareDates(d, cfg.semester.end) <= 0) {
          exdates.push({ date: d, min: sMin });
        }
      });
      cfg.overrides.forEach(function (o) {
        if (o.cancel) {
          var d = o.week;
          for (var i = 0; i < 7; i++, d = Cal.addDays(d, 1)) {
            if (Cal.dayOfWeek(d) === blk.day &&
                Cal.compareDates(d, first) >= 0 && Cal.compareDates(d, cfg.semester.end) <= 0) {
              exdates.push({ date: d, min: sMin });
            }
          }
        } else if (o.blockId === blk.id) {
          // moved this week: cancel the original occurrence…
          var orig = o.week;
          for (var j = 0; j < 7; j++, orig = Cal.addDays(orig, 1)) {
            if (Cal.dayOfWeek(orig) === blk.day) {
              exdates.push({ date: orig, min: sMin });
            }
          }
        }
      });
      events.push({
        summary: title(),
        location: locText(blk.loc),
        description: descFor(blk),
        startDate: first, startMin: sMin,
        endDate: first, endMin: eMin,
        rrule: { byday: [Cal.DAY_CODES[blk.day]], until: cfg.semester.end },
        exdates: exdates
      });
    });
    // moved blocks: one-off single events
    cfg.overrides.forEach(function (o) {
      if (o.cancel || !o.blockId) return;
      var blk = null;
      cfg.blocks.forEach(function (b) { if (b.id === o.blockId) blk = b; });
      if (!blk) return;
      var date = o.week;
      for (var i = 0; i < 7; i++, date = Cal.addDays(date, 1)) {
        if (Cal.dayOfWeek(date) === o.day) break;
      }
      if (Cal.compareDates(date, cfg.semester.end) > 0) return;
      events.push({
        summary: title() + ' (moved this week)',
        location: locText(blk.loc),
        description: 'One-week schedule change.',
        startDate: date, startMin: Cal.parseTime(o.start),
        endDate: date, endMin: Cal.parseTime(o.end)
      });
    });
    return events;
  }

  /* Single-slot VEVENT descriptor for a student's booking. */
  function slotEvent(cfg, slot, student) {
    var locText = slot.loc.mode === 'room' ? (slot.loc.value || 'Office (room TBA)') : (slot.loc.value || '');
    var descLines = [
      'Office hours with ' + (cfg.prof.name || 'the professor') +
        (cfg.prof.course ? ' — ' + cfg.prof.course : '') + '.',
      'Requested by: ' + (student.name || '') + (student.email ? ' <' + student.email + '>' : ''),
      'Note: this is a request flow — the professor confirms the booking by replying to the request email.'
    ];
    if (slot.loc.mode !== 'room' && slot.loc.value) {
      descLines.push('Meeting link: ' + slot.loc.value);
    }
    return {
      summary: 'Office hours — ' + (cfg.prof.name || 'Professor') +
        (cfg.prof.course ? ' (' + cfg.prof.course + ')' : ''),
      location: locText,
      description: descLines.join('\n'),
      startDate: slot.date, startMin: slot.startMin,
      endDate: slot.date, endMin: slot.endMin
    };
  }

  /* Human-readable slot label, e.g. "Tue Sep 2, 2:00–2:20 PM". */
  function slotLabel(slot) {
    var d = Cal.parseDate(slot.date);
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function t(min) {
      var h = Math.floor(min / 60), m = min % 60, ap = h >= 12 ? 'PM' : 'AM';
      var hh = h % 12; if (hh === 0) hh = 12;
      return hh + ':' + Cal.pad2(m) + ' ' + ap;
    }
    return days[d.getDay()] + ' ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' +
      t(slot.startMin) + '–' + t(slot.endMin);
  }

  global.SlotSyncSlots = {
    weekStart: weekStart,
    weekLabel: weekLabel,
    semesterWeeks: semesterWeeks,
    isWeekCanceled: isWeekCanceled,
    blocksForDate: blocksForDate,
    generateSlots: generateSlots,
    slotsForWeek: slotsForWeek,
    claimedInWeek: claimedInWeek,
    professorCalendarEvents: professorCalendarEvents,
    slotEvent: slotEvent,
    slotLabel: slotLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
