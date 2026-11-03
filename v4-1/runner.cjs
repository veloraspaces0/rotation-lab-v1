/* Rotation Lab V4.1: forward-only Binance monitor with two price reads + bookTicker + 1m close.
 * Public API, no keys, no accounts, no real orders.
 */
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {runCycle,verify,ASSETS,BAR_MS}=require('./core.js');
const STATE_FILE='v4-1/state.json';
const FREEZE_FILES=['v4-1/core.js','v4-1/runner.cjs','.github/workflows/rotation-lab-v4-1.yml'];
const BASES=['https://data-api.binance.vision','https://api.binance.com'];
const SHA=x=>crypto.createHash('sha256').update(x).digest('hex');
const rel=(x,y)=>Math.abs(x-y)/Math.max(1e-8,y);
const positive=x=>Number.isFinite(x)&&x>0;
function freezeHash(){
  return SHA(JSON.stringify(FREEZE_FILES.map(path=>({file:path,sha256:SHA(fs.readFileSync(path))}))));
}
async function fetchJson(url){
  const resp=await fetch(url,{signal:AbortSignal.timeout(18000),
    headers:{Accept:'application/json','User-Agent':'Rotation-Lab-V4-1-Virtual-Study/1.0'}});
  if(!resp.ok)throw Error('Binance HTTP '+resp.status+' '+url.split('?')[0]);
  const value=await resp.json();
  if(value&&value.code&&value.msg)throw Error('Binance: '+value.msg);
  return value;
}
function lastClosedMinute(rows,now){
  if(!Array.isArray(rows))throw Error('1m candles inválidos');
  const eligible=rows.filter(row=>Number(row[6])<=now-3000);
  if(!eligible.length)throw Error('Nenhum candle 1m fechado');
  const last=eligible.at(-1);
  return {close:Number(last[4]),closedAtMs:Number(last[6])};
}
async function quoteWithCrossCheck(base,asset,lastFourHourClose){
  const pair=asset+'USDT';
  const tickerURL=base+'/api/v3/ticker/price?symbol='+pair;
  const quote1=await fetchJson(tickerURL);
  const [book,candles1m,quote2]=await Promise.all([
    fetchJson(base+'/api/v3/ticker/bookTicker?symbol='+pair),
    fetchJson(base+'/api/v3/klines?symbol='+pair+'&interval=1m&limit=4'),
    fetchJson(tickerURL)
  ]);
  const atMs=Date.now(),tickerFirst=Number(quote1.price),tickerSecond=Number(quote2.price);
  const bid=Number(book.bidPrice),ask=Number(book.askPrice);
  const minute=lastClosedMinute(candles1m,atMs),minuteClose=minute.close;
  const minuteAgeMs=atMs-minute.closedAtMs;
  if(![tickerFirst,tickerSecond,bid,ask,minuteClose].every(positive)||ask<bid)
    throw Error('Preço ou book inválido: '+asset);
  const spread=ask/bid-1;
  const disagreement=rel(tickerFirst,tickerSecond);
  const midpoint=(bid+ask)/2;
  const diffBook=rel(tickerSecond,midpoint),diffMinute=rel(tickerSecond,minuteClose);
  if(disagreement>0.004||diffBook>0.006||diffMinute>0.025||spread>0.01||
      minuteAgeMs<0||minuteAgeMs>180000)
    throw Error('Cotação não confirmada de '+asset+
      ' (duas leituras '+(100*disagreement).toFixed(2)+'%, book '+(100*diffBook).toFixed(2)+
      '%, 1m '+(100*diffMinute).toFixed(2)+'%). Sem ordem simulada.');
  const gapFromFourHour=100*(tickerSecond/lastFourHourClose-1);
  return {price:tickerSecond,detail:{tickerFirst,tickerSecond,bid,ask,minuteClose,
    minuteAgeMs,validated:true,gapFromFourHourPct:Number(gapFromFourHour.toFixed(3)),
    notableMove:Math.abs(gapFromFourHour)>12}};
}
async function readProvider(base){
  const bars=await Promise.all(ASSETS.map(async asset=>{
    const rows=await fetchJson(base+'/api/v3/klines?symbol='+asset+
      'USDT&interval=4h&limit=160');
    if(!Array.isArray(rows)||rows.length<110)throw Error('Histórico 4h insuficiente: '+asset);
    return [asset,rows];
  }));
  const nowMs=Date.now();
  const records=Object.fromEntries(bars.map(([asset,rows])=>
    [asset,rows.filter(r=>Number(r[6])<=nowMs-120000)
      .map(r=>({t:Number(r[0]),c:Number(r[4])}))]));
  const common=new Set(records.BTC.map(r=>r.t));
  for(const asset of ASSETS.slice(1)){
    const other=new Set(records[asset].map(r=>r.t));
    for(const time of [...common])if(!other.has(time))common.delete(time);
  }
  const times=[...common].sort((x,y)=>x-y).slice(-120);
  if(times.length<110)throw Error('Candles não alinham');
  for(let i=1;i<times.length;i++)
    if(times[i]-times[i-1]!==BAR_MS)throw Error('Há lacuna de candles');
  const latest=times.at(-1),delay=nowMs-(latest+BAR_MS);
  if(delay<120000)throw Error('Candle ainda sem 2 min de confirmação');
  if(delay>BAR_MS*2)throw Error('Feed histórico mais antigo que 8h');
  const candles={};
  for(const asset of ASSETS){
    const dict=new Map(records[asset].map(row=>[row.t,row]));
    candles[asset]=times.map(t=>dict.get(t));
    if(candles[asset].some(x=>!positive(x.c)))throw Error('Preço de candle inválido: '+asset);
  }
  const results=await Promise.all(ASSETS.map(async asset=>
    [asset,await quoteWithCrossCheck(base,asset,candles[asset].at(-1).c)]));
  const quotes={},quality={source:base,perAsset:{}};
  for(const [asset,value] of results){
    quotes[asset]=value.price;quality.perAsset[asset]=value.detail;
  }
  return {capturedAtUTC:new Date().toISOString(),candleOpenMs:latest,candles,quotes,quality};
}
async function marketData(){
  const failures=[];
  for(const base of BASES){
    try{return await readProvider(base)}
    catch(e){failures.push(base+': '+String(e.message||e))}
  }
  throw Error('Todas as fontes Binance falharam na validação: '+failures.join(' | '));
}
async function main(){
  const state=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));
  verify(state);
  const market=await marketData();
  const result=runCycle(state,market,{bundleHash:freezeHash()});
  if(!result.changed){
    console.log(JSON.stringify({status:'unchanged',reason:result.reason,
      seq:state.events.at(-1)?.seq||0}));
    return;
  }
  fs.writeFileSync(STATE_FILE,JSON.stringify(state,null,2)+'\n','utf8');
  const e=result.event,a=e.payload.account;
  console.log(JSON.stringify({status:'simulated_event_recorded',seq:e.seq,
    kind:e.type,recordedAtUTC:e.recordedAtUTC,action:e.payload.action?.type||'BASELINE',
    source:market.quality.source,equityVirtual:a.equityVirtual,
    btcVirtual:a.btcBenchmarkVirtual,shadowSignals:e.payload.shadow?.emitted.length||0,
    shadowMatured:e.payload.shadow?.matured.length||0,
    quoteLatencyMinutes:e.payload.latencyMinutes,missing:e.payload.missedCandles}));
}
if(require.main===module){
  main().catch(error=>{
    console.error('V4.1 FAIL CLOSED: registro não gravado. '+(error.stack||error));
    process.exitCode=1;
  });
}
module.exports={main,marketData,readProvider,quoteWithCrossCheck,lastClosedMinute,freezeHash};
