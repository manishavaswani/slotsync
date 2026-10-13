/* SlotSync — app.js
 * UI wiring for both modes of the app:
 *   professor mode — no #book= hash: configure schedule → booking link
 *   student mode   — #book= hash present: pick a slot → request flow outputs
 * Depends on: js/calendar.js, js/config.js, js/slots.js
 */
(function () {
  'use strict';

  var Cal = window.SlotSyncCalendar;
  var Cfg = window.SlotSyncConfig;
  var Slots = window.SlotSyncSlots;

  /* ---------- tiny DOM helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function setError(el, msg) {
    if (msg) { el.textContent = msg; show(el); } else { el.textContent = ''; hide(el); }
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function copyText(text, btn) {
    function done() {
      var old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = old; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
    } else {
      legacyCopy(text);
      done();
    }
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable */ }
    document.body.removeChild(ta);
  }
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Could not read file')); };
      reader.readAsText(file);
    });
  }

  var LOC_LABELS = { room: 'Room', zoom: 'Zoom', teams: 'Teams', meet: 'Meet' };

  /* ================================================================
   * Mode routing
   * ================================================================ */
  var bookParam = Cfg.extractBookParam(location.hash);
  if (bookParam) { initStudent(bookParam); } else { initProfessor(); }

  /* ================================================================
   * PROFESSOR MODE
   * ================================================================ */
  function initProfessor() {
    var state = Cfg.emptyConfig();

    /* sensible defaults: next Monday → +15 weeks, one Tue 14:00–16:00 block */
    var today = Cal.formatDate(new Date());
    var nextMon = Slots.weekStart(Cal.addDays(today, 7));
    state.semester.start = nextMon;
    state.semester.end = Cal.addDays(nextMon, 15 * 7 - 1);
    state.blocks.push({
      id: Cfg.makeBlockId(), day: 2, start: '14:00', end: '16:00',
      slotMin: 20, loc: { mode: 'room', value: '' }
    });

    $('sem-start').value = state.semester.start;
    $('sem-end').value = state.semester.end;

    /* ---------- block editor ---------- */

    function blockCard(blk, index) {
      var card = el('div', 'block-card');
      card.dataset.blockId = blk.id;

      var head = el('div', 'block-card-head');
      head.appendChild(el('h4', null, 'Block ' + (index + 1)));
      var rm = el('button', 'btn ghost', 'Remove');
      rm.type = 'button';
      rm.addEventListener('click', function () {
        state.blocks = state.blocks.filter(function (b) { return b.id !== blk.id; });
        renderBlocks(); refreshOverrideBlocks(); updateLink();
      });
      head.appendChild(rm);
      card.appendChild(head);

      var grid = el('div', 'block-grid');

      grid.appendChild(labeled('Day of week', select(
        Cal.DAY_NAMES.map(function (n, i) { return [i, n]; }),
        blk.day,
        function (v) { blk.day = parseInt(v, 10); refreshOverrideBlocks(); updateLink(); }
      )));

      grid.appendChild(labeled('Start', timeInput(blk.start, function (v) { blk.start = v; updateLink(); })));
      grid.appendChild(labeled('End', timeInput(blk.end, function (v) { blk.end = v; updateLink(); })));
      grid.appendChild(labeled('Slot length', select(
        Cfg.SLOT_LENGTHS.map(function (m) { return [m, m + ' min']; }),
        blk.slotMin,
        function (v) { blk.slotMin = parseInt(v, 10); updateLink(); }
      )));
      grid.appendChild(labeled('Location', select(
        [['room', 'In-person (room)'], ['zoom', 'Zoom link'], ['teams', 'Teams link'], ['meet', 'Google Meet link']],
        blk.loc.mode,
        function (v) { blk.loc.mode = v; renderBlocks(); updateLink(); }
      )));
      card.appendChild(grid);

      var locWrap = el('div');
      locWrap.style.marginTop = '0.7rem';
      var locInput = el('input', 'text-input');
      locInput.type = blk.loc.mode === 'room' ? 'text' : 'url';
      locInput.value = blk.loc.value;
      locInput.placeholder = blk.loc.mode === 'room'
        ? 'e.g. Warren Hall 312'
        : 'Paste your standing ' + LOC_LABELS[blk.loc.mode] + ' meeting link (https://…)';
      locInput.addEventListener('input', function () { blk.loc.value = locInput.value; updateLink(); });
      locWrap.appendChild(labeled(
        blk.loc.mode === 'room' ? 'Room' : 'Standing ' + LOC_LABELS[blk.loc.mode] + ' link', locInput));
      if (blk.loc.mode !== 'room') {
        locWrap.appendChild(el('p', 'loc-note',
          'Create one recurring/standing meeting in ' + LOC_LABELS[blk.loc.mode] +
          ' and paste its link here — SlotSync attaches this same link to every booking in this block.'));
      }
      card.appendChild(locWrap);
      return card;
    }

    function labeled(labelText, control) {
      var wrap = el('div');
      var lab = el('label', 'field-label', labelText);
      wrap.appendChild(lab);
      wrap.appendChild(control);
      return wrap;
    }

    function select(pairs, current, onChange) {
      var s = el('select');
      pairs.forEach(function (p) {
        var o = el('option', null, String(p[1]));
        o.value = String(p[0]);
        if (String(p[0]) === String(current)) o.selected = true;
        s.appendChild(o);
      });
      s.addEventListener('change', function () { onChange(s.value); });
      return s;
    }

    function timeInput(value, onChange) {
      var t = el('input', 'text-input');
      t.type = 'time';
      t.value = value;
      t.addEventListener('change', function () { if (t.value) onChange(t.value); });
      return t;
    }

    function renderBlocks() {
      var list = $('blocks-list');
      list.innerHTML = '';
      state.blocks.forEach(function (blk, i) { list.appendChild(blockCard(blk, i)); });
    }

    $('block-add').addEventListener('click', function () {
      state.blocks.push({
        id: Cfg.makeBlockId(), day: 4, start: '10:00', end: '12:00',
        slotMin: 20, loc: { mode: 'room', value: '' }
      });
      renderBlocks(); refreshOverrideBlocks(); updateLink();
    });

    /* ---------- identity / semester / rules fields ---------- */

    function bindText(id, fn) {
      $(id).addEventListener('input', function () { fn($(id).value); updateLink(); });
    }
    bindText('prof-name', function (v) { state.prof.name = v; });
    bindText('prof-course', function (v) { state.prof.course = v; });
    bindText('prof-email', function (v) { state.prof.email = v; });
    bindText('sem-start', function (v) { state.semester.start = v; refreshOverrideWeeks(); });
    bindText('sem-end', function (v) { state.semester.end = v; refreshOverrideWeeks(); });
    bindText('rule-cap', function (v) { state.rules.cap = parseInt(v, 10) || 1; });
    bindText('rule-horizon', function (v) { state.rules.horizonDays = parseInt(v, 10) || 21; });
    bindText('rule-buffer', function (v) { state.rules.bufferMin = parseInt(v, 10) || 0; });

    /* ---------- blackouts ---------- */

    function renderBlackouts() {
      var ul = $('blackout-list');
      ul.innerHTML = '';
      state.blackouts.slice().sort().forEach(function (d) {
        var li = el('li');
        li.appendChild(el('span', null, d + ' (' + Cal.DAY_NAMES[Cal.dayOfWeek(d)].slice(0, 3) + ')'));
        var rm = el('button', 'chip-remove', '×');
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Remove blackout ' + d);
        rm.addEventListener('click', function () {
          state.blackouts = state.blackouts.filter(function (x) { return x !== d; });
          renderBlackouts(); updateLink();
        });
        li.appendChild(rm);
        ul.appendChild(li);
      });
    }

    $('blackout-add').addEventListener('click', function () {
      var d = $('blackout-date').value;
      if (!d) return;
      if (state.blackouts.indexOf(d) === -1) state.blackouts.push(d);
      $('blackout-date').value = '';
      renderBlackouts(); updateLink();
    });

    /* ---------- per-week overrides ---------- */

    function refreshOverrideWeeks() {
      var sel = $('override-week');
      sel.innerHTML = '';
      if (!state.semester.start || !state.semester.end || state.semester.start > state.semester.end) {
        sel.appendChild(new Option('(set semester dates first)', ''));
        return;
      }
      Slots.semesterWeeks(state).forEach(function (monday, i) {
        sel.appendChild(new Option('Week ' + (i + 1) + ' — ' + Slots.weekLabel(monday), monday));
      });
    }

    function refreshOverrideBlocks() {
      var sel = $('override-block');
      sel.innerHTML = '';
      state.blocks.forEach(function (blk, i) {
        sel.appendChild(new Option(
          'Block ' + (i + 1) + ' (' + Cal.DAY_NAMES[blk.day].slice(0, 3) + ' ' + blk.start + '–' + blk.end + ')',
          blk.id));
      });
    }

    $('override-type').addEventListener('change', function () {
      var moving = $('override-type').value === 'move';
      ['override-block', 'override-day', 'override-start', 'override-end'].forEach(function (id) {
        $(id).classList.toggle('hidden', !moving);
      });
    });

    function renderOverrides() {
      var ul = $('override-list');
      ul.innerHTML = '';
      state.overrides.forEach(function (o, idx) {
        var li = el('li');
        var text;
        if (o.cancel) {
          text = 'Cancel week of ' + o.week;
        } else {
          var blkIdx = -1;
          state.blocks.forEach(function (b, i) { if (b.id === o.blockId) blkIdx = i; });
          text = 'Week of ' + o.week + ': move block ' + (blkIdx + 1) + ' → ' +
            Cal.DAY_NAMES[o.day] + ' ' + o.start + '–' + o.end;
        }
        li.appendChild(el('span', null, text));
        var rm = el('button', 'chip-remove', '×');
        rm.type = 'button';
        rm.addEventListener('click', function () {
          state.overrides.splice(idx, 1);
          renderOverrides(); updateLink();
        });
        li.appendChild(rm);
        ul.appendChild(li);
      });
    }

    $('override-add').addEventListener('click', function () {
      var week = $('override-week').value;
      if (!week) return;
      if ($('override-type').value === 'cancel') {
        if (state.overrides.some(function (o) { return o.week === week && o.cancel; })) return;
        state.overrides.push({ week: week, cancel: true });
      } else {
        var blkId = $('override-block').value;
        var s = $('override-start').value, e = $('override-end').value;
        if (!blkId || !s || !e || s >= e) {
          setError($('share-error'), 'Pick a block and a valid new start/end time for the move.');
          return;
        }
        // one move per block per week — replace existing
        state.overrides = state.overrides.filter(function (o) {
          return !(o.blockId === blkId && o.week === week);
        });
        state.overrides.push({ week: week, blockId: blkId, day: parseInt($('override-day').value, 10), start: s, end: e });
      }
      setError($('share-error'), '');
      renderOverrides(); updateLink();
    });

    /* ---------- .ics import → blackout suggestions ---------- */

    $('ics-import').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      readFile(file).then(function (text) {
        var box = $('ics-suggestions');
        box.innerHTML = '';
        if (!state.semester.start || !state.semester.end) {
          box.appendChild(el('p', 'hint', 'Set the semester dates first, then re-import.'));
          show(box);
          return;
        }
        var suggestions = Cal.suggestBlackouts(
          state.blocks.map(function (b) {
            return { day: b.day, startMin: Cal.parseTime(b.start), endMin: Cal.parseTime(b.end) };
          }),
          state.semester.start, state.semester.end, text);
        if (!suggestions.length) {
          box.appendChild(el('p', 'hint', 'No conflicts found between your imported calendar and your office-hour blocks during the semester.'));
          show(box);
          return;
        }
        var wrap = el('div', 'suggest-box');
        wrap.appendChild(el('strong', null,
          suggestions.length + ' possible conflict' + (suggestions.length === 1 ? '' : 's') + ' found'));
        var ul = el('ul');
        suggestions.forEach(function (s) {
          ul.appendChild(el('li', null, s.date + ' — collides with: ' + s.reasons.slice(0, 3).join('; ')));
        });
        wrap.appendChild(ul);
        var addAll = el('button', 'btn', 'Add all as blackout dates');
        addAll.type = 'button';
        addAll.addEventListener('click', function () {
          suggestions.forEach(function (s) {
            if (state.blackouts.indexOf(s.date) === -1) state.blackouts.push(s.date);
          });
          renderBlackouts(); updateLink();
          box.appendChild(el('p', 'hint', 'Added. Review the blackout list above and remove any you want to keep.'));
        });
        wrap.appendChild(addAll);
        box.appendChild(wrap);
        show(box);
      }).catch(function () {
        setError($('share-error'), 'Could not read that file — expected an .ics calendar export.');
      });
    });

    /* ---------- claimed slots ---------- */

    function renderClaims() {
      var ul = $('claim-list');
      ul.innerHTML = '';
      state.claimed.forEach(function (c, idx) {
        var li = el('li');
        li.appendChild(el('span', null,
          c.date + ' ' + Cal.formatTime(c.startMin) + (c.name ? ' — ' + c.name : '')));
        var rm = el('button', 'chip-remove', '×');
        rm.type = 'button';
        rm.addEventListener('click', function () {
          state.claimed.splice(idx, 1);
          renderClaims(); updateLink();
        });
        li.appendChild(rm);
        ul.appendChild(li);
      });
    }

    $('claim-add').addEventListener('click', function () {
      var d = $('claim-date').value, t = $('claim-time').value;
      if (!d || !t) { setError($('share-error'), 'Pick the date and start time of the claimed slot.'); return; }
      var min = Cal.parseTime(t);
      if (state.claimed.some(function (c) { return c.date === d && c.startMin === min; })) return;
      state.claimed.push({ date: d, startMin: min, name: $('claim-name').value.trim() });
      $('claim-date').value = ''; $('claim-time').value = ''; $('claim-name').value = '';
      setError($('share-error'), '');
      renderClaims(); updateLink();
    });

    /* ---------- booking link + exports ---------- */

    function currentConfig() {
      return {
        v: Cfg.CONFIG_VERSION,
        prof: { name: state.prof.name.trim(), course: state.prof.course.trim(), email: state.prof.email.trim() },
        semester: { start: state.semester.start, end: state.semester.end },
        blocks: state.blocks.map(function (b) {
          return { id: b.id, day: b.day, start: b.start, end: b.end, slotMin: b.slotMin,
                   loc: { mode: b.loc.mode, value: b.loc.value.trim() } };
        }),
        blackouts: state.blackouts.slice().sort(),
        overrides: state.overrides.slice(),
        rules: {
          cap: Math.max(1, state.rules.cap | 0),
          horizonDays: Math.max(1, state.rules.horizonDays | 0),
          bufferMin: Math.max(0, state.rules.bufferMin | 0)
        },
        claimed: state.claimed.slice()
      };
    }

    function updateLink() {
      var cfg = currentConfig();
      var res = Cfg.validateConfig(cfg);
      if (!res.ok) {
        $('booking-link-out').value = '';
        setError($('share-error'), 'Finish setup before sharing: ' + res.errors.join('; ') + '.');
        return null;
      }
      setError($('share-error'), '');
      var link = Cfg.buildBookingLink(location.href, cfg);
      $('booking-link-out').value = link;
      return link;
    }

    $('copy-link').addEventListener('click', function () {
      var link = updateLink();
      if (link) copyText(link, this);
    });

    $('preview-link').addEventListener('click', function () {
      var link = updateLink();
      if (link) window.open(link, '_blank', 'noopener');
    });

    $('download-all-ics').addEventListener('click', function () {
      var cfg = currentConfig();
      var res = Cfg.validateConfig(cfg);
      if (!res.ok) { setError($('share-error'), 'Finish setup first: ' + res.errors.join('; ') + '.'); return; }
      var events = Slots.professorCalendarEvents(res.config).map(function (ev) { return Cal.buildVEvent(ev); });
      var ics = Cal.buildCalendar(events, {
        name: 'Office hours — ' + (res.config.prof.name || 'Professor'),
        description: 'All weekly office-hour blocks for the semester (floating local time). ' +
          'Blackout dates and canceled weeks are excluded via EXDATE. Generated by SlotSync.'
      });
      download('office-hours.ics', ics, 'text/calendar;charset=utf-8');
    });

    /* initial paint */
    renderBlocks();
    renderBlackouts();
    renderOverrides();
    renderClaims();
    refreshOverrideWeeks();
    refreshOverrideBlocks();
    updateLink();
  }

  /* ================================================================
   * STUDENT MODE
   * ================================================================ */
  function initStudent(bookParam) {
    hide($('professor-view'));
    var res = Cfg.decodeConfig(bookParam);
    if (!res.ok) {
      setError($('fatal-error'), res.errors.join(' ') + ' Ask the professor for a fresh booking link.');
      $('header-tagline').textContent = 'This booking link is not valid.';
      return;
    }
    var cfg = res.config;
    show($('student-view'));
    document.title = 'Office hours — ' + (cfg.prof.name || 'Professor') + ' · SlotSync';
    $('header-tagline').textContent =
      'Booking page for ' + (cfg.prof.name || 'office hours') +
      (cfg.prof.course ? ' · ' + cfg.prof.course : '') + '.';

    $('stu-heading').textContent =
      'Office hours — ' + (cfg.prof.name || 'Professor');
    $('stu-sub').textContent =
      (cfg.prof.course ? cfg.prof.course + '. ' : '') +
      'Semester: ' + cfg.semester.start + ' to ' + cfg.semester.end + '.';
    $('stu-rules').textContent =
      'You may book up to ' + cfg.rules.cap + ' slot' + (cfg.rules.cap === 1 ? '' : 's') +
      ' per week, up to ' + cfg.rules.horizonDays + ' days ahead. ' +
      (cfg.rules.bufferMin ? 'Slots have a ' + cfg.rules.bufferMin + '-minute buffer between them. ' : '') +
      'Booking is a request: the professor confirms by replying to your email.';

    /* booking window: today → today + horizon, clamped to the semester */
    var today = Cal.formatDate(new Date());
    var windowStart = Cal.compareDates(today, cfg.semester.start) < 0 ? cfg.semester.start : today;
    var horizonEnd = Cal.addDays(today, cfg.rules.horizonDays);
    var windowEnd = Cal.compareDates(horizonEnd, cfg.semester.end) < 0 ? horizonEnd : cfg.semester.end;

    var weeks = [];
    if (Cal.compareDates(windowStart, windowEnd) <= 0) {
      var cur = Slots.weekStart(windowStart);
      while (Cal.compareDates(cur, windowEnd) <= 0 && weeks.length < 60) {
        weeks.push(cur);
        cur = Cal.addDays(cur, 7);
      }
    }
    var weekIdx = 0;
    var pickedSlot = null;

    function badgeFor(mode) {
      return el('span', 'badge ' + mode, LOC_LABELS[mode] || mode);
    }

    function renderWeek() {
      var grid = $('slot-grid');
      grid.innerHTML = '';
      var monday = weeks[weekIdx];
      $('week-label').textContent = weeks.length ? Slots.weekLabel(monday) : '';
      $('week-prev').disabled = weekIdx <= 0;
      $('week-next').disabled = weekIdx >= weeks.length - 1;

      if (!weeks.length) {
        grid.appendChild(el('p', 'empty-week',
          'No bookable slots right now — the booking window (' + cfg.rules.horizonDays +
          ' days ahead) does not overlap the remaining semester.'));
        return;
      }

      var slots = Slots.slotsForWeek(cfg, monday, { today: today })
        .filter(function (s) {
          return Cal.compareDates(s.date, windowStart) >= 0 &&
                 Cal.compareDates(s.date, windowEnd) <= 0 && !s.past;
        });

      if (!slots.length) {
        var canceled = Slots.isWeekCanceled(cfg, monday);
        grid.appendChild(el('p', 'empty-week', canceled
          ? 'Office hours are canceled this week.'
          : 'No available slots this week.'));
        return;
      }

      var byDate = {};
      slots.forEach(function (s) { (byDate[s.date] = byDate[s.date] || []).push(s); });
      Object.keys(byDate).sort().forEach(function (date) {
        var dayWrap = el('div', 'slot-day');
        dayWrap.appendChild(el('h3', null,
          Cal.DAY_NAMES[Cal.dayOfWeek(date)] + ', ' + date));
        var cards = el('div', 'slot-cards');
        byDate[date].forEach(function (s) {
          var btn = el('button', 'slot-card');
          btn.type = 'button';
          btn.appendChild(el('span', 'slot-time',
            Cal.formatTime(s.startMin) + '–' + Cal.formatTime(s.endMin)));
          btn.appendChild(badgeFor(s.loc.mode));
          if (s.moved) btn.appendChild(el('span', 'badge moved', 'Moved'));
          if (s.taken) {
            btn.appendChild(el('span', 'badge taken', 'Taken'));
            btn.disabled = true;
            btn.title = 'Already claimed by another student';
          } else {
            btn.addEventListener('click', function () { pickSlot(s); });
          }
          cards.appendChild(btn);
        });
        dayWrap.appendChild(cards);
        grid.appendChild(dayWrap);
      });
    }

    $('week-prev').addEventListener('click', function () { if (weekIdx > 0) { weekIdx--; renderWeek(); } });
    $('week-next').addEventListener('click', function () { if (weekIdx < weeks.length - 1) { weekIdx++; renderWeek(); } });

    function pickSlot(slot) {
      pickedSlot = slot;
      hide($('book-result'));
      $('book-slot-label').textContent =
        Slots.slotLabel(slot) + ' · ' +
        (slot.loc.mode === 'room'
          ? 'in person — ' + (slot.loc.value || 'room to be announced')
          : 'online via ' + LOC_LABELS[slot.loc.mode] + ' (the meeting link is included in your calendar entry and the request email)');
      show($('book-panel'));
      $('book-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    $('book-cancel').addEventListener('click', function () {
      hide($('book-panel'));
      pickedSlot = null;
    });

    $('book-confirm').addEventListener('click', function () {
      var name = $('stu-name').value.trim();
      var email = $('stu-email').value.trim();
      var topic = $('stu-topic').value.trim();
      if (!name) { setError($('book-error'), 'Please enter your name.'); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError($('book-error'), 'Please enter a valid email address.'); return; }
      if (!pickedSlot) { setError($('book-error'), 'Pick a slot first.'); return; }

      /* weekly cap vs. claimed list embedded in the link */
      if (Slots.claimedInWeek(cfg, pickedSlot.week, email) >= cfg.rules.cap ||
          Slots.claimedInWeek(cfg, pickedSlot.week, name) >= cfg.rules.cap) {
        setError($('book-error'),
          'You already have ' + cfg.rules.cap + ' booked slot' + (cfg.rules.cap === 1 ? '' : 's') +
          ' this week (the professor\'s weekly cap). Pick a different week.');
        return;
      }
      setError($('book-error'), '');
      var student = { name: name, email: email, topic: topic };
      buildOutputs(pickedSlot, student);
      hide($('book-panel'));
      show($('book-result'));
      $('book-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    function buildOutputs(slot, student) {
      var ev = Slots.slotEvent(cfg, slot, student);
      var where = slot.loc.mode === 'room'
        ? 'Room: ' + (slot.loc.value || 'to be announced')
        : LOC_LABELS[slot.loc.mode] + ' link: ' + (slot.loc.value || '(link missing — ask the professor)');
      $('result-summary').textContent =
        Slots.slotLabel(slot) + ' · ' + where +
        ' · with ' + (cfg.prof.name || 'the professor');

      /* 1 · prefilled mailto request */
      var subject = 'Office hours request — ' + Slots.slotLabel(slot) +
        (cfg.prof.course ? ' (' + cfg.prof.course + ')' : '');
      var bodyLines = [
        'Dear ' + (cfg.prof.name || 'Professor') + ',',
        '',
        'I would like to request the following office-hours slot:',
        '',
        '  Slot:   ' + Slots.slotLabel(slot),
        '  Where:  ' + where,
        '  Name:   ' + student.name,
        '  Email:  ' + student.email
      ];
      if (student.topic) bodyLines.push('  Topic:  ' + student.topic);
      bodyLines.push('', '(Requested via SlotSync. Please reply to confirm — the slot is not booked until you do.)', '');
      $('out-mailto').href = 'mailto:' + encodeURIComponent(cfg.prof.email || '') +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(bodyLines.join('\n'));

      /* 2 · .ics download */
      $('out-ics').onclick = function () {
        var ics = Cal.buildCalendar([Cal.buildVEvent(ev)], {
          name: 'Office hours booking',
          description: 'Single office-hours slot (floating local time). Generated by SlotSync.'
        });
        download('office-hours-' + slot.date.replace(/-/g, '') + '-' +
          Cal.formatTime(slot.startMin).replace(':', '') + '.ics',
          ics, 'text/calendar;charset=utf-8');
      };

      /* Google / Outlook deep links */
      $('out-google').href = Cal.googleUrl({
        title: ev.summary, startDate: slot.date, startMin: slot.startMin,
        endDate: slot.date, endMin: slot.endMin,
        details: ev.description, location: ev.location
      });
      $('out-outlook').href = Cal.outlookUrl({
        title: ev.summary, startDate: slot.date, startMin: slot.startMin,
        endDate: slot.date, endMin: slot.endMin,
        body: ev.description, location: ev.location
      });
    }

    $('book-again').addEventListener('click', function () {
      hide($('book-result'));
      renderWeek();
    });

    renderWeek();
  }
})();
