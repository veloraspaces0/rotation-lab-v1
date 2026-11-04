/* Rotation Lab Analytics: testes locais, sem API/ordens reais. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const A=require('./engine.js'),BASE=Date.UTC(2026,10,4,0),BAR=A.BAR_MS;
const config={initialCapitalVirtual:50,feePctPerSide:.1,slippagePctPerSide:.05};
const close=(n,asset)=>100+A.ASSETS.indexOf(asset)*20+n*.25;
function event(n,seq,options={}){
 const t=BASE+n*BAR,N=options.length||120,first=t-(N-1)*BAR;
 const quotes=Object.fromEntries(A.ASSETS.map(s=>[s,close(n,s)]));
 const indicators=Object.fromEntries(A.ASSETS.map(s=>[s,{closeHistory:
  Array.from({length:N},(_,i)=>close(n-N+1+i,s))}]));
 const emitted=A.ASSETS.map((s,i)=>({asset:s,close:close(n,s),eligible:i<2,score:5-i}));
 const payload={quotes,account:{equityVirtual:50,btcBenchmarkVirtual:49.8501125},
  inputSnapshot:{firstCandleUTC:new Date(first).toISOString(),
   lastCandleUTC:new Date(t).toISOString(),indicators},
  missedCandles:options.missing||0,
  candidate:{asset:options.selected||'BTC'}};
 if(options.shadow)payload.shadow={emitted,matured:options.native||[]};
 return {seq,type:seq===1?'BASELINE':'EVALUATION',candleOpenMs:t,
  recordedAtUTC:new Date(t+BAR+60000).toISOString(),payload};
}
const mk=(...events)=>({schema:1,config:{...config},events});
test('Baseline apenas: sem sinais artificiais',()=>{
 const x=A.reconstruct(mk(event(0,1)));
 assert.equal(x.rows.length,0);assert.equal(x.missingCandles,0);
 assert.equal(A.summarize(x,6).allMean,null);
});
test('Antes de maturação todas as observações são pendentes',()=>{
 const x=A.reconstruct(mk(event(0,1),event(1,2,{shadow:true})));
 assert.equal(x.rows.length,20);assert.ok(x.rows.every(r=>r.result==='pending'));
});
test('Maturação usa fechamento observado e nunca preços futuros',()=>{
 const x=A.reconstruct(mk(event(0,1),event(1,2,{shadow:true}),event(2,3)));
 assert.equal(x.rows.filter(r=>r.horizonBars===1&&r.recovered).length,5);
 assert.equal(x.rows.filter(r=>r.horizonBars===3&&r.result==='pending').length,5);
});
test('Candle perdido: recuperação usa apenas preço histórico real posterior',()=>{
 const s=mk(event(0,1),event(1,2,{shadow:true}),event(3,3,{missing:1}));
 const x=A.reconstruct(s),one=x.rows.filter(r=>r.horizonBars===1);
 assert.equal(s.events.length,3);assert.equal(x.missingCandles,1);
 assert.ok(one.every(r=>r.recovered&&r.sourceSeq===3&&r.targetMs===BASE+2*BAR));
});
test('Histórico insuficiente: marcar indisponível, jamais inventar',()=>{
 const x=A.reconstruct(mk(event(0,1),event(1,2,{shadow:true}),
    event(130,3,{missing:128,length:120})));
 assert.equal(x.rows.filter(r=>r.horizonBars===1&&r.result==='unavailable').length,5);
 assert.equal(x.unavailable,15);
 assert.equal(x.rows.filter(r=>r.horizonBars===12&&r.recovered).length,5);
});
test('Sinais elegíveis são diferentes do candidato selecionado',()=>{
 const x=A.reconstruct(mk(event(0,1),event(1,2,{shadow:true,selected:'ETH'}),event(2,3)));
 const r=x.rows.filter(o=>o.horizonBars===1);
 assert.equal(r.filter(o=>o.eligible).length,2);
 assert.deepEqual(r.filter(o=>o.selected).map(o=>o.asset),['ETH']);
});
test('Compara moedas em pares no mesmo candle, sem fingir observações independentes',()=>{
 const x=A.reconstruct(mk(event(0,1),event(1,2,{shadow:true}),event(2,3)));
 const s=A.summarize(x,1);
 assert.equal(s.records,5);assert.equal(s.eligibleCount,2);
 assert.equal(s.selectedCount,1);assert.equal(s.eligibleCI.origins,1);
 assert.equal(s.eligibleCI.ci,null);assert.ok(Number.isFinite(s.deltaEligible));
});
test('Bootstrap em blocos reprodutível e insuficiência explícita',()=>{
 const samples=Array.from({length:40},(_,i)=>({originMs:BASE+i*BAR*6,delta:1+i*.01}));
 const a=A.blockInterval(samples,6),b=A.blockInterval(samples,6);
 assert.deepEqual(a,b);assert.ok(a.ci&&a.ci[0]>0&&a.ci[1]>a.ci[0]);
 assert.equal(A.blockInterval(samples.slice(0,4),6).ci,null);
});
test('Benchmarks marcados não cobram saída; liquidados cobram duas pontas',()=>{
 const b=A.benchmarks(mk(event(0,1)))[0],c=.0015;
 assert.ok(Math.abs(b.btcMarked-50*(1-c))<1e-9);
 assert.ok(Math.abs(b.btcLiquidated-50*(1-c)**2)<1e-9);
 assert.ok(b.btc65Marked>b.btc65Liquidated);
 assert.ok(b.equalMarked>b.equalLiquidated);
});
test('A pesquisa não altera a cópia original de state',()=>{
 const s=mk(event(0,1),event(1,2,{shadow:true}),event(3,3,{missing:1}));
 const before=JSON.stringify(s);A.reconstruct(s);A.benchmarks(s);
 assert.equal(JSON.stringify(s),before);
});
test('SHA-256 verifica cadeia e rejeita adulteração',async()=>{
 const e=event(0,1);e.prevHash='GENESIS';
 const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
 e.hash=digest(JSON.stringify({seq:e.seq,prevHash:e.prevHash,type:e.type,
  recordedAtUTC:e.recordedAtUTC,candleOpenMs:e.candleOpenMs,payload:e.payload}));
 const s=mk(e);await A.verifyChain(s,digest);
 s.events[0].payload.account.equityVirtual=999;
 await assert.rejects(()=>A.verifyChain(s,digest),/SHA-256/);
});

// V1.1 risk: synthetic paper-only events, with no real brokerage orders.
function riskEvent(bar,seq,equity,peak,halted=false){
 const e=event(bar,seq);
 e.payload.account={...e.payload.account,equityVirtual:equity,peakEquity:peak,
    hardHalt:halted,closedTrades:0};
 return e;
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,
  'expected '+expected+', received '+actual);
test('V1.1 risk: BASELINE does not fabricate closed trades or trigger halt',()=>{
 const s=mk(riskEvent(0,1,50,50)),d=A.portfolioRisk(s),t=A.tradeStatistics(s);
 assert.equal(d.halted,false);assert.equal(d.currentDrawdownPct,0);
 assert.equal(d.currentUnderwaterBars,0);assert.equal(t.closed,0);
 assert.equal(t.winRatePct,null);assert.equal(t.expectancyPct,null);
});
test('V1.1 risk: underwater consecutive observations and recovered peak',()=>{
 const s=mk(riskEvent(0,1,50,50),riskEvent(1,2,49,50),
   riskEvent(2,3,48,50),riskEvent(3,4,50,50),
   riskEvent(4,5,47,50),riskEvent(5,6,46,50));
 const d=A.portfolioRisk(s);
 assert.equal(d.underwaterObservedBars,4);assert.equal(d.currentUnderwaterBars,2);
 assert.equal(d.longestUnderwaterBars,2);near(d.currentDrawdownPct,8);
 near(d.maxObservedDrawdownPct,8);assert.equal(d.unobservedBars,0);
});
test('V1.1 risk: missing candles are not claimed as observed drawdown time',()=>{
 const s=mk(riskEvent(0,1,50,50),riskEvent(1,2,48,50),riskEvent(4,3,47,50));
 const d=A.portfolioRisk(s);
 assert.equal(d.currentUnderwaterBars,1);
 assert.equal(d.longestUnderwaterBars,1);
 assert.equal(d.unobservedBars,2);
 assert.equal(d.underwaterObservedBars,2);
});
test('V1.1 risk: first halt retained even as shadow observations continue',()=>{
 const s=mk(riskEvent(0,1,50,50),riskEvent(1,2,46.5,50,true),
    riskEvent(2,3,46.5,50,true));
 s.events[1].payload.action={type:'SELL_CIRCUIT'};
 s.events[2].payload.shadow={emitted:[],matured:[]};
 const d=A.portfolioRisk(s);
 assert.equal(d.halted,true);assert.equal(d.firstHaltSeq,2);
 assert.equal(d.shadowEventsAfterHalt,1);
 assert.equal(d.firstHaltAtUTC,s.events[1].recordedAtUTC);
});
test('V1.1 trades: wins losses payoff and expectancy calculated on closed trades',()=>{
 const a=riskEvent(0,1,50,50),b=riskEvent(1,2,50.65,50.65),c=riskEvent(2,3,49.15,50.65);
 b.payload.action={type:'SELL_TARGET',netReturnPct:2,investedVirtual:32.5,realizedPnlVirtual:.65};
 c.payload.action={type:'SELL_STOP',netReturnPct:-5,investedVirtual:30,realizedPnlVirtual:-1.5};
 b.payload.account.closedTrades=1;c.payload.account.closedTrades=2;
 const t=A.tradeStatistics(mk(a,b,c));
 assert.equal(t.closed,2);assert.equal(t.winners,1);assert.equal(t.losers,1);
 assert.equal(t.winRatePct,50);assert.equal(t.averageWinPct,2);
 assert.equal(t.averageLossPct,-5);near(t.payoff,.4);
 near(t.expectancyPct,-1.5);near(t.totalRealizedPnLVirtual,-.85);
 assert.equal(t.differenceFromAccount,0);
});
test('V1.1 trades: no losing trades means undefined payoff, not Infinity',()=>{
 const s=mk(riskEvent(0,1,50,50),riskEvent(1,2,51,51));
 s.events[1].payload.action={type:'SELL_TARGET',netReturnPct:2,investedVirtual:50,realizedPnlVirtual:1};
 s.events[1].payload.account.closedTrades=1;
 const t=A.tradeStatistics(s);
 assert.equal(t.winRatePct,100);assert.equal(t.payoff,null);
 assert.equal(t.profitFactor,null);assert.equal(t.averageLossPct,null);
});
test('V1.1 trades: malformed closure excluded and discrepancy disclosed',()=>{
 const s=mk(riskEvent(0,1,50,50),riskEvent(1,2,49,50));
 s.events[1].payload.action={type:'SELL_STOP',realizedPnlVirtual:-1,investedVirtual:30};
 s.events[1].payload.account.closedTrades=1;
 const t=A.tradeStatistics(s);
 assert.equal(t.closed,0);assert.equal(t.malformed,1);
 assert.equal(t.differenceFromAccount,1);
});
test('V1.1 thresholds: illustrative break-even win rates, not a prediction',()=>{
 const c=A.riskRewardConfig({...config,takeProfit:.02,minimumStop:.025,maximumStop:.05});
 near(c.breakEvenAtMinimumStopPct,55.55555555555556);
 near(c.breakEvenAtMaximumStopPct,71.42857142857142);
 assert.match(c.disclaimer,/teórico/);
});
test('V1.1 analytics is read-only for all three new functions',()=>{
 const s=mk(riskEvent(0,1,50,50),riskEvent(1,2,47,50)),before=JSON.stringify(s);
 A.portfolioRisk(s);A.tradeStatistics(s);A.riskRewardConfig(s.config);
 assert.equal(JSON.stringify(s),before);
});
