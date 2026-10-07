import {STORAGE_KEY, MAX_LOCATIONS, locationKey, readLocations, addLocation, writeLocations} from './saved-locations.js';
import {currentForecastDates, isFreshForecast} from './forecast-freshness.js';
const cities=[{name:'București',lat:44.4268,lon:26.1025},{name:'Cluj-Napoca',lat:46.7712,lon:23.6236},{name:'Timișoara',lat:45.7489,lon:21.2087},{name:'Iași',lat:47.1585,lon:27.6014},{name:'Constanța',lat:44.1598,lon:28.6348},{name:'Brașov',lat:45.6579,lon:25.6012},{name:'Craiova',lat:44.3302,lon:23.7949},{name:'Oradea',lat:47.0465,lon:21.9189},{name:'Sibiu',lat:45.7983,lon:24.1256},{name:'Suceava',lat:47.6635,lon:26.2732},{name:'Baia Mare',lat:47.6567,lon:23.5849},{name:'Galați',lat:45.4353,lon:28.008}];
const layers={temperature:{field:'temperature_2m_max',title:'Daily maximum temperature',unit:'°C',min:-10,max:35,colors:['#64a7ed','#7cf2c2','#f7c274','#ef8c87']},precipitation:{field:'precipitation_sum',title:'Daily precipitation total',unit:'mm',min:0,max:30,colors:['#a4cfce','#66c5e7','#6f94ef','#b391f1']},snow:{field:'snowfall_sum',title:'Daily new snowfall · estimated',unit:'cm',min:0,max:20,colors:['#b6dce4','#8cc7f1','#9fa0f0','#d69af1']},wind:{field:'wind_speed_10m_max',title:'Daily maximum wind · 10 m',unit:'km/h',min:0,max:60,colors:['#a1d7bd','#7ccebd','#e4c075','#ef8c87']}};
const $=id=>document.getElementById(id);
const overviewCount=cities.length;
let selected=0,day=0,layer='temperature',forecasts=null,dates=[],loadedAt=null,busy=false;
let forecastController=null,forecastVersion=0,searchController=null,searchVersion=0;
let lastAttemptAt=0;
const retryDelay=5*60*1000;
let savedLocations=[];
let savedReadError='';
try { const saved=readLocations(localStorage);savedLocations=saved.locations;savedReadError=saved.error; }
catch { savedReadError='Saved locations are unavailable in this browser.'; }
const fmtDate=(s,options)=>new Intl.DateTimeFormat('en-GB',{...options,timeZone:'Europe/Bucharest'}).format(new Date(s+'T12:00:00+03:00'));
const number=(n,digits=0)=>Number.isFinite(n)?n.toFixed(digits):'—';
const value=(index,field)=>isFreshForecast(loadedAt,dates)?forecasts?.[index]?.daily?.[field]?.[day]:undefined;
function color(n){const l=layers[layer];return Number.isFinite(n)?l.colors[Math.min(3,Math.floor(Math.max(0,Math.min(.999,(n-l.min)/(l.max-l.min)))*4))]:'#73869a'}
// Mercator uses one scale on both axes. Equal angular scaling stretched Romania.
const radians=Math.PI/180;
const mercatorY=lat=>Math.log(Math.tan(Math.PI/4+lat*radians/2));
function project(lon,lat){return [450+(lon-25)*radians*3600,290-(mercatorY(lat)-mercatorY(46))*3600]}
function placeCountryLabels(){
  const labels=[['HUNGARY',19.7,47.3],['SERBIA',21.2,43.7],['BULGARIA',25,43],['UKRAINE',25.7,48.65],['MOLDOVA',29.3,47],['BLACK SEA',30,43.8]];
  const group=$('country-labels');
  group.replaceChildren(...labels.map(([name,lon,lat])=>{const [x,y]=project(lon,lat);const label=svg('text',{x,y,'text-anchor':'middle',class:name==='BLACK SEA'?'sea-label':''});label.textContent=name;return label}));
}
function svg(tag,attrs){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el}
async function map(){try{const res=await fetch('./region.json');if(!res.ok)throw Error();const data=await res.json();for(const f of data.features){const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;const d=polys.map(poly=>poly.map(ring=>ring.map(([lon,lat],i)=>(i?'L':'M')+project(lon,lat).map(n=>n.toFixed(2)).join(',')).join(' ')+'Z').join(' ')).join(' ');$('countries').append(svg('path',{d,class:'country'+(f.properties.name==='Romania'?' romania':''),'fill-rule':'evenodd'}))}}catch{$('map-error').hidden=false}renderMarkers()}
function renderMarkers(){const fragment=document.createDocumentFragment();cities.forEach((c,i)=>{const [x,y]=project(c.lon,c.lat);const n=value(i,layers[layer].field);const g=svg('g',{transform:'translate('+x+','+y+')',class:'marker'+(i===selected?' selected':''),role:'button',tabindex:'0','aria-label':c.name+', '+layers[layer].title+': '+number(n,layer==='snow'?1:0)+' '+layers[layer].unit,'aria-pressed':String(i===selected)});g.append(svg('circle',{r:20,fill:'transparent',stroke:'none'}));g.append(svg('circle',{r:i===selected?9:7,fill:color(n)}));const label=svg('text',{x:c.lon>27.8?-13:13,y:3,'text-anchor':c.lon>27.8?'end':'start'});label.textContent=c.name;const reading=svg('text',{x:c.lon>27.8?-13:13,y:22,class:'marker-value','text-anchor':c.lon>27.8?'end':'start'});reading.textContent=number(n,layer==='snow'?1:0)+(Number.isFinite(n)?(layer==='temperature'?'°':' '+layers[layer].unit):'');const activePoint=project(cities[selected].lon,cities[selected].lat);if(i===selected||Math.hypot(x-activePoint[0],y-activePoint[1])>65)g.append(label,reading);g.addEventListener('click',()=>chooseCity(i));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseCity(i);$('markers').children[i]?.focus()}});fragment.append(g)});$('markers').replaceChildren(fragment)}
function chooseCity(i){selected=i;render()}
function render(){expireForecast();renderSavedLocations();const c=cities[selected],l=layers[layer];$('city-select').value=String(selected);$('city-name').textContent=c.name;$('coordinates').textContent=(c.county?c.county+' · ':'')+c.lat.toFixed(2)+'° N · '+c.lon.toFixed(2)+'° E';$('map-title').textContent=l.title;$('map-date').textContent=dates[day]?fmtDate(dates[day],{weekday:'long',day:'numeric',month:'long'}):'Forecast unavailable';$('selected-date').textContent=$('map-date').textContent;$('primary-value').textContent=number(value(selected,l.field),['precipitation','snow'].includes(layer)?1:0);$('primary-unit').textContent=l.unit;$('primary-label').textContent=l.title;$('temp-range').textContent=number(value(selected,'temperature_2m_min'))+'° / '+number(value(selected,'temperature_2m_max'))+'°C';$('snow-value').textContent=number(value(selected,'snowfall_sum'),1)+' cm';$('snow-note').hidden=layer!=='snow';$('rain-value').textContent=number(value(selected,'precipitation_sum'),1)+' mm';$('wind-value').textContent=number(value(selected,'wind_speed_10m_max'))+' km/h';$('meteogram').href='https://charts.ecmwf.int/products/opencharts_meteogram?'+new URLSearchParams({epsgram:'classical_10d',lat:c.lat,lon:c.lon,station_name:c.name});$('legend-low').textContent=l.min+' '+l.unit;$('legend-high').textContent=l.max+' '+l.unit;$('legend-ramp').style.background='linear-gradient(90deg,'+l.colors.join(',')+')';document.querySelectorAll('[data-layer]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layer===layer)));if(dates.length){$('days').replaceChildren(...dates.map((date,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(day===i));b.setAttribute('aria-label',fmtDate(date,{weekday:'long',day:'numeric',month:'long'}));const w=document.createElement('span');w.textContent=fmtDate(date,{weekday:'short'});const d=document.createElement('strong');d.textContent=fmtDate(date,{day:'numeric',month:'short'});b.append(w,d);b.onclick=()=>{day=i;render();$('days').children[i]?.focus()};return b}))}else{$('days').textContent='Forecast dates will appear when data is available.'}renderMarkers()}
function validForecast(f){return f?.timezone==='Europe/Bucharest'&&currentForecastDates(f.daily?.time)&&f.daily_units?.snowfall_sum==='cm'&&Object.values(layers).every(l=>Array.isArray(f.daily[l.field])&&f.daily[l.field].length===7)&&Array.isArray(f.daily.temperature_2m_min)&&f.daily.temperature_2m_min.length===7}
function clearForecast(){forecasts=null;dates=[];loadedAt=null;day=0}
function expireForecast(){
  if(!forecasts||isFreshForecast(loadedAt,dates))return false;
  clearForecast();
  $('status').textContent='Forecast expired · updating required';
  $('forecast-note').textContent='Old forecast data has been cleared. Waiting for a fresh forecast.';
  return true;
}
function checkFreshness(){
  const expired=expireForecast();
  if(expired)render();
  if(document.visibilityState==='hidden'||busy||isFreshForecast(loadedAt,dates))return;
  const elapsed=Date.now()-lastAttemptAt;
  if(expired||!lastAttemptAt||elapsed>=retryDelay||elapsed<0)load();
}
async function load(restart=false){
  if(busy&&!restart)return;
  forecastController?.abort();
  const controller=new AbortController();
  forecastController=controller;
  const version=++forecastVersion;
  const requestedCities=cities.map(c=>({...c}));
  const timer=setTimeout(()=>controller.abort(),20000);
  lastAttemptAt=Date.now();
  busy=true;
  // Never carry expired readings into a new local day, even while fetching.
  expireForecast();
  $('refresh').disabled=true;
  $('status').textContent='Updating forecast…';
  render();
  try{
    const query=new URLSearchParams({latitude:requestedCities.map(c=>c.lat).join(','),longitude:requestedCities.map(c=>c.lon).join(','),daily:'temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max',models:'ecmwf_ifs025',timezone:'Europe/Bucharest',forecast_days:'7'});
    const res=await fetch('https://api.open-meteo.com/v1/forecast?'+query,{signal:controller.signal,cache:'no-store'});
    if(!res.ok)throw Error('Forecast service returned '+res.status);
    const data=await res.json();
    if(version!==forecastVersion)return;
    if(!Array.isArray(data)||data.length!==requestedCities.length||!data.every(validForecast)||!data.every(f=>f.daily.time.join()===data[0].daily.time.join()))throw Error('Incomplete or outdated forecast response');
    forecasts=data;
    dates=data[0].daily.time;
    loadedAt=new Date();
    $('status').textContent='Retrieved '+new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Bucharest'}).format(loadedAt)+' · Bucharest time · updates daily';
    $('forecast-note').textContent='ECMWF IFS 0.25° via Open-Meteo. One model forecast; values are not observations or ensemble probabilities.';
    render();
  }catch(e){
    if(version!==forecastVersion)return;
    clearForecast();
    $('status').textContent='Forecast unavailable · automatic retry pending';
    $('forecast-note').textContent='Could not retrieve a current forecast. Old readings have been cleared. Retrying every five minutes while this page is visible, or use Refresh data.';
    render();
  }finally{
    clearTimeout(timer);
    if(version===forecastVersion){busy=false;$('refresh').disabled=false}
  }
}

function clearSearch(message=''){
  searchVersion++;
  searchController?.abort();
  $('search-results').replaceChildren();
  $('search-results').hidden=true;
  $('search-status').textContent=message;
  $('location-search').setAttribute('aria-expanded','false');
  $('search-submit').disabled=false;
}

async function selectPlace(place){
  clearSearch();
  const normalizeName=name=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const known=cities.slice(0,overviewCount).findIndex(c=>normalizeName(c.name)===normalizeName(place.name)&&Math.abs(c.lat-place.latitude)<0.03&&Math.abs(c.lon-place.longitude)<0.03);
  if(known>=0){chooseCity(known);$('search-status').textContent='Selected '+cities[known].name;return}
  const previous=cities[overviewCount];
  const samePlace=previous?.id===place.id;
  cities[overviewCount]={id:place.id,name:place.name,lat:place.latitude,lon:place.longitude,county:place.admin1||'',elevation:place.elevation};
  if(!samePlace&&forecasts)forecasts[overviewCount]=null;
  let option=$('city-select').querySelector('[data-searched]');
  if(!option){option=document.createElement('option');option.dataset.searched='true';option.value=overviewCount;$('city-select').append(option)}
  option.textContent=place.name+(place.admin1?' · '+place.admin1:'');
  selected=overviewCount;
  $('search-status').textContent='Selected '+option.textContent;
  $('forecast-note').textContent='Loading the forecast for '+place.name+'…';
  render();
  await load(true);
}

async function searchLocations(){
  const query=$('location-search').value.trim();
  clearSearch();
  if(query.length<2){$('search-status').textContent='Enter at least two characters.';return}
  const version=searchVersion;
  const controller=new AbortController();
  searchController=controller;
  const timer=setTimeout(()=>controller.abort(),12000);
  $('search-submit').disabled=true;
  $('search-status').textContent='Searching Romania…';
  try{
    const params=new URLSearchParams({name:query,count:'20',language:'ro',countryCode:'RO'});
    const response=await fetch('https://geocoding-api.open-meteo.com/v1/search?'+params,{signal:controller.signal});
    if(!response.ok)throw Error('Search unavailable');
    const data=await response.json();
    if(version!==searchVersion)return;
    const places=(data.results||[]).filter(p=>p.country_code==='RO'&&p.feature_code?.startsWith('PPL')&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
    const results=places.map(place=>{
      const li=document.createElement('li');
      const button=document.createElement('button');button.type='button';
      const name=document.createElement('strong');name.textContent=place.name;
      const details=document.createElement('span');details.textContent=[place.admin1,place.admin2].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' · ');
      button.append(name,details);button.onclick=()=>selectPlace(place);li.append(button);return li;
    });
    $('search-results').replaceChildren(...results);
    $('search-results').hidden=!places.length;
    $('location-search').setAttribute('aria-expanded',String(places.length>0));
    $('search-status').textContent=places.length?places.length+' matching places. Choose a result.'+(data.results.length===20?' Add a county after a comma to narrow the search.':''):'No Romanian towns or villages found. Try another spelling or a nearby town.';
  }catch(e){
    if(version===searchVersion)$('search-status').textContent='Location search is unavailable. Try again; the overview cities still work.';
  }finally{
    clearTimeout(timer);
    if(version===searchVersion)$('search-submit').disabled=false;
  }
}


function renderSavedLocations(){
  const current=cities[selected];
  const alreadySaved=savedLocations.some(place=>locationKey(place)===locationKey(current));
  $('saved-count').textContent=savedLocations.length+' / '+MAX_LOCATIONS;
  $('save-current').disabled=alreadySaved||savedLocations.length>=MAX_LOCATIONS;
  $('save-current').textContent=alreadySaved?'Location saved':savedLocations.length>=MAX_LOCATIONS?'All 5 slots filled':'Save '+current.name;
  $('saved-help').textContent=savedLocations.length>=MAX_LOCATIONS?'Remove a location to make room for another. Saved in this browser.':'Select a location, then save it here. Saved in this browser.';
  const entries=[];
  for(let index=0;index<MAX_LOCATIONS;index++){
    const place=savedLocations[index];
    const item=document.createElement('li');
    if(!place){
      item.className='saved-empty';
      const slot=document.createElement('span');slot.textContent=String(index+1).padStart(2,'0');
      const label=document.createElement('span');label.textContent='Empty slot';
      item.append(slot,label);
    }else{
      item.className='saved-card';
      const open=document.createElement('button');open.type='button';open.className='saved-open';
      open.setAttribute('aria-label','Open forecast for '+place.name+(place.county?', '+place.county:''));
      open.setAttribute('aria-pressed',String(locationKey(place)===locationKey(current)));
      const name=document.createElement('strong');name.textContent=place.name;
      const county=document.createElement('span');county.textContent=place.county||'Romania';
      open.append(name,county);
      open.onclick=async()=>{
        $('saved-status').textContent='Opening '+place.name+'…';
        await selectPlace({id:place.id,name:place.name,latitude:place.lat,longitude:place.lon,admin1:place.county});
        $('saved-status').textContent='Selected '+place.name+'.';
        $('saved-locations').querySelector('.saved-open[aria-pressed="true"]')?.focus();
      };
      const remove=document.createElement('button');remove.type='button';remove.className='saved-remove';remove.textContent='×';
      remove.setAttribute('aria-label','Remove '+place.name+(place.county?', '+place.county:'')+' from saved locations');
      remove.onclick=()=>{
        const next=savedLocations.filter(entry=>locationKey(entry)!==locationKey(place));
        if(persistSavedLocations(next,place.name+' removed.')){
          const focusTarget=$('save-current').disabled?$('saved-locations').querySelector('.saved-open'):$('save-current');
          focusTarget?.focus();
        }
      };
      item.append(open,remove);
    }
    entries.push(item);
  }
  $('saved-locations').replaceChildren(...entries);
}

function persistSavedLocations(next,message){
  try{
    writeLocations(localStorage,next);
    savedLocations=next;
    renderSavedLocations();
    $('saved-status').textContent=message;
    return true;
  }catch{
    $('saved-status').textContent='Could not save changes. Check that this browser allows local storage.';
    return false;
  }
}

$('save-current').onclick=()=>{
  try{persistSavedLocations(addLocation(savedLocations,cities[selected]),cities[selected].name+' saved for quick access.');}
  catch(error){$('saved-status').textContent=error.message;}
};
$('saved-status').textContent=savedReadError;
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE_KEY&&event.key!==null)return;
  try{
    const saved=readLocations(localStorage);savedLocations=saved.locations;
    renderSavedLocations();$('saved-status').textContent=saved.error;
  }catch{$('saved-status').textContent='Saved locations could not be refreshed.';}
});

