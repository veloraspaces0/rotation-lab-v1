/* Rotation Lab V4.1: regression and adversarial tests. Run with node --test v4-1/tests.cjs */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const core=require('./core.js');
const runner=require('./runner.cjs');
const {ASSETS,BAR_MS}=core;
const start=Date.UTC(2026,10,4,0);
const baselineConfig=JSON.parse(fs.readFileSync('v4-1/state.json','utf8')).config;
function market(offset=0,lagMinutes=23){
  const t=start+offset*BAR_MS;
  const candles={},quotes={},perAsset={};
  for(const [index,s] of ASSETS.entries()){
    candles[s]=Array.from({length:120},(_,i)=>{
      const price=100*Math.exp((i+offset)*(.003+index*.0001));
      return {t:t-(119-i)*BAR_MS,c:price};
    });
    const price=candles[s].at(-1).c*1.0005;
    quotes[s]=price;
    perAsset[s]={tickerFirst:price,tickerSecond:price,bid:price*.9997,ask:price*1.0003,
      minuteClose:price,minuteAgeMs:42000,validated:true};
  }
  return {candleOpenMs:t,capturedAtUTC:new Date(t+BAR_MS+lagMinutes*60000).toISOString(),
    candles,quotes,quality:{source:'SYNTHETIC TEST',perAsset}};
}
function state(){return {schema:1,config:{...baselineConfig},events:[]}}
function apply(s,m){return core.runCycle(s,m,{bundleHash:'test-frozen-bundle-hash'})}
test('Primeiro ciclo cria BASELINE sem compras retroativas',()=>{
 const s=state();apply(s,market());
 assert.equal(s.events.length,1);
 assert.equal(s.events[0].type,'BASELINE');
 assert.equal(s.events[0].payload.account.position,null);
 assert.equal(s.events[0].payload.account.equityVirtual,50);
 assert.equal(s.events[0].payload.inputSnapshot.indicators.BTC.closeHistory.length,120);
 assert.ok(core.verify(s));
});
test('Mesmo candle não duplica registros; candle seguinte cria EVALUATION',()=>{
 const s=state();apply(s,market());
 assert.equal(apply(s,market()).changed,false);
 const next=apply(s,market(1));
 assert.equal(next.changed,true);
 assert.equal(s.events.length,2);
 assert.equal(s.events[1].payload.shadow.emitted.length,5);
 assert.ok(s.events[1].payload.action.type);
 assert.ok(core.verify(s));
});
test('Registro-sombra amadurece só depois de 1,3,6,12 candles sem usar o futuro',()=>{
 const s=state();for(let i=0;i<=14;i++)apply(s,market(i));
 assert.equal(s.events.length,15);
 const e1=s.events.find(e=>e.seq===3);
 assert.equal(e1.payload.shadow.matured.length,5);
 const e12=s.events.at(-1);
 const h12=e12.payload.shadow.matured.filter(x=>x.horizonBars===12);
 assert.equal(h12.length,5);
 assert.ok(h12.every(x=>Number.isFinite(x.theoreticalNetPct)));
 assert.ok(core.verify(s));
});
test('Bloqueia BUY após mais de 90 minutos, mas registra sinais-sombra',()=>{
 const s=state();apply(s,market());
 const e=apply(s,market(1,111)).event;
 assert.equal(e.payload.action.type,'SKIP_STALE');
 assert.equal(e.payload.shadow.emitted.length,5);
 assert.equal(e.payload.account.position,null);
});
test('Tolerância de 90min é aplicada à compra mesmo com tendência positiva',()=>{
 const s=state();apply(s,market());
 const e=apply(s,market(1,23)).event;
 assert.equal(e.payload.action.type,'BUY');
 assert.ok(e.payload.account.position);
});
test('Faltas de candle ficam explícitas, sem fabricar trades retroativos',()=>{
 const s=state();apply(s,market());
 const r=apply(s,market(3)).event;
 assert.equal(r.payload.missedCandles,2);
 assert.equal(s.events.length,2);
 assert.equal(r.payload.shadow.matured.length,0);
});
test('Preço sem qualidade confirmada não gera evento',()=>{
 const s=state(),m=market();m.quality.perAsset.BTC.validated=false;
 assert.throws(()=>apply(s,m),/validação cruzada/);
 assert.equal(s.events.length,0);
});
test('Cotação anômala com book normal é rejeitada',()=>{
 const s=state(),m=market();m.quotes.SOL*=1.08;
 m.quality.perAsset.SOL.tickerFirst=m.quotes.SOL;
 m.quality.perAsset.SOL.tickerSecond=m.quotes.SOL;
 assert.throws(()=>apply(s,m),/inconsistente/);
 assert.equal(s.events.length,0);
});
test('Cotações cruzadas inválidas também são rejeitadas em queda',()=>{
 const s=state(),m=market();m.quality.perAsset.ETH.minuteClose*=1.12;
 assert.throws(()=>apply(s,m),/inconsistente/);
});
test('Fuga de informação: candles futuros não são usados em um sinal emitido',()=>{
 const a=market(1),b=market(1);
 for(const asset of ASSETS){
   b.candles[asset].push({t:b.candleOpenMs+BAR_MS,c:1e9});
 }
 assert.throws(()=>core.runCycle(state(),b,{bundleHash:'x'}),/horários desalinhados|Snapshot inconsistente|Série histórica incompleta/);
 const s=state();apply(s,market());
 const r=apply(s,a).event;
 assert.equal(r.payload.inputSnapshot.lastCandleUTC,new Date(a.candleOpenMs).toISOString());
});
test('Mudança de configuração ou núcleo é bloqueada após baseline',()=>{
 const s=state();apply(s,market());
 s.config.takeProfit=.99;
 assert.throws(()=>apply(s,market(1)),/Configuração modificada/);
 s.config.takeProfit=baselineConfig.takeProfit;
 assert.throws(()=>core.runCycle(s,market(1),{bundleHash:'modified'}),/motor da estratégia mudou/);
});
test('Alterações silenciosas em eventos são detectadas no SHA-256',()=>{
 const s=state();apply(s,market());apply(s,market(1));
 s.events[1].payload.account.cash=999;
 assert.throws(()=>core.verify(s),/Integridade/);
});
test('Filtro de saída não trata preço acima da média como tendência ruim',()=>{
 const m=market(),data=m.candles,last=data.BTC.length-1,c=baselineConfig;
 const p=data.SOL[last].c;
 data.SOL[last].c=p*1.07;
 assert.equal(core.coinOK(data,'SOL',last,c),false);
 assert.equal(core.coinExitHealthy(data,'SOL',last,c),true);
});
test('Orçamento virtual interno não autoriza ordens reais',()=>{
 const source=fs.readFileSync('v4-1/runner.cjs','utf8');
 assert.ok(!source.includes('/api/v3/order'));
 assert.ok(!source.includes('X-MBX-APIKEY'));
 assert.ok(!source.includes('PRIVATE_KEY'));
});
test('Cotação cruzada: dois tickers, bookTicker e candle 1m',async t=>{
 const original=global.fetch,now=Date.now();
 t.after(()=>{global.fetch=original});
 global.fetch=async url=>{
   const href=String(url);
   let payload;
   if(href.includes('ticker/bookTicker'))payload={bidPrice:'99.98',askPrice:'100.02'};
   else if(href.includes('ticker/price'))payload={price:'100'};
   else if(href.includes('interval=1m'))payload=[
     [now-120000,0,0,0,100,0,now-60001],
     [now-60000,0,0,0,100,0,now-1]
   ];
   else throw Error('Unexpected fetch '+url);
   return {ok:true,json:async()=>payload};
 };
 const validated=await runner.quoteWithCrossCheck('https://mock.binance.local','BTC',100);
 assert.equal(validated.price,100);
 assert.equal(validated.detail.validated,true);
});
test('Ticker absurdamente inconsistente falha no runner',async t=>{
 const original=global.fetch,now=Date.now();
 t.after(()=>{global.fetch=original});
 global.fetch=async url=>{
   const href=String(url);
   let payload;
   if(href.includes('ticker/bookTicker'))payload={bidPrice:'99.98',askPrice:'100.02'};
   else if(href.includes('ticker/price'))payload={price:'109'};
   else if(href.includes('interval=1m'))payload=[
     [now-120000,0,0,0,100,0,now-60001]
   ];
   return {ok:true,json:async()=>payload};
 };
 await assert.rejects(()=>runner.quoteWithCrossCheck('https://mock.binance.local','BTC',100),/não confirmada/);
});
