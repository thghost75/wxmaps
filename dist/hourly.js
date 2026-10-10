import {bucharestDate} from './forecast-freshness.js';
import {sourceFields, createHourlyLoader, dayHours, hourLabel, offsetLabel, windDirection} from './hourly-data.js';

const $ = id => document.getElementById(id);
const format = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const node = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
const svg = (tag, attrs, text) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
};

export function createHourlyPanel() {
  let place, date, hours = [], selectedHour = 0, field = 'temperature_2m', selectionKey = '';
  let source = 'ecmwf', hourlyFields = sourceFields(source);
  const loader = createHourlyLoader({onChange: render});
  function configureSource() {
    hourlyFields = sourceFields(source);
    if (!hourlyFields[field]) field = 'temperature_2m';
    $('hourly-variable').replaceChildren(...Object.entries(hourlyFields).map(([key, meta]) => {
      const option = node('option', meta.label); option.value = key; return option;
    }));
    $('hourly-variable').value = field;
    $('hourly-table-head').replaceChildren(...['Hour', ...Object.values(hourlyFields).map(meta => meta.label + ' ' + meta.unit), 'Wind from'].map(label => {
      const th = node('th', label); th.scope = 'col'; return th;
    }));
    $('hourly-source-note').textContent = source === 'aethra'
      ? 'Aethra forecast · Up to seven days ahead from the current hour. Wind is shown in km/h. Pressure is surface pressure, not sea-level pressure. Snowfall is not supplied. The daily map above continues to use ECMWF.'
      : 'ECMWF IFS 0.25° via Open-Meteo · Hourly values are interpolated from coarser model steps, not observations. Precipitation and new snowfall are totals for the preceding hour; snow is not ground depth. Pressure is adjusted to sea level.';
  }
  configureSource();

  function renderChart() {
    const meta = hourlyFields[field];
    const values = hours.map(hour => loader.state.data.hourly[field][hour.index]);
    const valid = values.filter(Number.isFinite);
    const chart = $('hourly-chart');
    chart.replaceChildren();
    chart.setAttribute('aria-label', meta.label + ' forecast for ' + place.name + ' on ' + date + '. Exact values are in the hourly table below.');
    if (!valid.length) { chart.append(svg('text', {x: 450, y: 130, 'text-anchor': 'middle', fill: '#9aafc2'}, 'No readings available for this variable')); return; }
    let low = Math.min(...valid), high = Math.max(...valid);
    if (meta.bars) { low = 0; high = Math.max(1, high * 1.15); }
    else if (meta.unit === '%') { low = 0; high = 100; }
    else { const pad = Math.max((high - low) * .15, meta.unit === 'hPa' ? 1 : 2); low -= pad; high += pad; }
    const x = i => 65 + i / Math.max(1, hours.length - 1) * 795;
    const y = value => 218 - (value - low) / (high - low) * 184;
    for (let i = 0; i < 5; i++) {
      const value = low + (high - low) * i / 4;
      chart.append(svg('line', {x1: 65, x2: 860, y1: y(value), y2: y(value), stroke: '#293e50'}));
      chart.append(svg('text', {x: 53, y: y(value) + 4, 'text-anchor': 'end', fill: '#9aafc2', 'font-size': 12}, value.toFixed(meta.bars ? 1 : 0)));
    }
    chart.append(svg('text', {x: 12, y: 18, fill: '#9aafc2', 'font-size': 12}, meta.unit));
    hours.forEach((hour, i) => {
      if (i % 3 === 0 || i === hours.length - 1) chart.append(svg('text', {x: x(i), y: 245, 'text-anchor': 'middle', fill: '#9aafc2', 'font-size': 12}, hourLabel(hour.time)));
    });
    if (meta.bars) {
      values.forEach((value, i) => { if (Number.isFinite(value)) chart.append(svg('rect', {x: x(i) - 9, y: y(value), width: 18, height: Math.max(value === 0 ? 1 : 0, 218 - y(value)), rx: 3, fill: meta.color, opacity: i === selectedHour ? 1 : .7})); });
    } else {
      let path = '', connected = false;
      values.forEach((value, i) => { if (!Number.isFinite(value)) { connected = false; return; } path += (connected ? ' L' : ' M') + x(i) + ',' + y(value); connected = true; });
      chart.append(svg('path', {d: path, fill: 'none', stroke: meta.color, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'}));
    }
    chart.append(svg('line', {x1: x(selectedHour), x2: x(selectedHour), y1: 28, y2: 218, stroke: '#edf4fa', 'stroke-dasharray': '4 5', opacity: .6}));
    if (Number.isFinite(values[selectedHour])) chart.append(svg('circle', {cx: x(selectedHour), cy: y(values[selectedHour]), r: 5, fill: meta.color, stroke: '#edf4fa', 'stroke-width': 2}));
  }

  function renderSelection() {
    if (!hours.length) return;
    const hour = hours[selectedHour], data = loader.state.data.hourly;
    const label = hourLabel(hour.time) + ' · ' + offsetLabel(hour.time);
    $('hourly-selected-time').textContent = label;
    $('hourly-slider').value = selectedHour;
    $('hourly-slider').setAttribute('aria-valuetext', label);
    $('hourly-prev').disabled = selectedHour === 0;
    $('hourly-next').disabled = selectedHour === hours.length - 1;
    $('hourly-reading').textContent = format(data[field][hour.index], hourlyFields[field].digits) + ' ' + hourlyFields[field].unit;
    const cards = Object.entries(hourlyFields).map(([key, meta]) => {
      const card = node('div', '', 'hourly-card');
      card.append(node('dt', meta.label), node('dd', format(data[key][hour.index], meta.digits) + ' ' + meta.unit));
      return card;
    });
    const direction = data.wind_direction_10m[hour.index];
    const card = node('div', '', 'hourly-card');
    const reading = node('dd', windDirection(direction) + (Number.isFinite(direction) ? ' · ' + Math.round(direction) + '°' : ''));
    if (Number.isFinite(direction)) {
      const arrow = node('span', '↑', 'wind-arrow'); arrow.setAttribute('aria-hidden', 'true'); arrow.style.transform = 'rotate(' + direction + 'deg)'; reading.prepend(arrow);
    }
    card.append(node('dt', 'Wind from'), reading); cards.push(card);
    $('hourly-metrics').replaceChildren(...cards);
    $('hourly-table-body').querySelectorAll('tr').forEach((row, i) => {
      row.classList.toggle('active-hour', i === selectedHour);
      row.querySelector('button').setAttribute('aria-pressed', String(i === selectedHour));
    });
    renderChart();
  }

  function renderTable() {
    const data = loader.state.data.hourly;
    $('hourly-table-body').replaceChildren(...hours.map((hour, i) => {
      const row = document.createElement('tr');
      const time = document.createElement('th'); time.scope = 'row';
      const button = node('button', hourLabel(hour.time) + ' ' + offsetLabel(hour.time));
      button.type = 'button'; button.setAttribute('aria-label', 'Show ' + button.textContent + ' forecast');
      button.onclick = () => { selectedHour = i; renderSelection(); };
      time.append(button); row.append(time);
      for (const [key, meta] of Object.entries(hourlyFields)) row.append(node('td', format(data[key][hour.index], meta.digits)));
      row.append(node('td', windDirection(data.wind_direction_10m[hour.index])));
      return row;
    }));
  }

  function render() {
    if (!place) return;
    const state = loader.state;
    $('hourly-city').textContent = place.name;
    $('hourly-date').textContent = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Bucharest', weekday: 'long', day: 'numeric', month: 'long'}).format(new Date(date + 'T12:00:00Z'));
    $('hourly-retry').hidden = state.status !== 'error';
    $('hourly-panel').setAttribute('aria-busy', String(state.status === 'loading'));
    hours = state.data ? dayHours(state.data, date) : [];
    $('hourly-content').hidden = !hours.length;
    $('hourly-variable').disabled = !hours.length;
    if (!hours.length) {
      $('hourly-metrics').replaceChildren(); $('hourly-chart').replaceChildren(); $('hourly-table-body').replaceChildren(); $('hourly-reading').textContent = '—';
      $('hourly-status').textContent = state.status === 'error'
        ? (source === 'aethra' ? 'Aethra is temporarily unavailable. Choose ECMWF above or retry later.' : 'Hourly forecast unavailable. Old readings have been cleared; retry below.')
        : state.status === 'ready' ? 'No hourly readings are available for this day.' : 'Loading hourly forecast…';
      return;
    }
    $('hourly-status').textContent = (source === 'aethra' ? 'Aethra · Retrieved ' : 'ECMWF · Retrieved ') + hourLabel(+state.loadedAt / 1000) + ' · Bucharest time';
    const key = state.key + '|' + date;
    if (selectionKey !== key) {
      const target = date === bucharestDate() ? Date.now() / 1000 : Date.parse(date + 'T09:00:00Z') / 1000;
      selectedHour = hours.reduce((best, hour, i) => Math.abs(hour.time - target) < Math.abs(hours[best].time - target) ? i : best, 0);
      selectionKey = key;
    }
    selectedHour = Math.min(selectedHour, hours.length - 1);
    $('hourly-slider').max = hours.length - 1;
    renderTable(); renderSelection();
  }

  $('hourly-provider').onchange = event => {
    source = event.target.value; configureSource();
    if (place) { loader.select(place, {source}); render(); }
  };
  $('hourly-variable').onchange = event => { field = event.target.value; renderSelection(); };
  $('hourly-slider').oninput = event => { selectedHour = Number(event.target.value); renderSelection(); };
  $('hourly-prev').onclick = () => { selectedHour = Math.max(0, selectedHour - 1); renderSelection(); };
  $('hourly-next').onclick = () => { selectedHour = Math.min(hours.length - 1, selectedHour + 1); renderSelection(); };
  $('hourly-retry').onclick = () => loader.select(place, {force: true, source});
  return {
    update(nextPlace, nextDate) {
      place = nextPlace; date = nextDate || bucharestDate();
      // Start the new request before rendering, so a different location never shows old data.
      loader.select(place, {source}); render();
    },
    refresh() { if (place) loader.select(place, {force: true, source}); },
    check() { if (place && document.visibilityState !== 'hidden') { loader.select(place, {source}); render(); } },
  };
}
