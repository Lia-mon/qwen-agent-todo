// Tests for the repeatable-task cross math in app.js:
//   1. Property test — crossesCount (O(1)) vs the per-cross loop reference.
//   2. Equivalence test — "app open, scanning daily" vs "app closed, one
//      scan after a gap" must end in identical (completed, stack, nextRepeatDate).
//
// Run in one timezone:
//   node tools/cross-tests.js
// Run across timezones (DST both directions, UTC+14):
//   for tz in UTC America/New_York Australia/Sydney Pacific/Kiritimati America/Anchorage; do
//     TZ=$tz node tools/cross-tests.js
//   done
// Exits non-zero on any failure.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function extract(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
// eval (non-strict) so the function declarations leak into this scope
eval(extract('nextCrossMoment') + '\n' + extract('crossesCount'));

// reference: the old per-cross loop
function loopCount(repeat, lastMs, nowMs) {
  let t = lastMs, count = 0;
  while (t != null && t <= nowMs) { count++; t = nextCrossMoment(repeat, t); }
  return count;
}

// one scan of the re-emerge/stack logic (mirrors runScheduledReemergence)
function scan(s, repeat, t) {
  if (s.nrd == null || s.nrd > t) return;
  if (s.completed) {
    s.completed = 0;
    const crossed = crossesCount(repeat, s.nrd, t);
    s.stack = crossed != null ? crossed - 1 : 0;
  } else {
    s.stack += crossesCount(repeat, s.nrd, t);
  }
  s.nrd = nextCrossMoment(repeat, t);
}

const repeats = ['daily', 'weekly', 'biweekly', 'monthly', 'biyearly', 'yearly'];
let seed = 42;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

let failures = 0, checks = 0;
function fail(msg) {
  failures++;
  if (failures <= 10) console.log(msg);
}

// ---------------------------------------------------------------------------
// Suite 1: crossesCount vs the loop
// ---------------------------------------------------------------------------
function checkCount(repeat, lastMs, nowMs) {
  const a = loopCount(repeat, lastMs, nowMs);
  const b = crossesCount(repeat, lastMs, nowMs);
  checks++;
  if (a !== b) fail(`COUNT MISMATCH ${repeat}: loop=${a} o1=${b} last=${new Date(lastMs).toString()} now=${new Date(nowMs).toString()}`);
}

const t0 = Date.UTC(2023, 0, 1), t1 = Date.UTC(2027, 11, 31);

// random pairs, 2023-2027 (spans DST transitions both hemispheres)
for (let i = 0; i < 20000; i++) {
  let a = t0 + rand() * (t1 - t0);
  let b = t0 + rand() * (t1 - t0);
  if (a > b) [a, b] = [b, a];
  for (const r of repeats) checkCount(r, a, b);
}

// lastMs exactly on a cross moment (the real-world case)
for (let i = 0; i < 5000; i++) {
  const r = repeats[Math.floor(rand() * repeats.length)];
  const last = nextCrossMoment(r, t0 + rand() * (t1 - t0));
  checkCount(r, last, last + rand() * 400 * 86400000);
}

// tight gaps: lastMs within hours of nowMs
for (let i = 0; i < 5000; i++) {
  const r = repeats[Math.floor(rand() * repeats.length)];
  const now = t0 + rand() * (t1 - t0);
  checkCount(r, now - rand() * 6 * 3600000, now);
}

// known fixed cases (expected values are timezone-independent: calendar dates)
const D = (y, mo, d, h = 5) => new Date(y, mo, d, h, 0, 0).getTime();
const fixed = [
  ['daily', D(2026, 0, 1), D(2026, 0, 31, 12), 31],
  ['daily', D(2026, 0, 28), D(2026, 0, 31, 12), 4],
  ['daily', D(2026, 0, 15, 12), D(2026, 0, 31, 12), 17], // corrupt stored date
  ['weekly', D(2026, 0, 4), D(2026, 0, 31, 12), 4],
  ['biweekly', D(2026, 0, 18), D(2026, 3, 10, 12), 24],
  ['monthly', D(2026, 0, 1), D(2026, 5, 15, 12), 6],
  ['yearly', D(2025, 0, 1), D(2026, 6, 1, 12), 2],
  ['biyearly', D(2024, 0, 1), D(2026, 6, 1, 12), 6],
];
for (const [r, l, n, expect] of fixed) {
  const a = loopCount(r, l, n), b = crossesCount(r, l, n);
  checks++;
  if (a !== b || a !== expect) fail(`FIXED MISMATCH ${r}: loop=${a} o1=${b} expect=${expect}`);
}

// legacy '30s' has no fixed schedule
checks++;
if (crossesCount('30s', D(2026, 0, 1), D(2026, 0, 31, 12)) !== null) fail('legacy should be null');

// ---------------------------------------------------------------------------
// Suite 2: open-app vs closed-app equivalence
// ---------------------------------------------------------------------------
for (let i = 0; i < 3000; i++) {
  const r = repeats[Math.floor(rand() * repeats.length)];
  const completeAt = t0 + rand() * (t1 - t0);
  const gapDays = 1 + Math.floor(rand() * 400);
  const finalDay = new Date(completeAt + gapDays * 86400000);
  // final scan after 6am on the final day
  const finalTime = new Date(finalDay.getFullYear(), finalDay.getMonth(), finalDay.getDate(),
    6 + Math.floor(rand() * 18), Math.floor(rand() * 60), 0).getTime();

  const init = () => ({ completed: 1, stack: 0, nrd: nextCrossMoment(r, completeAt) });

  // A: app open — scans at 6am each day + final scan
  const a = init();
  for (let d = 0; d <= gapDays; d++) {
    const dd = new Date(completeAt + d * 86400000);
    const scan6 = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate(), 6, 0, 0).getTime();
    scan(a, r, scan6);
  }
  scan(a, r, finalTime);

  // B: app closed — single scan at finalTime
  const b = init();
  scan(b, r, finalTime);

  checks++;
  if (a.stack !== b.stack || a.nrd !== b.nrd || a.completed !== b.completed) {
    fail(`EQUIV MISMATCH ${r}: open=${JSON.stringify(a)} closed=${JSON.stringify(b)} complete=${new Date(completeAt).toString()} final=${new Date(finalTime).toString()}`);
  }
}

// the canonical example: daily, complete Mon 3pm, checked Thu 6am
// → re-emerge consumes Tue, stacks Wed+Thu → stack 2, next Fri 5am
const mon = new Date(2026, 0, 5, 15, 0, 0).getTime();
const thu = new Date(2026, 0, 8, 6, 0, 0).getTime();
const s = { completed: 1, stack: 0, nrd: nextCrossMoment('daily', mon) };
scan(s, 'daily', thu);
checks++;
if (s.stack !== 2 || s.nrd !== new Date(2026, 0, 9, 5, 0, 0).getTime()) {
  fail(`USER EXAMPLE: stack=${s.stack} (expect 2), next=${new Date(s.nrd).toString()} (expect Fri Jan 9 5am)`);
}

console.log(`TZ=${process.env.TZ || 'system'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);