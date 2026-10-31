// Regression tests for the panel's date-boundary helpers (DST handling).
// Run from the repository root: node --test
// Uses only Node built-ins. The helpers are read from the shipped script so the
// tests exercise the real code without changing how it is loaded in the browser.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs
  .readFileSync(path.join(__dirname, '../src/Mardy.Optimizely.PublishingTimeline/wwwroot/publishing-timeline.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extract(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name + ' not found in publishing-timeline.js');
  return source.slice(start, source.indexOf('\n  }\n', start) + 4);
}

const { localDayStartUtcIso, addOneDayIso } = new Function(
  extract('zoneOffsetMs') + extract('localDayStartUtcIso') + extract('addOneDayIso') +
  'return { localDayStartUtcIso, addOneDayIso };')();

// Same expressions the panel uses for the API's from/to parameters.
const fromParam = (date, tz) => localDayStartUtcIso(date, tz);
const toParam = (date, tz) => localDayStartUtcIso(addOneDayIso(date), tz); // exclusive

// [zone, local date, expected first instant of that day (UTC), note]
const dayStarts = [
  ['Europe/London', '2026-01-15', '2026-01-15T00:00:00.000Z', 'ordinary, GMT'],
  ['Europe/London', '2026-03-29', '2026-03-29T00:00:00.000Z', 'BST starts 01:00'],
  ['Europe/London', '2026-03-30', '2026-03-29T23:00:00.000Z', 'day after, BST'],
  ['Europe/London', '2026-10-25', '2026-10-24T23:00:00.000Z', 'BST ends 02:00'],
  ['Europe/London', '2026-10-26', '2026-10-26T00:00:00.000Z', 'day after, GMT'],
  ['America/New_York', '2026-01-15', '2026-01-15T05:00:00.000Z', 'ordinary, EST'],
  ['America/New_York', '2026-03-08', '2026-03-08T05:00:00.000Z', 'EDT starts 02:00'],
  ['America/New_York', '2026-07-04', '2026-07-04T04:00:00.000Z', 'ordinary, EDT'],
  ['America/New_York', '2026-11-01', '2026-11-01T04:00:00.000Z', 'EDT ends 02:00'],
  ['Africa/Cairo', '2026-01-15', '2026-01-14T22:00:00.000Z', 'ordinary, EET'],
  ['Africa/Cairo', '2026-04-24', '2026-04-23T22:00:00.000Z', 'DST starts at midnight: no 00:00, day starts 01:00'],
  ['Africa/Cairo', '2026-10-29', '2026-10-28T21:00:00.000Z', 'last DST day, EEST'],
  ['Africa/Cairo', '2026-10-30', '2026-10-29T22:00:00.000Z', 'DST ended at 24:00, EET'],
  ['America/Santiago', '2026-01-15', '2026-01-15T03:00:00.000Z', 'ordinary, -03'],
  ['America/Santiago', '2026-04-05', '2026-04-05T04:00:00.000Z', 'DST ended at 24:00, -04'],
  ['America/Santiago', '2026-07-15', '2026-07-15T04:00:00.000Z', 'ordinary, -04'],
  ['America/Santiago', '2026-09-06', '2026-09-06T04:00:00.000Z', 'DST starts at midnight: no 00:00, day starts 01:00'],
  ['Asia/Dubai', '2026-03-29', '2026-03-28T20:00:00.000Z', 'no DST, +04'],
  ['Asia/Dubai', '2026-10-25', '2026-10-24T20:00:00.000Z', 'no DST, +04'],
];

for (const [tz, date, expected, note] of dayStarts) {
  test(`${tz} ${date} starts at ${expected} (${note})`, () => {
    assert.equal(localDayStartUtcIso(date, tz), expected);
  });
}

test('table filter: inclusive From/To with exclusive upper bound across DST start', () => {
  // From 2026-03-29 to 2026-03-29 in London = the whole (23-hour) day.
  assert.equal(fromParam('2026-03-29', 'Europe/London'), '2026-03-29T00:00:00.000Z');
  assert.equal(toParam('2026-03-29', 'Europe/London'), '2026-03-29T23:00:00.000Z');
});

test('table filter: inclusive From/To with exclusive upper bound across DST end', () => {
  // From 2026-11-01 to 2026-11-01 in New York = the whole (25-hour) day.
  assert.equal(fromParam('2026-11-01', 'America/New_York'), '2026-11-01T04:00:00.000Z');
  assert.equal(toParam('2026-11-01', 'America/New_York'), '2026-11-02T05:00:00.000Z');
});

test('calendar month range: first of month to first of next month', () => {
  // The calendar requests [first day of month, first day of next month).
  assert.equal(localDayStartUtcIso('2026-03-01', 'Europe/London'), '2026-03-01T00:00:00.000Z');
  assert.equal(localDayStartUtcIso('2026-04-01', 'Europe/London'), '2026-03-31T23:00:00.000Z');
  assert.equal(localDayStartUtcIso('2026-04-01', 'Africa/Cairo'), '2026-03-31T22:00:00.000Z');
  assert.equal(localDayStartUtcIso('2026-05-01', 'Africa/Cairo'), '2026-04-30T21:00:00.000Z');
  assert.equal(localDayStartUtcIso('2026-09-01', 'America/Santiago'), '2026-09-01T04:00:00.000Z');
  assert.equal(localDayStartUtcIso('2026-10-01', 'America/Santiago'), '2026-10-01T03:00:00.000Z');
});

test('addOneDayIso crosses month and year ends', () => {
  assert.equal(addOneDayIso('2026-03-31'), '2026-04-01');
  assert.equal(addOneDayIso('2026-12-31'), '2027-01-01');
  assert.equal(addOneDayIso('2028-02-28'), '2028-02-29');
});

test('every day 2025-2027 in the five zones resolves to the first instant of that day', () => {
  const formatters = {};
  const localDate = (t, tz) => (formatters[tz] ||= new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  })).format(new Date(t));

  for (const tz of ['Europe/London', 'America/New_York', 'Africa/Cairo', 'America/Santiago', 'Asia/Dubai']) {
    for (let t = Date.UTC(2025, 0, 1); t < Date.UTC(2028, 0, 1); t += 86400000) {
      const date = new Date(t).toISOString().slice(0, 10);
      const start = Date.parse(localDayStartUtcIso(date, tz));
      assert.equal(localDate(start, tz), date, `${tz} ${date}: result is not on that day`);
      assert.ok(localDate(start - 1000, tz) < date, `${tz} ${date}: an earlier instant is on that day`);
    }
  }
});