$('location-form').addEventListener('submit',event=>{event.preventDefault();searchLocations()});
$('location-search').addEventListener('input',()=>clearSearch());
$('location-search').addEventListener('keydown',event=>{if(event.key==='Escape')clearSearch();if(event.key==='ArrowDown'){const first=$('search-results').querySelector('button');if(first){event.preventDefault();first.focus()}}});
$('search-results').addEventListener('keydown',event=>{
  const buttons=Array.from($('search-results').querySelectorAll('button'));
  const i=buttons.indexOf(document.activeElement);
  if(event.key==='Escape'){clearSearch();$('location-search').focus()}
  else if(['ArrowDown','ArrowUp'].includes(event.key)&&i>=0){event.preventDefault();buttons[(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus()}
});
cities.forEach((c,i)=>{const o=document.createElement('option');o.value=i;o.textContent=c.name;$('city-select').append(o)});
$('city-select').onchange=e=>chooseCity(Number(e.target.value));document.querySelectorAll('[data-layer]').forEach(b=>b.onclick=()=>{layer=b.dataset.layer;render()});$('refresh').onclick=()=>load();render();placeCountryLabels();map();load();
setInterval(checkFreshness,60000);
document.addEventListener('visibilitychange',checkFreshness);
window.addEventListener('focus',checkFreshness);
window.addEventListener('pageshow',checkFreshness);
window.addEventListener('online',()=>{lastAttemptAt=0;checkFreshness()});
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'select_forecast',description:'Select a Romanian city, weather variable and forecast day in WxMaps.',inputSchema:{type:'object',properties:{city:{type:'string',description:'Name of an overview city or the currently selected search result'},variable:{type:'string',enum:Object.keys(layers)},day:{type:'integer',minimum:0,maximum:6}},required:['city','variable','day'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){const i=cities.findIndex(c=>c.name===input?.city);if(i<0||!Object.hasOwn(layers,input.variable)||!Number.isInteger(input.day)||input.day<0||input.day>6)throw Error('Invalid forecast selection');if(!isFreshForecast(loadedAt,dates)||!validForecast(forecasts?.[i]))throw Error('Forecast is not available');selected=i;layer=input.variable;day=input.day;render();return {city:cities[i].name,date:dates[day],variable:layer,value:value(i,layers[layer].field),unit:layers[layer].unit}}})).catch(()=>{})}catch{}}
