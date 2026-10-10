import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceFields, validateAethra, hourlyFresh, createHourlyLoader} from '../dist/hourly-data.js';
const now = new Date('2026-10-10T09:00:00Z');
const place = {lat:44.43, lon:26.1};
function fixture() {
  const data = {source:'aethra', timezone:'Europe/Bucharest', generated_at:+now/1000,
    expires_at:+now/1000+10800, hourly_units:{time:'unixtime',wind_direction_10m:'°'},
    hourly:{time:Array.from({length:168}, (_,i)=>+now/1000+i*3600),wind_direction_10m:Array(168).fill(270)}};
  for(const [key, meta] of Object.entries(sourceFields('aethra'))) {
    data.hourly_units[key]=meta.unit; data.hourly[key]=Array(168).fill(10);
  }
  return data;
}
test('Aethra has additional live variables without ambiguous pressure or fabricated snow',()=>{
  const fields=sourceFields('aethra');
  assert.equal(fields.apparent_temperature.label,'Feels like');
  assert.equal(fields.precipitation_probability.unit,'%');
  assert.equal(fields.surface_pressure,undefined);
  assert.equal(fields.snowfall,undefined); assert.equal(fields.pressure_msl,undefined);
  assert.equal(validateAethra(fixture(),now),true);
});
test('server expiry cannot be extended by a fresh browser retrieval',()=>{
  const data=fixture(); data.expires_at=+now/1000+5;
  assert.equal(hourlyFresh(now,data,new Date(+now+6000)),false);
  data.hourly_units.wind_speed_10m='m/s';
  assert.equal(validateAethra(data,now),false);
});
test('Aethra calls same-origin proxy, reuses data, and clears on failure',async()=>{
  const calls=[]; let fail=false;
  const loader=createHourlyLoader({now:()=>now,fetcher:async(url)=>{
    calls.push(url); return {ok:!fail,json:async()=>fixture()};
  }});
  await loader.select(place,{source:'aethra'}); await loader.select(place,{source:'aethra'});
  assert.equal(calls.length,1); assert.equal(calls[0],'/api/forecast?lat=44.43&lon=26.1');
  assert.equal(loader.state.status,'ready');
  fail=true; await loader.select(place,{source:'aethra',force:true});
  assert.equal(loader.state.data,null); assert.equal(loader.state.status,'error');
});
test('switching source aborts and ignores the previous source response',async()=>{
  const requests=[];
  const loader=createHourlyLoader({now:()=>now,fetcher:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))});
  const old=loader.select(place); const current=loader.select(place,{source:'aethra'});
  assert.equal(requests[0].options.signal.aborted,true); assert.equal(loader.state.data,null);
  requests[1].resolve({ok:true,json:async()=>fixture()}); await current;
  requests[0].resolve({ok:false}); await old;
  assert.equal(loader.state.status,'ready'); assert.equal(loader.state.data.source,'aethra');
});
