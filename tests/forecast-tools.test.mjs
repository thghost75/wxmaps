import test from 'node:test';
import assert from 'node:assert/strict';
import {hourlyFields} from '../dist/hourly-data.js';
import {expectedHours, dayStats, commonHours, rainWindows, riskFlags, mapSnapshot} from '../dist/forecast-tools-data.js';
import {createForecastStore} from '../dist/forecast-store.js';

const date='2026-10-11', start=Date.parse(date+'T00:00:00+03:00')/1000;
const now=new Date(date+'T00:00:00+03:00');
function fixture(time=start, length=168) {
  const data={timezone:'Europe/Bucharest',hourly_units:{time:'unixtime',wind_direction_10m:'°'},hourly:{time:Array.from({length},(_,i)=>time+i*3600),wind_direction_10m:Array(length).fill(0)}};
  Object.entries(hourlyFields).forEach(([field,meta])=>{data.hourly_units[field]=meta.unit;data.hourly[field]=Array(length).fill(field==='temperature_2m'?12:0);});
  return data;
}
test('coverage follows 23/24/25-hour Bucharest dates',()=>{
  assert.equal(expectedHours('2026-03-29'),23);
  assert.equal(expectedHours('2026-10-25'),25);
  assert.equal(expectedHours(date),24);
});
test('missing precipitation is never interpreted as zero and partial days are counted',()=>{
  const data=fixture(start+12*3600,4); data.hourly.precipitation=[null,null,null,null];
  assert.equal(dayStats(data,date).hours,4);
  assert.equal(dayStats(data,date).rain,null);
  assert.equal(dayStats(data,date).wet,null);
  data.hourly.precipitation[0]=0;
  assert.equal(dayStats(data,date).rain,0);
  assert.equal(dayStats(data,date).rainHours,1);
});
test('model comparison aligns timestamps rather than array indexes and drops missing pairs',()=>{
  const a=fixture(start,5),b=fixture(start+3600,4);
  a.hourly.temperature_2m=[1,2,3,null,5];b.hourly.temperature_2m=[20,30,40,50];
  assert.deepEqual(commonHours(a,b,date,'temperature_2m').map(r=>[r.a,r.b]),[[2,20],[3,30],[5,50]]);
});
test('rain windows require complete future consecutive intervals and do not overlap',()=>{
  const data=fixture(start,24); data.hourly.precipitation[3]=null;
  const windows=rainWindows(data,date,3,start+2*3600);
  assert.equal(windows.length,3);
  assert.ok(windows.every(w=>w.start>=start+3*3600 && w.end-w.start===10800 && w.total===0));
  assert.ok(windows.every((w,i)=>windows.every((v,j)=>i===j||w.end<=v.start||w.start>=v.end)));
  data.hourly.precipitation.fill(null);
  assert.deepEqual(rainWindows(data,date,3,start),[]);
});
test('risk thresholds require data and six complete rain hours',()=>{
  const data=fixture(start,5);data.hourly.precipitation.fill(10);
  data.hourly.temperature_2m=[-1,33,null,15,12];
  const risks=riskFlags(data,date);
  assert.equal(risks[0].active,true);assert.equal(risks[1].active,true);
  assert.equal(risks[3].value,null);assert.equal(risks[3].active,false);
  const full=fixture(start,6); full.hourly.precipitation.fill(4);
  assert.equal(riskFlags(full,date)[3].active,true);
});
test('map readings use the exact requested local hour, without substituting another day',()=>{
  const data=fixture();data.hourly.cloud_cover[12]=73;
  assert.equal(mapSnapshot(data,date,12,'cloud_cover'),73);
  assert.equal(mapSnapshot(data,'2026-10-21',12,'cloud_cover'),null);
  assert.equal(mapSnapshot(null,date,12,'cloud_cover'),null);
});
test('shared loading deduplicates consumers and caps parallel requests',async()=>{
  const pending=[],calls=[];
  const store=createForecastStore({now:()=>now,fetcher:url=>{calls.push(url);return new Promise(resolve=>pending.push(resolve));}});
  const a={lat:44,lon:26},b={lat:45,lon:26},c={lat:46,lon:26};
  const pa=store.load(a), duplicate=store.load(a),pb=store.load(b),pc=store.load(c);
  assert.equal(pa,duplicate);assert.equal(calls.length,2);assert.equal(store.peek(c).status,'loading');
  pending.shift()({ok:true,json:async()=>fixture()});await pa;
  assert.equal(calls.length,3);
  pending.shift()({ok:true,json:async()=>fixture()});pending.shift()({ok:true,json:async()=>fixture()});
  await Promise.all([pb,pc]);await store.load(a);assert.equal(calls.length,3);
  assert.equal(store.peek(a).status,'ready');
});
test('expired shared data disappears immediately and failed requests cool down',async()=>{
  let clock=now,calls=0,fail=false;
  const store=createForecastStore({now:()=>clock,fetcher:async()=>{calls++;return {ok:!fail,json:async()=>fixture()};}});
  const place={lat:44,lon:26}; await store.load(place);
  clock=new Date(+now+3*3600000);assert.equal(store.peek(place).data,null);
  fail=true;await store.load(place);assert.equal(store.peek(place).status,'error');
  await store.load(place);assert.equal(calls,2);
  await store.load(place,'ecmwf',{force:true});assert.equal(calls,3);
});
