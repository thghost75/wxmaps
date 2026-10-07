import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/visit-counter.js', import.meta.url), 'utf8');
const exclusionKey = 'wxmaps.page-visits.excluded.v1';

async function page({ excluded = false, blocked = false, origin = 'https://wxmaps-iota.vercel.app', error = false, data = { visits: 1234, since: '2026-10-07' } } = {}) {
  const elements = Object.fromEntries(['visit-count', 'visit-count-note', 'visit-count-toggle'].map(id => [id, {
    textContent: '', disabled: true, addEventListener(type, action) { this[type] = action; },
  }]));
  const values = new Map([[exclusionKey, String(excluded)], ['wxmaps.page-visits.v1', '999']]);
  const calls = [];
  const window = { addEventListener(type, action) { this[type] = action; } };
  const context = vm.createContext({
    document: { getElementById: id => elements[id] }, window,
    location: { origin }, navigator: { locks: { request: (_key, action) => Promise.resolve().then(action) } },
    localStorage: {
      getItem(key) { if (blocked) throw new Error('Blocked'); return values.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error('Blocked'); values.set(key, value); },
    },
    AbortSignal, Intl, Date,
    fetch: async (url, options) => { calls.push({url, ...options}); if (error) throw new Error('Timeout'); return { ok: true, json: async () => data }; },
  });
  vm.runInContext(source, context);
  await vm.runInContext('request', context);
  return { elements, calls, values, window };
}

test('normal live load submits once and displays the shared count', async () => {
  const { elements, calls } = await page();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(elements['visit-count'].textContent, '1,234');
  assert.match(elements['visit-count-note'].textContent, /30 minutes/);
});
test('existing browser exclusion reads without incrementing', async () => {
  const { elements, calls } = await page({ excluded: true });
  assert.equal(calls[0].method, 'GET');
  assert.equal(elements['visit-count'].textContent, '1,234');
  assert.match(elements['visit-count-note'].textContent, /Your browser is excluded/);
});
test('blocked storage fails closed and still reads the shared total', async () => {
  const { elements, calls } = await page({ blocked: true });
  assert.equal(calls[0].method, 'GET');
  assert.equal(elements['visit-count-toggle'].disabled, true);
});
test('local and preview pages never request the counter', async () => {
  for (const origin of ['http://127.0.0.1:4173', 'https://wxmaps-preview.vercel.app']) {
    const { elements, calls } = await page({ origin });
    assert.equal(calls.length, 0);
    assert.match(elements['visit-count-note'].textContent, /live site/);
  }
});
test('toggle persists the existing preference key without a second visit request', async () => {
  const { elements, calls, values } = await page({ excluded: true });
  elements['visit-count-toggle'].click();
  assert.equal(values.get(exclusionKey), 'false');
  assert.equal(calls.length, 1);
  assert.equal(elements['visit-count-toggle'].textContent, 'Exclude this browser');
});
test('preference changes from another tab update the footer', async () => {
  const { elements, values, window } = await page();
  values.set(exclusionKey, 'true');
  window.storage({ key: exclusionKey });
  assert.match(elements['visit-count-note'].textContent, /Your browser is excluded/);
});
test('failed request is not retried or replaced with the old local count', async () => {
  const { elements, calls } = await page({ error: true });
  assert.equal(calls.length, 1);
  assert.equal(elements['visit-count'].textContent, '—');
  assert.match(elements['visit-count-note'].textContent, /unavailable/);
});
test('malformed totals are rejected', async () => {
  for (const data of [{ visits: -1, since: null }, { visits: '12', since: null }, { visits: 1, since: '<script>' }]) {
    const { elements } = await page({ data });
    assert.equal(elements['visit-count'].textContent, '—');
  }
});
