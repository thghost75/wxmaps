import {dayHours, hourlyDate, hourLabel} from './hourly-data.js';

export function expectedHours(date) {
  const noon = Date.parse(date + 'T12:00:00Z') / 1000;
  let count = 0;
  for (let time = noon - 24 * 3600; time <= noon + 24 * 3600; time += 3600)
    if (hourlyDate(time) === date) count++;
  return count;
}
export function dayStats(data, date) {
  const hours = dayHours(data, date);
  function series(field) { return hours.map(h => data.hourly[field]?.[h.index]).filter(Number.isFinite); }
  const temp = series('temperature_2m'), rain = series('precipitation'), wind = series('wind_speed_10m');
  const gust = series('wind_gusts'), freeze = series('freezing_level'), feels = series('apparent_temperature');
  return {hours: hours.length, expected: expectedHours(date), rainHours: rain.length, tempHours: temp.length,
    min: temp.length ? Math.min(...temp) : null, max: temp.length ? Math.max(...temp) : null,
    rain: rain.length ? rain.reduce((a,b) => a+b, 0) : null,
    wind: wind.length ? Math.max(...wind) : null, gust: gust.length ? Math.max(...gust) : null,
    freezeMin: freeze.length ? Math.min(...freeze) : null, freezeMax: freeze.length ? Math.max(...freeze) : null,
    feelsMin: feels.length ? Math.min(...feels) : null,
    wet: rain.length ? rain.filter(v => v >= .1).length : null};
}
export function commonHours(left, right, date, field) {
  const lookup = new Map(dayHours(right, date).map(h => [h.time, h.index]));
  return dayHours(left, date).flatMap(h => {
    const j = lookup.get(h.time), a = left.hourly[field]?.[h.index], b = right?.hourly[field]?.[j];
    return j !== undefined && Number.isFinite(a) && Number.isFinite(b) ? [{time: h.time, a, b}] : [];
  });
}
export function rainWindows(data, date, size = 3, now = Date.now() / 1000) {
  const hours = dayHours(data, date), candidates = [];
  for (let i = 0; i + size <= hours.length; i++) {
    const window = hours.slice(i, i + size);
    // Hourly precipitation is represented by the end of its one-hour interval.
    const start = window[0].time - 3600, end = window.at(-1).time;
    if (start < now || hourlyDate(start) !== date || !window.every((h,j) => !j || h.time - window[j-1].time === 3600)) continue;
    const values = window.map(h => data.hourly.precipitation?.[h.index]);
    if (!values.every(Number.isFinite)) continue;
    candidates.push({start, end, total: values.reduce((a,b) => a+b, 0), label: hourLabel(start) + '–' + hourLabel(end)});
  }
  const chosen = [];
  for (const candidate of candidates.sort((a,b) => a.total-b.total || a.start-b.start)) {
    if (chosen.every(other => candidate.end <= other.start || candidate.start >= other.end)) chosen.push(candidate);
    if (chosen.length === 3) break;
  }
  return chosen;
}
export function riskFlags(data, date) {
  const stats = dayStats(data, date), hours = dayHours(data, date);
  let rain6 = null;
  for (let i = 0; i + 6 <= hours.length; i++) {
    const part = hours.slice(i,i+6), values = part.map(h => data.hourly.precipitation?.[h.index]);
    if (values.every(Number.isFinite) && part.at(-1).time - part[0].time === 18000)
      rain6 = Math.max(rain6 ?? 0, values.reduce((a,b) => a+b,0));
  }
  return [
    {label:'Freezing air', rule:'Temperature ≤ 0°C', value:stats.min, active:stats.min !== null && stats.min <= 0, unit:'°C'},
    {label:'Heat', rule:'Temperature ≥ 32°C', value:stats.max, active:stats.max !== null && stats.max >= 32, unit:'°C'},
    {label:stats.gust !== null ? 'Strong gusts' : 'Strong wind', rule:stats.gust !== null ? 'Gusts ≥ 60 km/h' : 'Wind ≥ 40 km/h',
      value:stats.gust ?? stats.wind, active:stats.gust !== null ? stats.gust >= 60 : stats.wind !== null && stats.wind >= 40, unit:'km/h'},
    {label:'Heavy precipitation', rule:'Precipitation ≥ 20 mm in 6 hours', value:rain6, active:rain6 !== null && rain6 >= 20, unit:'mm / 6h'}
  ];
}
export function mapSnapshot(data, date, hour, field) {
  const reading = dayHours(data, date).find(h => hourLabel(h.time) === String(hour).padStart(2,'0') + ':00');
  return reading ? data.hourly[field]?.[reading.index] : null;
}
