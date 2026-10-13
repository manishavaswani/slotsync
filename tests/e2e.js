/* SlotSync — browser e2e test (Playwright + system Chromium, no deps in repo).
 * Run: NODE_PATH=$(npm root -g) node tests/e2e.js
 * Flow: professor configures a semester → booking link appears in the textarea
 * → open the link in a fresh page → student books a slot → verify the .ics
 * download, Google URL, Outlook URL, and mailto href. Zero console errors.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.error('FAIL  ' + name); }
}

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end('nope'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox']
  });

  const consoleErrors = [];
  function watch(page, tag) {
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(tag + ': ' + m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(tag + ' pageerror: ' + e.message));
  }

  /* ---------- professor configures ---------- */
  const prof = await browser.newPage();
  watch(prof, 'professor');
  await prof.goto(base);
  ok(await prof.isVisible('#professor-view'), 'professor view shown without hash');
  ok(await prof.isHidden('#student-view'), 'student view hidden without hash');

  await prof.fill('#prof-name', 'Dr. Zoë Åström');
  await prof.fill('#prof-course', 'ECON 201');
  await prof.fill('#prof-email', 'zastrom@uni.edu');
  // default block exists (Tue 14:00–16:00, 20-min, room) — set a room
  await prof.fill('.block-card input[type="text"]', 'Warren Hall 312');
  // add a blackout: pick the second Wednesday after semester start
  const semStart = await prof.inputValue('#sem-start');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(semStart), 'semester start prefilled (' + semStart + ')');

  const link = await prof.inputValue('#booking-link-out');
  ok(link.indexOf('#book=') > 0, 'booking link generated');
  ok(link.length > 200, 'booking link carries encoded config (' + link.length + ' chars)');

  // claim a slot so the student sees a Taken badge
  const decodedLen = link.length;

  /* ---------- student opens the link ---------- */
  const stu = await browser.newPage();
  watch(stu, 'student');
  await stu.goto(link);
  ok(await stu.isVisible('#student-view'), 'student view shown for #book= link');
  ok(await stu.isHidden('#professor-view'), 'professor view hidden for #book= link');
  const heading = await stu.textContent('#stu-heading');
  ok(/Zoë Åström/.test(heading), 'professor name (unicode) in heading: ' + heading.trim());

  // pick the first available slot
  await stu.waitForSelector('.slot-card:not([disabled])', { timeout: 5000 });
  const slotCount = await stu.locator('.slot-card').count();
  ok(slotCount > 0, 'slot cards rendered (' + slotCount + ')');
  const badgeText = await stu.locator('.slot-card .badge').first().textContent();
  ok(/room/i.test(badgeText), 'location badge on slot card: ' + badgeText.trim());
  await stu.locator('.slot-card:not([disabled])').first().click();
  ok(await stu.isVisible('#book-panel'), 'booking panel opens after picking a slot');
  const slotLabel = (await stu.textContent('#book-slot-label')).trim();
  ok(/Warren Hall 312/.test(slotLabel), 'slot label shows room');

  await stu.fill('#stu-name', 'Ada 小明');
  await stu.fill('#stu-email', 'ada@student.edu');
  await stu.fill('#stu-topic', 'Problem set 3');

  // intercept the .ics download
  const dlPromise = stu.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await stu.click('#book-confirm');
  ok(await stu.isVisible('#book-result'), 'result panel after confirm');

  const mailto = await stu.getAttribute('#out-mailto', 'href');
  ok(/^mailto:zastrom%40uni\.edu\?/.test(mailto), 'mailto to professor: ' + mailto.slice(0, 60) + '…');
  ok(/subject=Office%20hours%20request/.test(mailto), 'mailto subject');
  ok(/ada%40student\.edu/.test(mailto), 'mailto body includes student email');
  ok(/Problem%20set%203/.test(mailto), 'mailto body includes topic');

  const gurl = await stu.getAttribute('#out-google', 'href');
  ok(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/.test(gurl), 'Google template URL');
  ok(/text=/.test(gurl) && /dates=\d{8}T\d{6}%2F\d{8}T\d{6}|dates=\d{8}T\d{6}\/\d{8}T\d{6}/.test(gurl), 'Google URL has text+dates');
  ok(/location=Warren/.test(gurl), 'Google URL location');

  const ourl = await stu.getAttribute('#out-outlook', 'href');
  ok(/^https:\/\/outlook\.live\.com\/calendar\/deeplink\/compose/.test(ourl), 'Outlook deep link');
  ok(/rru=addevent/.test(ourl) && /startdt=/.test(ourl), 'Outlook URL params');

  await stu.click('#out-ics');
  const dl = await dlPromise;
  ok(!!dl, 'ics download triggered');
  if (dl) {
    const tmp = await dl.path();
    const ics = fs.readFileSync(tmp, 'utf8');
    ok(/BEGIN:VCALENDAR/.test(ics) && /BEGIN:VEVENT/.test(ics), 'ics structure');
    ok(/LOCATION:Warren Hall 312/.test(ics), 'ics LOCATION is the room');
    ok(/DTSTART:\d{8}T\d{6}/.test(ics) && /DTEND:\d{8}T\d{6}/.test(ics), 'ics DTSTART/DTEND');
    ok(/ada@student\.edu/.test(ics.replace(/\r\n[ ]/g, '')), 'ics description includes student');
  }

  /* ---------- professor's own .ics export ---------- */
  const dlPromise2 = prof.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await prof.click('#download-all-ics');
  const dl2 = await dlPromise2;
  ok(!!dl2, 'professor semester .ics download triggered');
  if (dl2) {
    const ics = fs.readFileSync(await dl2.path(), 'utf8');
    ok(/RRULE:FREQ=WEEKLY;BYDAY=TU/.test(ics), 'professor ics has weekly RRULE');
    ok(/UNTIL=\d{8}T235900/.test(ics), 'professor ics UNTIL semester end');
  }

  /* ---------- corrupt link is handled ---------- */
  const bad = await browser.newPage();
  watch(bad, 'corrupt');
  await bad.goto(base + '#book=AAAA-corrupted');
  ok(await bad.isVisible('#fatal-error'), 'corrupt link shows honest error');

  ok(consoleErrors.length === 0, 'zero console errors' +
    (consoleErrors.length ? ' — got: ' + consoleErrors.join(' | ') : ''));

  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E crashed:', e); process.exit(1); });
