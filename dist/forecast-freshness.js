const dateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit'});
export function bucharestDate(now = new Date()) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(now).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
export function currentForecastDates(dates, now = new Date()) {
  if (!Array.isArray(dates) || dates.length !== 7) return false;
  const today = bucharestDate(now);
  const start = Date.parse(today + 'T00:00:00Z');
  return dates.every((date, i) => date === new Date(start + i * 86400000).toISOString().slice(0, 10));
}
export function isFreshForecast(loadedAt, dates, now = new Date()) {
  if (!loadedAt || !Number.isFinite(+loadedAt)) return false;
  const age = +now - +loadedAt;
  return age >= 0 && age < 86400000 && bucharestDate(loadedAt) === bucharestDate(now) && currentForecastDates(dates, now);
}
