/* SlotSync — js/config.js
 * State-in-URL core: the professor's whole schedule config is serialized to
 * JSON, UTF-8 encoded, base64url-encoded, and carried in the #book= hash of
 * the booking link. No server, no database — the link *is* the data.
 *
 * Exposed as window.SlotSyncConfig (classic script; also works under node
 * for smoke tests).
 */
(function (global) {
  'use strict';

  var CONFIG_VERSION = 1;

  /* ---------- base64url of UTF-8 JSON ---------- */

  function utf8ToB64(str) {
    if (typeof TextEncoder !== 'undefined' && typeof btoa !== 'undefined') {
      // browser path
      var bytes = new TextEncoder().encode(str);
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    // node path
    return Buffer.from(str, 'utf8').toString('base64');
  }

  function b64ToUtf8(b64) {
    if (typeof TextDecoder !== 'undefined' && typeof atob !== 'undefined') {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    return Buffer.from(b64, 'base64').toString('utf8');
  }

  function b64urlEncode(str) {
    return utf8ToB64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(s) {
    var b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return b64ToUtf8(b64);
  }

  /* ---------- config schema ---------- */

  var SLOT_LENGTHS = [10, 15, 20, 30];
  var LOC_MODES = ['room', 'zoom', 'teams', 'meet'];

  function emptyConfig() {
    return {
      v: CONFIG_VERSION,
      prof: { name: '', course: '', email: '' },
      semester: { start: '', end: '' },
      blocks: [],          // {id, day:0-6, start:'HH:MM', end:'HH:MM', slotMin, loc:{mode,value}}
      blackouts: [],       // ['YYYY-MM-DD']
      overrides: [],       // {week:'YYYY-MM-DD'(Mon), cancel:true} | {week, blockId, day, start, end}
      rules: { cap: 1, horizonDays: 21, bufferMin: 0 },
      claimed: []          // [{date, startMin, name}] — professor may append when updating the link
    };
  }

  function makeBlockId() {
    return 'b' + Math.random().toString(36).slice(2, 8);
  }

  /* Validate + lightly normalize a decoded config. Returns {ok, errors, config}. */
  function validateConfig(cfg) {
    var errors = [];
    if (!cfg || typeof cfg !== 'object') return { ok: false, errors: ['Config is not an object'], config: null };
    var base = emptyConfig();
    var out = {
      v: cfg.v || CONFIG_VERSION,
      prof: {
        name: String(cfg.prof && cfg.prof.name || '').slice(0, 120),
        course: String(cfg.prof && cfg.prof.course || '').slice(0, 160),
        email: String(cfg.prof && cfg.prof.email || '').slice(0, 160)
      },
      semester: {
        start: /^\d{4}-\d{2}-\d{2}$/.test(cfg.semester && cfg.semester.start) ? cfg.semester.start : '',
        end: /^\d{4}-\d{2}-\d{2}$/.test(cfg.semester && cfg.semester.end) ? cfg.semester.end : ''
      },
      blocks: [], blackouts: [], overrides: [], claimed: [],
      rules: {
        cap: Math.min(10, Math.max(1, parseInt(cfg.rules && cfg.rules.cap, 10) || 1)),
        horizonDays: Math.min(365, Math.max(1, parseInt(cfg.rules && cfg.rules.horizonDays, 10) || 21)),
        bufferMin: Math.min(60, Math.max(0, parseInt(cfg.rules && cfg.rules.bufferMin, 10) || 0))
      }
    };
    (Array.isArray(cfg.blocks) ? cfg.blocks : []).forEach(function (b) {
      if (!b) return;
      var day = parseInt(b.day, 10);
      var start = String(b.start || ''), end = String(b.end || '');
      var slotMin = parseInt(b.slotMin, 10);
      if (!(day >= 0 && day <= 6)) { errors.push('Block skipped: bad day'); return; }
      if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) { errors.push('Block skipped: bad time'); return; }
      if (SLOT_LENGTHS.indexOf(slotMin) === -1) slotMin = 20;
      var loc = b.loc || {};
      var mode = LOC_MODES.indexOf(loc.mode) !== -1 ? loc.mode : 'room';
      out.blocks.push({
        id: String(b.id || makeBlockId()),
        day: day, start: start, end: end, slotMin: slotMin,
        loc: { mode: mode, value: String(loc.value || '').slice(0, 400) }
      });
    });
    (Array.isArray(cfg.blackouts) ? cfg.blackouts : []).forEach(function (d) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && out.blackouts.indexOf(d) === -1) out.blackouts.push(d);
    });
    (Array.isArray(cfg.overrides) ? cfg.overrides : []).forEach(function (o) {
      if (!o || !/^\d{4}-\d{2}-\d{2}$/.test(o.week || '')) return;
      if (o.cancel) { out.overrides.push({ week: o.week, cancel: true }); return; }
      if (o.blockId && /^\d{1,2}:\d{2}$/.test(o.start || '') && /^\d{1,2}:\d{2}$/.test(o.end || '')) {
        var d = parseInt(o.day, 10);
        if (d >= 0 && d <= 6) out.overrides.push({ week: o.week, blockId: String(o.blockId), day: d, start: o.start, end: o.end });
      }
    });
    (Array.isArray(cfg.claimed) ? cfg.claimed : []).forEach(function (c) {
      if (c && /^\d{4}-\d{2}-\d{2}$/.test(c.date || '') && Number.isFinite(+c.startMin)) {
        out.claimed.push({ date: c.date, startMin: +c.startMin, name: String(c.name || '').slice(0, 120) });
      }
    });
    if (!out.semester.start || !out.semester.end) errors.push('Semester start/end missing');
    if (out.semester.start && out.semester.end && out.semester.start > out.semester.end) errors.push('Semester end is before start');
    if (!out.blocks.length) errors.push('No weekly blocks defined');
    return { ok: errors.length === 0, errors: errors, config: out };
  }

  /* ---------- encode / decode ---------- */

  function encodeConfig(cfg) {
    return b64urlEncode(JSON.stringify(cfg));
  }

  /* Returns {ok, config|errors}. */
  function decodeConfig(encoded) {
    try {
      var json = b64urlDecode(encoded);
      var obj = JSON.parse(json);
      return validateConfig(obj);
    } catch (e) {
      return { ok: false, errors: ['This booking link could not be decoded — it may be truncated or corrupted.'], config: null };
    }
  }

  function buildBookingLink(baseUrl, cfg) {
    var base = String(baseUrl || '').split('#')[0];
    return base + '#book=' + encodeConfig(cfg);
  }

  /* Read #book= out of a location hash string. */
  function extractBookParam(hash) {
    var m = /(?:^|#|&)book=([A-Za-z0-9_-]+)/.exec(hash || '');
    return m ? m[1] : null;
  }

  global.SlotSyncConfig = {
    CONFIG_VERSION: CONFIG_VERSION,
    SLOT_LENGTHS: SLOT_LENGTHS,
    LOC_MODES: LOC_MODES,
    emptyConfig: emptyConfig,
    makeBlockId: makeBlockId,
    validateConfig: validateConfig,
    encodeConfig: encodeConfig,
    decodeConfig: decodeConfig,
    buildBookingLink: buildBookingLink,
    extractBookParam: extractBookParam,
    b64urlEncode: b64urlEncode,
    b64urlDecode: b64urlDecode
  };
})(typeof window !== 'undefined' ? window : globalThis);
