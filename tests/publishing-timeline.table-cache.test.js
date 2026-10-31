// Regression tests for the table's cached data across view switches and filter changes
// (showTable, load, tableFilterKey). Run from the repository root: node --test
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

const body = ['zoneOffsetMs', 'localDayStartUtcIso', 'addOneDayIso', 'dateRangeValid',
  'tableFilterKey', 'showTable', 'load'].map(extract).join('\n') +
  'var tableLoadId = 0;\nreturn { showTable: showTable, load: load };';
const factory = new Function('state', 'render', 'fetch', 'API_PATH', body);

// Panel with the real table logic, a fake render and a fetch whose responses the test
// resolves explicitly (to control ordering).
function panel(overrides) {
  const state = Object.assign({
    skip: 0, take: 10, items: [], hasMore: false, loading: false, error: null,
    timezone: 'America/New_York', language: '', dateFrom: '', dateTo: '',
    tableKey: null, view: 'table',
  }, overrides);
  const requests = [];
  const renders = [];
  const fetch = url => new Promise((resolve, reject) => {
    const q = new URL(url, 'http://x').searchParams;
    requests.push({
      url, language: q.get('language') || '', skip: +q.get('skip'), from: q.get('from'), to: q.get('to'),
      reply: items => resolve({ ok: true, status: 200, json: () => Promise.resolve({ items, hasMore: false }) }),
      fail: () => resolve({ ok: false, status: 500 }),
    });
  });
  const render = () => renders.push({ view: state.view, loading: state.loading, items: state.items.slice() });
  const api = factory(state, render, fetch, '/publishingtimeline/api/scheduled');
  return { state, requests, renders, api, last: () => requests[requests.length - 1] };
}

const settle = () => new Promise(r => setImmediate(r));
const rows = (...names) => names.map(n => ({ name: n }));

async function loadedTable(overrides) {
  const p = panel(overrides);
  p.api.load(null);
  p.last().reply(rows('All-1', 'All-2'));
  await settle();
  return p;
}

test('returning to Table after a language change in Calendar refetches with the new language', async () => {
  const p = await loadedTable();
  p.state.view = 'calendar';
  p.state.language = 'en';           // changed while the calendar was shown

  p.state.view = 'table';
  p.api.showTable(null);

  assert.equal(p.requests.length, 2, 'table data is fetched again');
  assert.equal(p.last().language, 'en');
  p.last().reply(rows('En-1'));
  await settle();
  assert.deepEqual(p.state.items, rows('En-1'));
});

test('returning to Table with unchanged filters uses the cached page', async () => {
  const p = await loadedTable({ skip: 20 });
  p.state.view = 'calendar';
  p.state.view = 'table';
  p.api.showTable(null);

  assert.equal(p.requests.length, 1, 'no new request');
  assert.equal(p.state.skip, 20, 'pagination kept');
  assert.deepEqual(p.renders.at(-1).items, rows('All-1', 'All-2'));
});

test('a filter change while in Calendar resets table pagination to page 1', async () => {
  const p = await loadedTable({ skip: 30 });
  p.state.view = 'calendar';
  p.state.language = 'sv';
  p.state.view = 'table';
  p.api.showTable(null);

  assert.equal(p.state.skip, 0);
  assert.equal(p.last().skip, 0);
});

test('date range changes made in Calendar invalidate the table', async () => {
  for (const change of [{ dateFrom: '2026-11-01' }, { dateTo: '2026-11-30' }]) {
    const p = await loadedTable();
    p.state.view = 'calendar';
    Object.assign(p.state, change);
    p.state.view = 'table';
    p.api.showTable(null);
    assert.equal(p.requests.length, 2, JSON.stringify(change));
    assert.ok(p.last().from || p.last().to, 'request carries the date bound');
  }
});

test('a timezone change invalidates the table only while a date filter is set', async () => {
  const withDates = await loadedTable({ dateFrom: '2026-11-01', dateTo: '2026-11-30' });
  withDates.state.timezone = 'Asia/Dubai';
  withDates.api.showTable(null);
  assert.equal(withDates.requests.length, 2, 'UTC bounds moved → refetch');
  assert.equal(withDates.last().from, '2026-10-31T20:00:00.000Z');

  const noDates = await loadedTable();
  noDates.state.timezone = 'Asia/Dubai';
  noDates.api.showTable(null);
  assert.equal(noDates.requests.length, 1, 'no date bounds → cached items re-rendered');
});

test('changing a filter and changing it back keeps the cache', async () => {
  const p = await loadedTable();
  p.state.language = 'en';
  p.state.language = '';
  p.api.showTable(null);
  assert.equal(p.requests.length, 1);
});

test('an invalid date range is not fetched', async () => {
  const p = await loadedTable();
  Object.assign(p.state, { dateFrom: '2026-11-30', dateTo: '2026-11-01' });
  p.api.showTable(null);
  assert.equal(p.requests.length, 1);
});

test('a stale response does not overwrite newer filtered results', async () => {
  const p = panel();
  p.api.load(null);                    // all languages
  const stale = p.last();
  p.state.language = 'en';
  p.api.load(null);                    // English
  const fresh = p.last();

  fresh.reply(rows('En-1'));
  await settle();
  stale.reply(rows('All-1', 'All-2')); // older request finishes last
  await settle();

  assert.deepEqual(p.state.items, rows('En-1'));
  assert.equal(p.state.tableKey, 'en||');
});

test('a stale error does not replace newer results', async () => {
  const p = panel();
  p.api.load(null);
  const stale = p.last();
  p.api.load(null);
  p.last().reply(rows('A'));
  await settle();
  stale.fail();
  await settle();
  assert.equal(p.state.error, null);
  assert.deepEqual(p.state.items, rows('A'));
});

test('a table response arriving while Calendar is shown is cached but not rendered', async () => {
  const p = panel();
  p.api.load(null);
  p.state.view = 'calendar';
  const before = p.renders.length;
  p.last().reply(rows('A'));
  await settle();

  assert.equal(p.renders.length, before, 'calendar markup is not replaced by the table');
  p.state.view = 'table';
  p.api.showTable(null);
  assert.equal(p.requests.length, 1, 'cached result is reused');
  assert.deepEqual(p.renders.at(-1).items, rows('A'));
});

test('a failed load is retried when the table is shown again', async () => {
  const p = panel();
  p.api.load(null);
  p.last().fail();
  await settle();
  assert.ok(p.state.error);

  p.state.view = 'calendar';
  p.state.view = 'table';
  p.api.showTable(null);
  assert.equal(p.requests.length, 2);
});
