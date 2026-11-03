/* Rotation Lab V4 — GitHub Actions forward-only recorder.
 * Only public Binance Spot API endpoints, no brokerage/API keys, no real trades.
 */
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {runCycle,verify,ASSETS,BAR_MS}=require('./core.js');
const STATE_FILE='v4/state.json';
const BASES=['https://data-api.binance.vision','https://api.binance.com'];
const readJson=()=>JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fetchJson(url,base){
  const resp=await fetch(url,{signal:AbortSignal.timeout(16000),
    headers:{'Accept':'application/json','User-Agent':'Rotation-Lab-V4-Paper-Simulator/1.0'}});
  if(!resp.ok)throw Error(base+' respondeu HTTP '+resp.status);
  const payload=await resp.json();
  if(payload&&payload.code&&payload.msg)throw Error('Binance: '+payload.msg);
  return payload;
}
async function provider(base){
  const raw=await Promise.all(ASSETS.map(async symbol=>{
    const pair=symbol+'USDT';
    const url=base+'/api/v3/klines?symbol='+pair+'&interval=4h&limit=160';
    const data=await fetchJson(url,base);
    if(!Array.isArray(data)||data.length<110)throw Error('Candles insuficientes de '+pair);
    return [symbol,data];
  }));
  const now=Date.now(),delay=120000;
  const rawBy=Object.fromEntries(raw.map(([s,arr])=>
    [s,arr.filter(row=>Number(row[6])<=now-delay)
      .map(row=>({t:Number(row[0]),c:Number(row[4])}))]));
  const ids=new Set(rawBy.BTC.map(r=>r.t));
  for(const s of ASSETS.slice(1)){
    const known=new Set(rawBy[s].map(r=>r.t));
    for(const t of [...ids])if(!known.has(t))ids.delete(t);
  }
  const times=[...ids].sort((a,b)=>a-b).slice(-120);
  if(times.length<110)throw Error('Menos de 110 candles em comum');
  for(let i=1;i<times.length;i++)
    if(times[i]-times[i-1]!==BAR_MS)
      throw Error('Histórico incompleto: há lacunas entre candles');
  const lastMs=times.at(-1);
  if(lastMs+BAR_MS>now-120000)throw Error('Último candle ainda não confirmado');
  if(now-(lastMs+BAR_MS)>BAR_MS*2)throw Error('Histórico muito antigo; não criar operação com dados defasados');
  const byAsset={};
  for(const s of ASSETS){
    const map=new Map(rawBy[s].map(row=>[row.t,row]));
    byAsset[s]=times.map(t=>map.get(t));
  }
  const tickers=await Promise.all(ASSETS.map(async symbol=>{
    const data=await fetchJson(base+'/api/v3/ticker/price?symbol='+symbol+'USDT',base);
    const price=Number(data.price);
    if(!(price>0&&Number.isFinite(price)))throw Error('Ticker inválido: '+symbol);
    return [symbol,price];
  }));
  return {capturedAtUTC:new Date().toISOString(),candleOpenMs:lastMs,
    candles:byAsset,quotes:Object.fromEntries(tickers)};
}
async function getMarket(){
  const errors=[];
  for(const base of BASES){
    try{return await provider(base)}
    catch(e){errors.push(base+': '+e.message)}
  }
  throw Error('Sem dados confiáveis de mercado: '+errors.join(' | '));
}
async function main(){
  const state=readJson();
  verify(state);
  const coreHash=sha256(fs.readFileSync('v4/core.js'));
  const market=await getMarket();
  const result=runCycle(state,market,{coreHash});
  if(result.changed){
    fs.writeFileSync(STATE_FILE,JSON.stringify(state,null,2)+'\n','utf8');
    const account=result.event.payload.account;
    console.log(JSON.stringify({status:'committed_locally',event:result.event.seq,
      kind:result.event.type,recordedAtUTC:result.event.recordedAtUTC,
      candleUTC:new Date(result.event.candleOpenMs).toISOString(),
      action:result.event.payload.action?.type||'BASELINE',
      portfolioVirtual:account.equityVirtual,
      btcBenchmarkVirtual:account.btcBenchmarkVirtual,
      cashBenchmarkVirtual:account.cashBenchmarkVirtual}));
  }else{
    console.log(JSON.stringify({status:'unchanged',reason:result.reason,
      lastEvent:state.events.at(-1)?.seq||0}));
  }
}
main().catch(err=>{
  console.error('V4 fail-closed: nenhum estado deve ser publicado neste ciclo.');
  console.error(err.stack||String(err));
  process.exitCode=1;
});
