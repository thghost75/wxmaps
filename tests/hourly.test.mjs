import test from 'node:test';
import assert from 'node:assert/strict';
import {hourlyFields, hourlyDate, dayHours, hourLabel, offsetLabel, windDirection, validateHourly, hourlyFresh, createHourlyLoader} from '../dist/hourly-data.js';

const now = new Date('2026-10-10T09:00:00Z');
function fixture(start = Date.parse('2026-10-09T21:00:00Z') / 1000) {
  const data = {timezone: 'Europe/Bucharest', hourly_units: {time: 'unixtime', wind_direction_10m: '°'}, hourly: {time: Array.from({length: 168}, (_, i) => start + i * 3600)}};
  for (const [field, meta] of Object.entries(hourlyFields)) {
    data.hourly_units[field] = meta.unit;
    data.hourly[field] = Array(168).fill(field === 'temperature_2m' ? 12 : 0);
  }
  data.hourly.wind_direction_10m = Array(168).fill(270);
  return data;
}
const placeA = {lat: 44.4268, lon: 26.1025}, placeB = {lat: 45.6579, lon: 25.6012};
const response = data => ({ok: true, json: async () => data});

test('validates units, nulls, stale dates and interrupted hourly sequences', () => {
  const data = fixture();
  assert.equal(validateHourly(data, now), true);
  data.hourly.temperature_2m[0] = null;
  assert.equal(validateHourly(data, now), true);
  data.hourly_units.snowfall = 'mm';
  assert.equal(validateHourly(data, now), false);
  assert.equal(validateHourly(fixture(), new Date('2026-10-11T09:00:00Z')), false);
  const broken = fixture(); broken.hourly.time[1] += 10;
  assert.equal(validateHourly(broken, now), false);
});
test('groups by Bucharest date, independent of the browser time zone', () => {
  assert.equal(hourlyDate(Date.parse('2026-10-09T21:00:00Z') / 1000), '2026-10-10');
  const hours = dayHours(fixture(), '2026-10-10');
  assert.equal(hours.length, 24); assert.equal(hourLabel(hours[0].time), '00:00');
  assert.equal(dayHours(fixture(), '2026-10-20').length, 0);
});
test('DST fall-back keeps both 03:00 hours with distinct offsets', () => {
  const data = fixture(Date.parse('2026-10-24T21:00:00Z') / 1000);
  const hours = dayHours(data, '2026-10-25');
  assert.equal(hours.length, 25);
  const repeated = hours.filter(hour => hourLabel(hour.time) === '03:00');
  assert.equal(repeated.length, 2);
  assert.notEqual(offsetLabel(repeated[0].time), offsetLabel(repeated[1].time));
});
test('DST spring-forward has 23 local hours', () => {
  const data = fixture(Date.parse('2026-03-28T22:00:00Z') / 1000);
  assert.equal(dayHours(data, '2026-03-29').length, 23);
});
test('wind compass covers zero, wrapping and missing readings', () => {
  assert.equal(windDirection(0), 'N'); assert.equal(windDirection(360), 'N');
  assert.equal(windDirection(270), 'W'); assert.equal(windDirection(45), 'NE');
  assert.equal(windDirection(null), '—');
});
test('data expires after three hours or when the Bucharest day changes', () => {
  assert.equal(hourlyFresh(now, fixture(), new Date(+now + 3600000)), true);
  assert.equal(hourlyFresh(now, fixture(), new Date(+now + 3 * 3600000)), false);
  assert.equal(hourlyFresh(now, fixture(), new Date(+now - 1)), false);
  const late = new Date('2026-10-10T20:50:00Z');
  assert.equal(hourlyFresh(late, fixture(), new Date('2026-10-10T21:01:00Z')), false);
});
test('requests only the selected location and reuses fresh data across day changes', async () => {
  const calls = [];
  const loader = createHourlyLoader({now: () => now, fetcher: async (url, options) => { calls.push({url, options}); return response(fixture()); }});
  await loader.select(placeA); await loader.select(placeA);
  assert.equal(calls.length, 1); assert.equal(loader.state.status, 'ready');
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get('latitude'), String(placeA.lat));
  assert.equal(params.get('models'), 'ecmwf_ifs025');
  assert.equal(params.get('timeformat'), 'unixtime');
  assert.equal(calls[0].options.cache, 'no-store');
  await loader.select(placeA, {force: true}); assert.equal(calls.length, 2);
});
test('rapid location switches discard late responses even if transport ignores abort', async () => {
  const pending = [];
  const loader = createHourlyLoader({now: () => now, fetcher: (url, options) => new Promise(resolve => pending.push({url, options, resolve}))});
  const first = loader.select(placeA);
  const second = loader.select(placeB);
  assert.equal(pending[0].options.signal.aborted, true);
  assert.equal(loader.state.data, null);
  const secondData = fixture(); secondData.hourly.temperature_2m.fill(5);
  pending[1].resolve(response(secondData)); await second;
  pending[0].resolve(response(fixture())); await first;
  assert.equal(loader.state.key, placeB.lat + ',' + placeB.lon);
  assert.equal(loader.state.data.hourly.temperature_2m[0], 5);
});
test('failed refresh clears old readings and throttles automatic retries', async () => {
  let failed = false, calls = 0;
  const loader = createHourlyLoader({now: () => now, fetcher: async () => { calls++; if (failed) throw new Error('Offline'); return response(fixture()); }});
  await loader.select(placeA); failed = true;
  await loader.select(placeA, {force: true});
  assert.equal(loader.state.data, null); assert.equal(loader.state.status, 'error');
  await loader.select(placeA); assert.equal(calls, 2);
});
