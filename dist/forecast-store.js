import {createHourlyLoader, hourlyFresh} from './hourly-data.js';

// One shared request per location/source; limit upstream concurrency and memory.
export function createForecastStore({fetcher = fetch, now = () => new Date(), limit = 40, concurrency = 2} = {}) {
  const entries = new Map(), listeners = new Set(), queue = [];
  let active = 0, scheduled = false;
  const key = (place, source) => source + ':' + place.lat + ',' + place.lon;
  const notify = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; listeners.forEach(fn => fn()); });
  };
  const empty = {data: null, status: 'idle'};
  function peek(place, source = 'ecmwf') {
    const entry = entries.get(key(place, source));
    if (!entry) return empty;
    if (entry.pending && entry.loader.state.status !== 'loading') return {...empty, status: 'loading'};
    const state = entry.loader.state;
    if (state.data && !hourlyFresh(state.loadedAt, state.data, now())) return empty;
    return state;
  }
  function prune() {
    for (const [id, entry] of entries) {
      if (entries.size <= limit) break;
      if (!entry.pending) entries.delete(id);
    }
  }
  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift(); active++;
      job.entry.loader.select(job.place, {source: job.source, force: job.force})
        .finally(() => {
          active--; job.entry.pending = null; job.resolve(); prune(); notify(); drain();
        });
    }
  }
  function load(place, source = 'ecmwf', {force = false} = {}) {
    const id = key(place, source);
    let entry = entries.get(id);
    if (entry?.pending) return entry.pending;
    const state = entry?.loader.state;
    if (!force && state && (hourlyFresh(state.loadedAt, state.data, now())
      || (state.status === 'error' && +now() - +state.attemptedAt >= 0 && +now() - +state.attemptedAt < 300000))) return Promise.resolve();
    if (!entry) {
      entry = {loader: createHourlyLoader({fetcher, now, onChange: notify}), pending: null};
      entries.set(id, entry);
    } else { entries.delete(id); entries.set(id, entry); }
    let resolve;
    entry.pending = new Promise(done => { resolve = done; });
    const pending = entry.pending;
    queue.push({entry, place: {...place}, source, force, resolve});
    notify(); drain(); return pending;
  }
  return {peek, load, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }};
}
