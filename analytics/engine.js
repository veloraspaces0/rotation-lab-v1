/* Rotation Lab Analytics V1 — separate read-only research module.
 * Does not modify V4.1 strategy, workflow, market data, or event history.
 * Only uses closes already present in signed prospective snapshots.
 */
(function (root, make) {
  const api=make();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.RotationLabAnalytics=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const ASSETS=['BTC','ETH','SOL','BNB','XRP'],HORIZONS=[1,3,6,12],BAR_MS=4*3600000;
const avg=arr=>arr.length?arr.reduce((sum,x)=>sum+x,0)/arr.length:null;
const clean=n=>Number.isFinite(n)?n:null;
const round=(n,places=5)=>Number(n.toFixed(places));
const requireNumeric=n=>Number.isFinite(n)&&n>0;
function estimatedCost(config){
  return (Number(config.feePctPerSide)+Number(config.slippagePctPerSide))/100;
}
function makePriceIndex(events){
  const prices=new Map(ASSETS.map(asset=>[asset,new Map()]));
  const ordered=[...events].sort((a,b)=>a.candleOpenMs-b.candleOpenMs);
  for(const ev of ordered){
    const snap=ev.payload?.inputSnapshot;
    if(!snap)continue;
    const first=Date.parse(snap.firstCandleUTC);
    const observed=Date.parse(ev.recordedAtUTC);
    if(!Number.isFinite(first)||!Number.isFinite(observed))continue;
    for(const asset of ASSETS){
      const closes=snap.indicators?.[asset]?.closeHistory;
      if(!Array.isArray(closes))continue;
      const index=prices.get(asset);
      for(let k=0;k<closes.length;k++){
        const candle=first+k*BAR_MS,price=Number(closes[k]);
        // A snapshot is evidence only for candles already closed when captured.
        if(candle>ev.candleOpenMs||observed<candle+BAR_MS||
           !requireNumeric(price)||index.has(candle))continue;
        index.set(candle,{close:price,firstObservedCandleMs:ev.candleOpenMs,
          availableAtUTC:ev.recordedAtUTC,sourceSeq:ev.seq});
      }
    }
  }
  return prices;
}
function makeNativeIndex(events){
  const index=new Map();
  for(const ev of events){
    for(const r of ev.payload?.shadow?.matured||[]){
      if(!ASSETS.includes(r.asset)||!HORIZONS.includes(r.horizonBars))continue;
      const key=r.originSeq+'|'+r.asset+'|'+r.horizonBars;
      if(!index.has(key))index.set(key,r);
    }
  }
  return index;
}
function selectedFromEvent(e,emitted){
  const eligible=emitted.filter(s=>s.eligible);
  if(!eligible.length)return null;
  const native=e.payload?.candidate?.asset;
  if(eligible.some(x=>x.asset===native))return native;
  eligible.sort((a,b)=>{
    const d=(Number(b.score)||0)-(Number(a.score)||0);
    return d||ASSETS.indexOf(a.asset)-ASSETS.indexOf(b.asset);
  });
  return eligible[0].asset;
}
function reconstruct(state){
  const events=[...(state?.events||[])].sort((a,b)=>a.candleOpenMs-b.candleOpenMs);
  const priceIndex=makePriceIndex(events),native=makeNativeIndex(events);
  const rows=[],maxCandle=events.at(-1)?.candleOpenMs??-Infinity;
  const c=estimatedCost(state.config||{});
  let missingCandles=0,selectedOrigins=0,emittedSignals=0;
  for(const e of events){
    missingCandles+=Math.max(0,Number(e.payload?.missedCandles)||0);
    const emissions=e.payload?.shadow?.emitted;
    if(!Array.isArray(emissions))continue; // BASELINE has no trade signals.
    const valid=emissions.filter(x=>ASSETS.includes(x.asset)&&requireNumeric(Number(x.close)));
    emittedSignals+=valid.length;
    const selected=selectedFromEvent(e,valid);
    if(selected)selectedOrigins++;
    for(const s of valid){
      for(const h of HORIZONS){
        const targetTime=e.candleOpenMs+h*BAR_MS;
        const p=priceIndex.get(s.asset)?.get(targetTime);
        const matured=targetTime<=maxCandle&&!!p;
        const pending=targetTime>maxCandle;
        const original=native.get(e.seq+'|'+s.asset+'|'+h);
        const recovered=matured&&!original;
        const gross=matured?100*(p.close/Number(s.close)-1):null;
        const net=matured?100*((p.close/Number(s.close))*(1-c)*(1-c)-1):null;
        rows.push({asset:s.asset,originSeq:e.seq,originMs:e.candleOpenMs,
          targetMs:targetTime,horizonBars:h,selected:s.asset===selected,
          eligible:!!s.eligible,sourceClose:Number(s.close),targetClose:p?.close??null,
          result:pending?'pending':!matured?'unavailable':recovered?'recovered':'recorded',
          recovered,availableAtUTC:p?.availableAtUTC||null,sourceSeq:p?.sourceSeq||null,
          grossPct:clean(gross),netPct:clean(net),
          nativeMismatch:!!(original&&matured&&Math.abs(Number(original.theoreticalNetPct)-net)>.0002)});
      }
    }
  }
  return {rows,events:events.length,originCandles:events.filter(e=>e.payload?.shadow?.emitted).length,
    emittedSignals,selectedOrigins,missingCandles,
    recovered:rows.filter(x=>x.recovered).length,
    pending:rows.filter(x=>x.result==='pending').length,
    unavailable:rows.filter(x=>x.result==='unavailable').length,
    mismatches:rows.filter(x=>x.nativeMismatch).length};
}
function blockInterval(samples,h,seed=7,replicates=1000){
  // Resample entire calendar blocks, not 5 correlated assets or individual trades.
  if(!samples.length)return {ci:null,blocks:0,origins:0,blockBars:Math.max(12,2*h)};
  const blockBars=Math.max(12,2*h);
  const start=Math.min(...samples.map(s=>s.originMs));
  const byBlock=new Map();
  for(const sample of samples){
    const id=Math.floor((sample.originMs-start)/(blockBars*BAR_MS));
    if(!byBlock.has(id))byBlock.set(id,[]);
    byBlock.get(id).push(sample.delta);
  }
  const blocks=[...byBlock.values()];
  const n=blocks.length;
  if(n<8||samples.length<20)return {ci:null,blocks:n,origins:samples.length,blockBars};
  let x=(seed>>>0)||1;
  const rand=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296};
  const values=[];
  for(let b=0;b<replicates;b++){
    let total=0,count=0;
    for(let j=0;j<n;j++){
      const group=blocks[Math.floor(rand()*n)];
      for(const delta of group){total+=delta;count++}
    }
    if(count)values.push(total/count);
  }
  values.sort((a,b)=>a-b);
  const idx=p=>Math.min(values.length-1,Math.max(0,Math.floor(p*(values.length-1))));
  return {ci:values.length?[round(values[idx(.05)]),round(values[idx(.95)])]:null,
    blocks:n,origins:samples.length,blockBars};
}
function summarize(research,h){
  const data=research.rows.filter(r=>r.horizonBars===h);
  const done=data.filter(r=>Number.isFinite(r.netPct));
  const eligible=done.filter(r=>r.eligible);
  const selected=done.filter(r=>r.selected);
  const byOrigin=new Map();
  for(const r of done){
    if(!byOrigin.has(r.originMs))byOrigin.set(r.originMs,[]);
    byOrigin.get(r.originMs).push(r);
  }
  const pairedEligible=[],pairedSelected=[];
  for(const [time,group] of byOrigin){
    if(group.length!==ASSETS.length||new Set(group.map(x=>x.asset)).size!==ASSETS.length)continue;
    const all=avg(group.map(x=>x.netPct));
    const elig=group.filter(x=>x.eligible),sel=group.filter(x=>x.selected);
    if(elig.length)pairedEligible.push({originMs:time,delta:avg(elig.map(x=>x.netPct))-all});
    if(sel.length)pairedSelected.push({originMs:time,delta:sel[0].netPct-all});
  }
  const eligibleCI=blockInterval(pairedEligible,h,0x735519+h);
  const selectedCI=blockInterval(pairedSelected,h,0xabb673+h);
  return {horizonBars:h,records:done.length,
    eligibleCount:eligible.length,selectedCount:selected.length,
    allMean:clean(avg(done.map(x=>x.netPct))),
    eligibleMean:clean(avg(eligible.map(x=>x.netPct))),
    selectedMean:clean(avg(selected.map(x=>x.netPct))),
    deltaEligible:clean(avg(pairedEligible.map(x=>x.delta))),
    deltaSelected:clean(avg(pairedSelected.map(x=>x.delta))),
    eligibleCI,selectedCI,
    missing:data.filter(x=>x.result==='unavailable').length,
    pending:data.filter(x=>x.result==='pending').length,
    recovered:data.filter(x=>x.recovered).length,
    nativeMismatch:data.filter(x=>x.nativeMismatch).length,
    completeOrigins:byOrigin.size};
}
function benchmarks(state){
  const events=state?.events||[],cfg=state?.config||{};
  if(!events.length)return[];
  const initial=Number(cfg.initialCapitalVirtual),cost=estimatedCost(cfg);
  const baseline=events[0].payload?.quotes||{};
  if(!ASSETS.every(s=>requireNumeric(Number(baseline[s]))))return[];
  return events.map(e=>{
    const q=e.payload?.quotes||{};
    if(!ASSETS.every(s=>requireNumeric(Number(q[s]))))return null;
    const ratio=s=>q[s]/baseline[s],mix=avg(ASSETS.map(ratio));
    const btcMarked=initial*(1-cost)*ratio('BTC');
    const btcLiquidated=btcMarked*(1-cost);
    const btc65Marked=initial*(.35+.65*(1-cost)*ratio('BTC'));
    const btc65Liquidated=initial*(.35+.65*(1-cost)*(1-cost)*ratio('BTC'));
    const equalMarked=initial*(1-cost)*mix;
    const equalLiquidated=equalMarked*(1-cost);
    return {atUTC:e.recordedAtUTC,candleMs:e.candleOpenMs,
      strategy:e.payload.account?.equityVirtual??null,
      cash:initial,btcMarked,btcLiquidated,
      btc65Marked,btc65Liquidated,equalMarked,equalLiquidated,
      originalBtc:e.payload.account?.btcBenchmarkVirtual??null};
  }).filter(Boolean);
}

/* Portfolio-risk snapshot metrics (informational, no retroactive trade simulation).
 * A skipped candle is an observation gap, not proof the portfolio stayed
 * underwater through that period.
 */
function portfolioRisk(state){
  const events=state?.events||[];
  let currentStreak=0,longestStreak=0,underwaterObserved=0,unobservedBars=0;
  let maxDrawdownPct=0,previous=null,firstHalt=null,last=null;
  for(const e of events){
    const account=e.payload?.account;
    if(!account)continue;
    if(!firstHalt&&(account.hardHalt===true||
      ['HALT','SELL_CIRCUIT'].includes(e.payload?.action?.type)))firstHalt=e;
    const equity=Number(account.equityVirtual),peak=Number(account.peakEquity);
    const valid=Number.isFinite(equity)&&Number.isFinite(peak)&&peak>0&&equity>=0;
    if(!valid)continue;
    const skipped=previous?Math.max(0,Math.floor(
      (e.candleOpenMs-previous.candleOpenMs)/BAR_MS)-1):0;
    unobservedBars+=skipped;
    const drawdownPct=Math.max(0,100*(1-equity/peak));
    maxDrawdownPct=Math.max(maxDrawdownPct,drawdownPct);
    const underwater=drawdownPct>1e-7;
    if(underwater){
      underwaterObserved++;
      currentStreak=previous&&skipped===0&&previous.underwater?currentStreak+1:1;
    }else currentStreak=0;
    longestStreak=Math.max(longestStreak,currentStreak);
    last={e,account,equity,peak,drawdownPct};
    previous={candleOpenMs:e.candleOpenMs,underwater};
  }
  const account=events.at(-1)?.payload?.account;
  return {hasSamples:!!last,
    halted:account?.hardHalt===true,
    firstHaltSeq:firstHalt?.seq??null,
    firstHaltAtUTC:firstHalt?.recordedAtUTC??null,
    currentEquity:clean(last?.equity),
    peakEquity:clean(last?.peak),
    currentDrawdownPct:clean(last?.drawdownPct),
    maxObservedDrawdownPct:last?maxDrawdownPct:null,
    currentUnderwaterBars:last?currentStreak:0,
    longestUnderwaterBars:longestStreak,
    underwaterObservedBars:underwaterObserved,
    unobservedBars,
    // Continued emissions are an observed count, not a guarantee of future activity.
    shadowEventsAfterHalt:firstHalt?events.filter(
      e=>e.seq>firstHalt.seq&&Array.isArray(e.payload?.shadow?.emitted)).length:0};
}
/* Only realized, closed virtual trades. Percentage is return on
 * investedVirtual, not on total portfolio equity.
 */
function tradeStatistics(state){
  const events=state?.events||[],trades=[];
  let malformed=0;
  for(const e of events){
    const action=e.payload?.action;
    if(typeof action?.type!=='string'||!action.type.startsWith('SELL_'))continue;
    const pct=Number(action.netReturnPct),pnl=Number(action.realizedPnlVirtual);
    const capital=Number(action.investedVirtual);
    if(!Number.isFinite(pct)||!Number.isFinite(pnl)||
       !Number.isFinite(capital)||capital<=0){malformed++;continue}
    trades.push({seq:e.seq,atUTC:e.recordedAtUTC,asset:action.asset,
      type:action.type,netReturnPct:pct,realizedPnlVirtual:pnl,
      investedVirtual:capital});
  }
  const winners=trades.filter(t=>t.realizedPnlVirtual>0);
  const losers=trades.filter(t=>t.realizedPnlVirtual<0);
  const flat=trades.length-winners.length-losers.length;
  const meanWin=avg(winners.map(t=>t.netReturnPct));
  const meanLoss=avg(losers.map(t=>t.netReturnPct));
  const gain=winners.reduce((s,t)=>s+t.realizedPnlVirtual,0);
  const loss=losers.reduce((s,t)=>s+Math.abs(t.realizedPnlVirtual),0);
  const reported=events.at(-1)?.payload?.account?.closedTrades;
  return {closed:trades.length,winners:winners.length,losers:losers.length,
    flat,malformed,reportedClosed:Number.isInteger(reported)?reported:null,
    differenceFromAccount:Number.isInteger(reported)?reported-trades.length:null,
    winRatePct:trades.length?100*winners.length/trades.length:null,
    averageWinPct:clean(meanWin),averageLossPct:clean(meanLoss),
    payoff:meanWin!=null&&meanLoss!=null&&meanLoss<0?meanWin/(-meanLoss):null,
    expectancyPct:clean(avg(trades.map(t=>t.netReturnPct))),
    expectancyVirtual:clean(avg(trades.map(t=>t.realizedPnlVirtual))),
    totalRealizedPnLVirtual:trades.reduce((s,t)=>s+t.realizedPnlVirtual,0),
    profitFactor:loss>0?gain/loss:null,
    insufficientSample:trades.length<30,trades};
}
function riskRewardConfig(config){
  const target=Number(config?.takeProfit),low=Number(config?.minimumStop),
    high=Number(config?.maximumStop);
  const valid=[target,low,high].every(x=>Number.isFinite(x)&&x>0);
  return {takeProfitPct:valid?100*target:null,
    minimumStopPct:valid?100*low:null,
    maximumStopPct:valid?100*high:null,
    breakEvenAtMinimumStopPct:valid?100*low/(target+low):null,
    breakEvenAtMaximumStopPct:valid?100*high/(target+high):null,
    disclaimer:'Limiar teórico somente se todas as posições encerrassem exatamente no alvo ou stop; não é previsão de taxa de acerto.'};
}

async function verifyChain(state,digest){
  if(!state||state.schema!==1||!Array.isArray(state.events))throw Error('Formato de estado inválido');
  let prev='GENESIS';
  for(let i=0;i<state.events.length;i++){
    const e=state.events[i];
    if(e.seq!==i+1||e.prevHash!==prev||
      (i&&e.candleOpenMs<=state.events[i-1].candleOpenMs))
      throw Error('Sequência de eventos inválida: '+(i+1));
    const canonical=JSON.stringify({seq:e.seq,prevHash:e.prevHash,type:e.type,
      recordedAtUTC:e.recordedAtUTC,candleOpenMs:e.candleOpenMs,payload:e.payload});
    const computed=await digest(canonical);
    if(computed!==e.hash)throw Error('SHA-256 inválido no evento '+(i+1));
    prev=e.hash;
  }
  if(state.events.length&&state.events[0].type!=='BASELINE')
    throw Error('Falta evento inicial');
  return true;
}
return {ASSETS,HORIZONS,BAR_MS,makePriceIndex,reconstruct,summarize,benchmarks,
  blockInterval,portfolioRisk,tradeStatistics,riskRewardConfig,verifyChain};
});
