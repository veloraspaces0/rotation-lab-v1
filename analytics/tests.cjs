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
