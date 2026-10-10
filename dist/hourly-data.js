import {bucharestDate} from './forecast-freshness.js';

export const hourlyFields = {
  temperature_2m: {label: 'Temperature', unit: '°C', digits: 1, color: '#7cf2c2'},
  precipitation: {label: 'Precipitation', unit: 'mm', digits: 1, color: '#75c9f4', bars: true},
  snowfall: {label: 'New snowfall', unit: 'cm', digits: 1, color: '#c0acf4', bars: true},
  wind_speed_10m: {label: 'Wind speed', unit: 'km/h', digits: 0, color: '#f0c478'},
  cloud_cover: {label: 'Cloud cover', unit: '%', digits: 0, color: '#b4c8e0'},
  relative_humidity_2m: {label: 'Humidity', unit: '%', digits: 0, color: '#77d8dc'},
  pressure_msl: {label: 'Sea-level pressure', unit: 'hPa', digits: 0, color: '#eca5b4'},
};
export function sourceFields(source = 'ecmwf') {
  if (source !== 'aethra') return hourlyFields;
  const {snowfall, pressure_msl, ...common} = hourlyFields;
  return {...common, surface_pressure: {...pressure_msl, label: 'Surface pressure'}};
}
const fields = [...Object.keys(hourlyFields), 'wind_direction_10m'];
export function validateAethra(data, now = new Date()) {
  const times = data?.hourly?.time;
  if (data?.source !== 'aethra' || data.timezone !== 'Europe/Bucharest'
      || data.hourly_units?.time !== 'unixtime'
      || !Number.isFinite(data.expires_at) || data.expires_at <= +now / 1000
      || data.expires_at > +now / 1000 + 10800 + 300
      || !Number.isFinite(data.generated_at) || data.generated_at > +now / 1000 + 300
      || data.generated_at < +now / 1000 - 86400
      || !Array.isArray(times) || times.length < 24 || times.length > 168
      || !times.every((time, i) => Number.isSafeInteger(time) && (i === 0 || time - times[i - 1] === 3600))
      || times[0] > +now / 1000 + 7200 || times.at(-1) < +now / 1000) return false;
  return [...Object.keys(sourceFields('aethra')), 'wind_direction_10m'].every(field =>
    data.hourly_units[field] === (sourceFields('aethra')[field]?.unit ?? '°')
    && Array.isArray(data.hourly[field]) && data.hourly[field].length === times.length
    && data.hourly[field].every(value => value === null || Number.isFinite(value)));
}
const hourFormatter = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit'});
const offsetFormatter = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Bucharest', timeZoneName: 'shortOffset'});
export const hourLabel = epoch => hourFormatter.format(new Date(epoch * 1000));
export const offsetLabel = epoch => offsetFormatter.formatToParts(new Date(epoch * 1000)).find(part => part.type === 'timeZoneName').value;
export const hourlyDate = epoch => bucharestDate(new Date(epoch * 1000));
export const dayHours = (data, date) => data?.hourly.time.map((time, index) => ({time, index})).filter(hour => hourlyDate(hour.time) === date) ?? [];
export const windDirection = degrees => Number.isFinite(degrees)
  ? ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16]
  : '—';
export function hourlyFresh(loadedAt, data, now = new Date()) {
  const age = +now - +loadedAt;
  return !!loadedAt && !!data && age >= 0 && age < 3 * 3600000
    && bucharestDate(loadedAt) === bucharestDate(now)
    && (data.source === 'aethra' ? validateAethra(data, now) : hourlyDate(data.hourly.time[0]) === bucharestDate(now));
}
export function validateHourly(data, now = new Date()) {
  const times = data?.hourly?.time;
  if (data?.timezone !== 'Europe/Bucharest' || data.hourly_units?.time !== 'unixtime'
      || !Array.isArray(times) || times.length < 24 || times.length > 192
      || !times.every((time, i) => Number.isSafeInteger(time) && (i === 0 || time - times[i - 1] === 3600))
      || hourlyDate(times[0]) !== bucharestDate(now)) return false;
  return fields.every(field => {
    const values = data.hourly[field];
    return data.hourly_units[field] === (hourlyFields[field]?.unit ?? '°')
      && Array.isArray(values) && values.length === times.length
      && values.every(value => value === null || Number.isFinite(value));
  });
}

// Retain only the selected location and clear old readings before requesting another.
export function createHourlyLoader({fetcher = fetch, now = () => new Date(), onChange = () => {}} = {}) {
  const state = {key: '', data: null, loadedAt: null, attemptedAt: null, status: 'idle'};
  let controller, version = 0, pending;
  async function select(place, {force = false, source = 'ecmwf'} = {}) {
    const key = (source === 'aethra' ? 'aethra:' : '') + place.lat + ',' + place.lon;
    if (!force && key === state.key && state.status === 'loading') return pending;
    if (!force && key === state.key && hourlyFresh(state.loadedAt, state.data, now())) return;
    const age = +now() - +state.attemptedAt;
    if (!force && key === state.key && state.status === 'error' && age >= 0 && age < 300000) return;
    controller?.abort();
    controller = new AbortController();
    const active = controller;
    const requestVersion = ++version;
    Object.assign(state, {key, data: null, loadedAt: null, attemptedAt: now(), status: 'loading'});
    onChange(state);
    pending = (async () => {
      const timeout = setTimeout(() => active.abort(), source === 'aethra' ? 25000 : 15000);
      try {
        const params = new URLSearchParams({latitude: place.lat, longitude: place.lon,
          models: 'ecmwf_ifs025', hourly: fields.join(','), timezone: 'Europe/Bucharest',
          timeformat: 'unixtime', forecast_days: '7', wind_speed_unit: 'kmh'});
        const url = source === 'aethra'
          ? '/api/forecast?' + new URLSearchParams({lat: place.lat, lon: place.lon})
          : 'https://api.open-meteo.com/v1/forecast?' + params;
        const response = await fetcher(url,
          {signal: active.signal, cache: 'no-store'});
        if (!response.ok) throw new Error('Hourly forecast unavailable');
        const data = await response.json();
        if (requestVersion !== version) return;
        if (!(source === 'aethra' ? validateAethra(data, now()) : validateHourly(data, now()))) throw new Error('Invalid or outdated hourly forecast');
        Object.assign(state, {data, loadedAt: now(), status: 'ready'});
      } catch {
        if (requestVersion !== version) return;
        Object.assign(state, {data: null, loadedAt: null, status: 'error'});
      } finally {
        clearTimeout(timeout);
        if (requestVersion === version) onChange(state);
      }
    })();
    return pending;
  }
  return {state, select};
}
