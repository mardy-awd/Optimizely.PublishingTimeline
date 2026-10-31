// Regression tests for the calendar's paged loading (fetchAllPages).
// Run from the repository root: node --test
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

const fetchAllPages = new Function(extract('fetchAllPages') + 'return fetchAllPages;')();

const BASE = '/publishingtimeline/api/scheduled?from=A&to=B';
const item = n => ({ contentId: n, versionId: 1000 + n, name: 'Item ' + n });

// Fake API: `total` accessible items, served like the real endpoint (skip/take, hasMore).
function fakeApi(total, { fail, override } = {}) {
  const calls = [];
  const fetchPage = url => {
    const q = new URL(url, 'http://x');
    const skip = +q.searchParams.get('skip'), take = +q.searchParams.get('take');
    calls.push({ skip, take, url });
    if (fail && fail(skip)) { return Promise.reject(new Error('Server returned 500')); }
    if (override) { const o = override(skip, take); if (o) { return Promise.resolve(o); } }
    const items = [];
    for (let n = skip; n < Math.min(skip + take, total); n++) { items.push(item(n)); }
    return Promise.resolve({ items, hasMore: skip + take < total, skip, take });
  };
  return { fetchPage, calls };
}

test('a month with fewer than 100 items makes a single request', async () => {
  const api = fakeApi(5);
  const result = await fetchAllPages(BASE, api.fetchPage);
  assert.equal(result.items.length, 5);
  assert.equal(result.truncated, false);
  assert.deepEqual(api.calls.map(c => [c.skip, c.take]), [[0, 100]]);
  assert.ok(api.calls[0].url.startsWith(BASE + '&'), 'keeps the base query (from/to/language)');
});

test('exactly 100 items: one request, no truncation', async () => {
  const api = fakeApi(100);
  const result = await fetchAllPages(BASE, api.fetchPage);
  assert.equal(result.items.length, 100);
  assert.equal(result.truncated, false);
  assert.equal(api.calls.length, 1);
});

test('230 items are fetched sequentially in three pages', async () => {
  const api = fakeApi(230);
  const result = await fetchAllPages(BASE, api.fetchPage);
  assert.equal(result.items.length, 230);
  assert.equal(result.truncated, false);
  assert.deepEqual(api.calls.map(c => c.skip), [0, 100, 200]);
  assert.deepEqual(result.items.map(i => i.contentId), [...Array(230).keys()], 'keeps API order');
});

test('duplicates across pages are removed by content/version identity', async () => {
  // Page 2 repeats the last two items of page 1 (e.g. paging shifted between requests).
  const api = fakeApi(150, {
    override: skip => skip === 100
      ? { items: [item(98), item(99), ...Array.from({ length: 50 }, (_, k) => item(100 + k))], hasMore: false }
      : null,
  });
  const result = await fetchAllPages(BASE, api.fetchPage);
  assert.equal(result.items.length, 150);
  assert.equal(new Set(result.items.map(i => i.contentId + '_' + i.versionId)).size, 150);
});

test('same content with a different version is kept', async () => {
  const api = fakeApi(0, {
    override: () => ({ items: [{ contentId: 7, versionId: 1 }, { contentId: 7, versionId: 2 }], hasMore: false }),
  });
  const result = await fetchAllPages(BASE, api.fetchPage);
  assert.equal(result.items.length, 2);
});

test('exactly 1,000 items: ten requests, not truncated', async () => {
  const api = fakeApi(1000);
  const result = await fetchAllPages(BASE, api.fetchPage);
  assert.equal(result.items.length, 1000);
  assert.equal(result.truncated, false);
  assert.equal(api.calls.length, 10);
});

test('more than 1,000 items: stops at ten requests and reports truncation', async () => {
  const api = fakeApi(1234);
  const result = await fetchAllPages(BASE, api.fetchPage);
  assert.equal(result.items.length, 1000);
  assert.equal(result.truncated, true);
  assert.equal(api.calls.length, 10);
  assert.equal(api.calls.at(-1).skip, 900);
});

test('a failing page rejects instead of returning partial results', async () => {
  const api = fakeApi(230, { fail: skip => skip === 100 });
  await assert.rejects(fetchAllPages(BASE, api.fetchPage), /500/);
  assert.equal(api.calls.length, 2, 'no further pages after the failure');
});

test('an empty page with hasMore=true stops instead of looping', async () => {
  const api = fakeApi(0, { override: () => ({ items: [], hasMore: true }) });
  const result = await fetchAllPages(BASE, api.fetchPage);
  assert.equal(result.items.length, 0);
  assert.equal(result.truncated, false);
  assert.equal(api.calls.length, 1);
});
