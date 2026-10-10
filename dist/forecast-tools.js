import {dayHours, hourLabel, offsetLabel, sourceFields} from './hourly-data.js';
import {dayStats, commonHours, rainWindows, riskFlags} from './forecast-tools-data.js';

const $ = id => document.getElementById(id);
const el = (tag, text = '', className = '') => { const n = document.createElement(tag); n.textContent = text; n.className = className; return n; };
const fmt = (n, unit = '', digits = 1) => Number.isFinite(n) ? n.toFixed(digits) + (unit ? ' ' + unit : '') : 'Not available';
const sourceName = source => source === 'aethra' ? 'Aethra' : 'ECMWF';
function stat(label, value, note = '') {
  const card = el('div', '', 'tool-stat');
  card.append(el('span', label), el('strong', value)); if (note) card.append(el('small', note)); return card;
}
function point(data, name) {
  if (data?.location) return (data.location.name || name) + ' · ' + data.location.lat.toFixed(2) + '° N, ' + data.location.lon.toFixed(2) + '° E';
  return Number.isFinite(data?.latitude) ? name + ' · grid point ' + data.latitude.toFixed(2) + '° N, ' + data.longitude.toFixed(2) + '° E' : name;
}
function coverage(data, date) {
  const stats = dayStats(data,date);
  return stats.hours + '/' + stats.expected + ' hourly readings' + (stats.hours < stats.expected ? ' · partial day' : '');
}
function lineChart(series, field, labels, colors) {
  const chart = document.createElementNS('http://www.w3.org/2000/svg','svg');
  chart.setAttribute('viewBox','0 0 800 240'); chart.setAttribute('role','img');
  chart.setAttribute('aria-label', labels.join(' and ') + ' ' + field.label + '. Exact readings in the table below.');
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(chart.namespaceURI, tag);
    Object.entries(attrs).forEach(([k,v]) => n.setAttribute(k,v));
    if (text !== undefined) n.textContent = text; chart.append(n);
  };
  const values = series.flatMap(s => s.values).filter(Number.isFinite);
  if (!values.length) return chart;
  const low = Math.min(...values) - 1, high = Math.max(...values) + 1;
  const x = i => 60 + i / Math.max(1,series[0].times.length - 1) * 710;
  const y = v => 195 - (v-low)/(high-low)*165;
  for (let i=0;i<4;i++) {
    const v = low + (high-low)*i/3;
    add('line',{x1:60,x2:770,y1:y(v),y2:y(v),stroke:'#293e50'});
    add('text',{x:50,y:y(v)+4,'text-anchor':'end',fill:'#9aafc2','font-size':12},v.toFixed(0));
  }
  add('text',{x:12,y:16,fill:'#9aafc2','font-size':12},field.unit);
  series.forEach((s,j) => {
    let d='', connected=false;
    s.values.forEach((v,i) => {
      if (!Number.isFinite(v)) { connected=false; return; }
      if (i && s.times[i]-s.times[i-1]!==3600) connected=false;
      d+=(connected?' L':' M')+x(i)+','+y(v); connected=true;
      add('circle',{cx:x(i),cy:y(v),r:2.5,fill:colors[j]});
    });
    add('path',{d,fill:'none',stroke:colors[j],'stroke-width':2.5});
  });
  series[0].times.forEach((t,i,a) => { if (i%4===0 || i===a.length-1) add('text',{x:x(i),y:225,'text-anchor':'middle',fill:'#9aafc2','font-size':12},hourLabel(t)); });
  return chart;
}
function table(headers, rows) {
  const details=el('details','','hourly-details'); details.append(el('summary','View exact readings'));
  const wrap=el('div','','hourly-table-scroll'); wrap.tabIndex=0; wrap.setAttribute('role','region'); wrap.setAttribute('aria-label','Forecast tool readings');
  const t=el('table'), head=el('thead'), tr=el('tr'), body=el('tbody');
  headers.forEach(label => {const th=el('th',label);th.scope='col';tr.append(th);});head.append(tr);
  rows.forEach(values => {const row=el('tr');values.forEach(v=>row.append(el('td',String(v))));body.append(row);});
  t.append(head,body);wrap.append(t);details.append(wrap);return details;
}
export function createForecastTools({store, onSelect}) {
  let place, date, saved = [], view = 'overview', source = 'ecmwf';
  const body = $('tools-content'), title = $('tools-view-title');
  function needs() {
    if (!place) return;
    if (view === 'compare') { store.load(place,'ecmwf'); store.load(place,'aethra'); }
    else if (view === 'saved') saved.forEach(p => store.load(p,source));
    else store.load(place, view === 'mountain' ? 'aethra' : source);
  }
  function stateMessage(state) { return state.status === 'error' ? 'Forecast unavailable. Retry with Refresh tools, or choose another source.' : 'Loading forecast…'; }
  function render() {
    if (!place || !date) return;
    $('tools-location').textContent = place.name + ' · ' + date;
    $('tools-source-control').hidden = view === 'compare' || view === 'mountain';
    $('tools-compare-control').hidden = view !== 'compare';
    $('tools-window-control').hidden = view !== 'rain';
    document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.tool === view)));
    body.replaceChildren();
    const actual = view === 'mountain' ? 'aethra' : source, state = store.peek(place,actual), data = state.data;
    $('tools-note').textContent = 'Follows the location and date above. Times are Europe/Bucharest. Forecasts are not observations.';
    if (view === 'saved') { renderSaved(); return; }
    if (view === 'compare') { renderCompare(); return; }
    title.textContent = {overview:'Your day at a glance',rain:'Find a less rainy window',mountain:'Mountain weather outlook'}[view];
    $('tools-status').textContent = sourceName(actual) + ' · ' + (data ? coverage(data,date) : stateMessage(state));
    if (!data || !dayHours(data,date).length) {
      body.append(el('p',data ? 'No hourly coverage for this date. Choose an earlier day or another forecast source.' : stateMessage(state),'tool-empty'));return;
    }
    $('tools-note').textContent = sourceName(actual) + ' · ' + point(data,place.name) + '. All times Europe/Bucharest. Forecasts, not observations.';
    if (view === 'overview') renderOverview(data);
    if (view === 'rain') renderRain(data);
    if (view === 'mountain') renderMountain(data);
  }
  function renderOverview(data) {
    const s=dayStats(data,date), grid=el('div','','tool-stat-grid');
    const summary=el('div','','tool-summary');
    summary.append(el('p','DAILY BRIEFING','eyebrow'));
    summary.append(el('h4',s.min !== null ? fmt(s.min,'°C',0) + ' to ' + fmt(s.max,'°C',0) + ' across the available hours.' : 'Temperature readings are unavailable.'));
    summary.append(el('p',(s.rain !== null ? fmt(s.rain,'mm') + ' precipitation across ' + s.rainHours + ' readings. ' : '') + (s.wind !== null ? 'Wind peaks at ' + fmt(s.wind,'km/h',0) + '.' : '')));
    summary.append(el('small',coverage(data,date) + '. Missing hours are excluded from totals and ranges.'));
    grid.append(stat('Temperature range',fmt(s.min,'°C',0)+' / '+fmt(s.max,'°C',0),s.tempHours+' readings'),
      stat('Precipitation',fmt(s.rain,'mm'),s.rainHours+' readings summed'),
      stat('Wet hours',s.wet === null ? 'Not available' : s.wet+' hours','At least 0.1 mm per hour'),
      stat('Peak wind',fmt(s.wind,'km/h',0),'At 10 metres'));
    body.append(summary,grid,el('h4','Weather indicators','tool-subhead'));
    const risks=el('div','','tool-risk-grid');
    riskFlags(data,date).forEach(r => {
      const card=el('div','','tool-risk'+(r.active?' flagged':''));
      card.append(el('span',r.active?'THRESHOLD REACHED':r.value === null?'NO DATA':'BELOW THRESHOLD','risk-label'),el('strong',r.label),
        el('p',fmt(r.value,r.unit)),el('small',r.rule));risks.append(card);
    });
    body.append(risks,el('p','These are simple, unofficial forecast indicators for the available hours, not weather warnings. Conditions below these thresholds can still be hazardous.','tool-footnote'));
  }
  function renderCompare() {
    title.textContent='Two forecasts, side by side';
    const a=store.peek(place,'ecmwf'), b=store.peek(place,'aethra'), field=$('tools-compare-field').value;
    $('tools-status').textContent='ECMWF + Aethra · matched hourly timestamps';
    if (!a.data || !b.data) {
      body.append(el('p','ECMWF: '+(a.data?'Ready':stateMessage(a))+' · Aethra: '+(b.data?'Ready':stateMessage(b)),'tool-empty'));return;
    }
    const rows=commonHours(a.data,b.data,date,field), meta=sourceFields()[field];
    if (!rows.length) {body.append(el('p','No overlapping readings for this day. Choose an earlier date.','tool-empty'));return;}
    const mean=rows.reduce((sum,r)=>sum+Math.abs(r.a-r.b),0)/rows.length;
    const grid=el('div','','tool-stat-grid compare-stats');
    grid.append(stat('Shared hours',String(rows.length),'Same timestamps in both forecasts'),stat('Average absolute difference',fmt(mean,meta.unit),'Across these matched hours'));
    const legend=el('p','','tool-chart-legend');legend.append(el('span','● ECMWF','ecmwf-key'),el('span','● Aethra','aethra-key'));
    body.append(grid,legend,lineChart([{times:rows.map(r=>r.time),values:rows.map(r=>r.a)},{times:rows.map(r=>r.time),values:rows.map(r=>r.b)}],meta,['ECMWF','Aethra'],['#7cf2c2','#c0acf4']));
    body.append(table(['Hour','ECMWF '+meta.unit,'Aethra '+meta.unit],rows.map(r=>[hourLabel(r.time)+' '+offsetLabel(r.time),fmt(r.a,'',1),fmt(r.b,'',1)])));
    $('tools-note').textContent='ECMWF: '+point(a.data,place.name)+'. Aethra: '+point(b.data,place.name)+'. Forecast points and methods differ; agreement is not a probability or a guarantee. Bucharest time.';
  }
  function renderRain(data) {
    const s=dayStats(data,date), size=Number($('tools-window').value), windows=rainWindows(data,date,size), grid=el('div','','tool-stat-grid compare-stats');
    grid.append(stat('Available precipitation total',fmt(s.rain,'mm'),s.rainHours+' hourly readings'),stat('Wet hours',s.wet === null?'Not available':s.wet+' hours','At least 0.1 mm per hour'));
    body.append(grid,el('h4','Least precipitation forecast · '+size+'-hour windows','tool-subhead'));
    const cards=el('div','','tool-window-grid');
    windows.forEach((w,i)=>{const card=stat(w.label,fmt(w.total,'mm'),'#'+(i+1)+' lowest total');cards.append(card);});
    body.append(windows.length?cards:el('p','No complete future windows for this duration and date. Try a shorter duration or the next day.','tool-empty'));
    const strip=el('div','','rain-strip');strip.setAttribute('aria-label','Hourly precipitation');
    const rows=dayHours(data,date);
    rows.forEach(h=>{
      const v=data.hourly.precipitation?.[h.index], chance=data.hourly.precipitation_probability?.[h.index];
      const cell=el('div','','rain-hour');cell.style.setProperty('--rain',Number.isFinite(v)?Math.min(100,Math.max(4,v*20))+'%':'0%');
      cell.append(el('span',hourLabel(h.time)),el('strong',fmt(v,'mm')),el('small',Number.isFinite(chance)?Math.round(chance)+'% chance':''));strip.append(cell);
    });body.append(strip,el('p','Windows exclude elapsed time and missing readings. Precipitation is summed over consecutive hourly intervals; the hour labels above mark interval ends. Lowest forecast rainfall does not guarantee dry weather.','tool-footnote'));
  }
  function renderMountain(data) {
    const s=dayStats(data,date),grid=el('div','','tool-stat-grid');
    grid.append(stat('Temperature',fmt(s.min,'°C',0)+' / '+fmt(s.max,'°C',0),'Available-hour range'),
      stat('Lowest feels like',fmt(s.feelsMin,'°C',0),'At the forecast point'),
      stat('Peak gust',fmt(s.gust,'km/h',0),'Available hours'),
      stat('Freezing level',fmt(s.freezeMin,'m',0)+'–'+fmt(s.freezeMax,'m',0),'Height above sea level'));
    body.append(grid,el('h4','Freezing level through the day','tool-subhead'));
    const rows=dayHours(data,date);
    body.append(lineChart([{times:rows.map(h=>h.time),values:rows.map(h=>data.hourly.freezing_level?.[h.index])}],sourceFields('aethra').freezing_level,['Aethra'],['#c0acf4']));
    body.append(table(['Hour','Freezing level m','Temperature °C','Gust km/h'],rows.map(h=>[hourLabel(h.time)+' '+offsetLabel(h.time),fmt(data.hourly.freezing_level?.[h.index],'',0),fmt(data.hourly.temperature_2m?.[h.index]),fmt(data.hourly.wind_gusts?.[h.index],'',0)])));
    body.append(el('p','Search for a mountain town such as Sinaia or Predeal to explore nearby conditions. These are point forecasts, not summit or ridge forecasts. Freezing level is the height of 0°C air, not the snowline; it does not predict avalanche or trail safety.','tool-footnote'));
  }
  function renderSaved() {
    title.textContent='Your places, one dashboard';
    $('tools-status').textContent=sourceName(source)+' · '+saved.length+' of 5 saved locations · '+date;
    if (!saved.length) {
      body.append(el('p','Save locations with Quick access above to compare their forecasts here. You can save any town found in search.','tool-empty'));
      const link=el('a','Go to Quick access','primary-link');link.href='#saved-title';body.append(link);return;
    }
    const grid=el('div','','tool-saved-grid');
    saved.forEach(p=>{
      const state=store.peek(p,source),s=state.data?dayStats(state.data,date):null,card=el('article','','tool-saved');
      card.append(el('h4',p.name),el('p',p.county||'Romania','tool-footnote'));
      if (s?.hours) {
        card.append(el('strong',fmt(s.min,'°C',0)+' / '+fmt(s.max,'°C',0),'saved-weather'));
        card.append(el('p',fmt(s.rain,'mm')+' precipitation · '+fmt(s.wind,'km/h',0)+' peak wind'),el('small',coverage(state.data,date)));
      } else card.append(el('p',state.data?'No coverage for this date.':stateMessage(state)));
      const button=el('button','Open forecast','primary-link');button.type='button';
      button.setAttribute('aria-label','Explore '+p.name+' from dashboard');button.onclick=()=>onSelect(p);card.append(button);grid.append(card);
    });body.append(grid);
  }
  document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{view=b.dataset.tool;needs();render();});
  $('tools-source').onchange=e=>{source=e.target.value;needs();render();};
  $('tools-compare-field').onchange=render;$('tools-window').onchange=render;
  $('tools-refresh').onclick=()=>{
    if (!place) return;
    if (view==='saved') saved.forEach(p=>store.load(p,source,{force:true}));
    else if(view==='compare') ['ecmwf','aethra'].forEach(s=>store.load(place,s,{force:true}));
    else store.load(place,view==='mountain'?'aethra':source,{force:true});
    render();
  };
  store.subscribe(render);
  return {update(nextPlace,nextDate,nextSaved){place=nextPlace;date=nextDate;saved=nextSaved;needs();render();},check(){needs();render();}};
}
