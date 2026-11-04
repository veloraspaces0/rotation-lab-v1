'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {audit,latestClosedMinute,classifySignals}=require('./integrity.cjs');
const core=require('../v4-1/core.js');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 const config={...core.DEFAULT_CONFIG};
 const e={seq:1,prevHash:'GENESIS',type:'BASELINE',
  recordedAtUTC:'2026-11-04T04:01:00.000Z',candleOpenMs:Date.UTC(2026,10,4,0),
  payload:{configHash:sha(JSON.stringify(config)),coreHash:'frozen'}};
 e.hash=core.eventHash(e);
 return {schema:1,config,events:[e]};
}
function append(s,seq,minute=seq){
 const last=s.events.at(-1);
 const e={seq,prevHash:last.hash,type:'EVALUATION',
 recordedAtUTC:new Date(Date.UTC(2026,10,4,4*seq,minute)).toISOString(),
 candleOpenMs:Date.UTC(2026,10,4,4*(seq-1)),
 payload:{action:{type:'HOLD'},latencyMinutes:minute,shadow:{emitted:[{asset:'BTC'}]}}};
 e.hash=core.eventHash(e);s.events.push(e);return e;
}
test('baseline valid and bundle hash checked',()=>{
 assert.equal(audit(fixture(),{expectedBundleHash:'frozen'}).ok,true);
 assert.throws(()=>audit(fixture(),{expectedBundleHash:'changed'}),/Motor divergente/);
});
test('configuration tampering rejected',()=>{
 for(const key of ['takeProfit','riskBudget']){const s=fixture();s.config[key]*=2;
 assert.throws(()=>audit(s),/Configuração divergente/)}
});
test('event chain tampering rejected',()=>{
 const s=fixture();s.events[0].payload.configHash='x';
 assert.throws(()=>audit(s),/Integridade/);
});
test('sequence discontinuity rejected even after valid rehash',()=>{
 const s=fixture();const e=append(s,3);e.hash=core.eventHash(e);
 assert.throws(()=>audit(s),/Sequência descontínua|Integridade da cadeia comprometida/);
});
test('recordedAtUTC regression rejected',()=>{
 const s=fixture();const e=append(s,2);
 e.recordedAtUTC='2026-11-04T00:01:00.000Z';e.hash=core.eventHash(e);
 assert.throws(()=>audit(s),/regressivo/);
});
const row=(open,close)=>[open,'0','0','0',String(close),'0',open+59999];
test('minute candles sorted by timestamp, not API order',()=>{
 const now=Date.UTC(2026,10,4,5,5),a=now-180000,b=now-120000;
 assert.equal(latestClosedMinute([row(b,102),row(a,101)],now).close,102);
});
test('minute rejects invalid values and incomplete candles',()=>{
 const now=Date.UTC(2026,10,4,5,5);
 for(const bad of [NaN,Infinity,-1,0])assert.throws(()=>latestClosedMinute([row(now-120000,bad)],now),/inválido/);
 assert.throws(()=>latestClosedMinute([row(now-20000,100)],now),/Nenhum candle/);
});
test('shadow-only and executable signals classified separately',()=>{
 const s=fixture(),a=append(s,2,95),b=append(s,3,20);
 a.payload.action.type='SKIP_STALE';a.hash=core.eventHash(a);
 b.prevHash=a.hash;b.hash=core.eventHash(b);
 const x=classifySignals(s);
 assert.equal(x.shadowOnly,1);assert.equal(x.executable,1);assert.equal(x.total,2);
 assert.equal(x.lowExecutableShare,false);
});
test('low executable fraction triggers warning',()=>{
 const s=fixture(),a=append(s,2,95);
 a.payload.action.type='SKIP_STALE';
 assert.equal(classifySignals(s).lowExecutableShare,true);
});
