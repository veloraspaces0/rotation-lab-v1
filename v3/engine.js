/* Rotation Lab V3 - research engine. Read-only backtest; never places orders. */
(function(root){
'use strict';
const SYMBOLS=['BTC','ETH','SOL','BNB','XRP'];
const SETTINGS=Object.freeze({
  btcFast:36,btcSlow:72,coinFast:12,coinSlow:36,
  confirmBars:3,momentumBars:12,minimumMomentum:1.0,
  maxStretch:0.045,maxExposure:0.65,riskBudget:0.03,
  volBars:20,volStopFactor:2.5,minStop:0.025,maxStop:0.05,
  takeProfit:0.02,waitBars:12,drawdownCircuit:0.06
});
function mean(data,s,i,n){
  if(i<n-1)return NaN;
  let total=0;
  for(let j=i-n+1;j<=i;j++)total+=data[s][j].c;
  return total/n;
}
function volatility(data,s,i,n){
  if(i<n)return NaN;
  let sum=0,sq=0;
  for(let j=i-n+1;j<=i;j++){
    const r=Math.log(data[s][j].c/data[s][j-1].c);
    if(!Number.isFinite(r))return NaN;
    sum+=r;sq+=r*r;
  }
  return Math.sqrt(Math.max(0,sq/n-(sum/n)**2));
}
function clamp(x,a,b){return Math.min(b,Math.max(a,x))}
function isBtcRegime(data,i,cfg){
  const fast=mean(data,'BTC',i,cfg.btcFast),slow=mean(data,'BTC',i,cfg.btcSlow);
  return Number.isFinite(fast)&&Number.isFinite(slow)&&
    data.BTC[i].c>slow&&fast>slow*1.002;
}
function isAssetTrend(data,s,i,cfg){
  const fast=mean(data,s,i,cfg.coinFast),slow=mean(data,s,i,cfg.coinSlow);
  const price=data[s][i].c;
  return Number.isFinite(fast)&&Number.isFinite(slow)&&
    fast>slow&&price>fast&&price<=fast*(1+cfg.maxStretch);
}
function score(data,s,i,cfg){
  if(i<cfg.momentumBars)return -Infinity;
  const now=data[s][i].c,old=data[s][i-cfg.momentumBars].c;
  if(!(now>0&&old>0))return -Infinity;
  const vol=volatility(data,s,i,cfg.volBars);
  return 100*Math.log(now/old)-(Number.isFinite(vol)?100*vol*.4:0);
}
function signal(data,i,cfg){
  // Every condition uses closed candles i, i-1 and i-2 only.
  for(let k=0;k<cfg.confirmBars;k++)if(!isBtcRegime(data,i-k,cfg))return null;
  const ranked=SYMBOLS.map(s=>{
    let ok=true;
    for(let k=0;k<cfg.confirmBars;k++){
      const bar=i-k;
      if(!isAssetTrend(data,s,bar,cfg)||score(data,s,bar,cfg)<cfg.minimumMomentum){ok=false;break}
    }
    return ok?{symbol:s,score:score(data,s,i,cfg),vol:volatility(data,s,i,cfg.volBars)}:null;
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
  return ranked[0]||null;
}
function simulate(data,p,custom){
  const cfg=Object.assign({},SETTINGS,custom||{});
  const n=data.BTC.length,start=Math.max(cfg.btcSlow+2,p.lookback+2,cfg.coinSlow+cfg.confirmBars,cfg.volBars+2);
  if(!SYMBOLS.every(s=>Array.isArray(data[s])&&data[s].length===n))throw Error('Séries desalinhadas');
  if(n<start+25)throw Error('Dados insuficientes');
  const cost=p.fee+p.slip,target=p.target,min=p.minOrder,capital=p.capital;
  let cash=capital,asset=null,units=0,paid=0,entryBar=0,peak=capital;
  let hardHalt=false,haltReason='',pending=null,coolUntil=start,closed=0,wins=0,fees=0;
  let maxDrawdown=0,maxExposure=0,rejectedByMin=0,signals=0;
  const curve=[],index=[],trades=[],ledger=[];
  let active=null;
  function equity(i){return cash+(asset?units*data[asset][i].c*(1-cost):0)}
  function buy(i,ord){
    const price=data[ord.symbol][i].o;
    const budget=Math.min(cash,cash*cfg.maxExposure,
      capital*cfg.riskBudget/ord.stop);
    if(!(price>0&&budget>=min)){rejectedByMin++;return}
    units=budget*(1-cost)/price;paid=budget;cash-=budget;asset=ord.symbol;entryBar=i;
    fees+=budget*cost;
    active={symbol:asset,enteredUTC:new Date(data[asset][i].t).toISOString(),
      entryPrice:price,entryBar:i,stopPct:ord.stop*100,investedVirtual:budget,
      entryReason:ord.reason,buyFeeVirtual:budget*cost};
    trades.push({t:data[asset][i].t,action:'BUY',asset,reason:ord.reason});
  }
  function sell(i,reason,type){
    if(!asset)return;
    const symbol=asset,price=data[symbol][i].o;
    const gross=units*price,proceeds=gross*(1-cost),pnl=proceeds-paid;
    fees+=gross*cost;cash+=proceeds;closed++;
    if(pnl>=0)wins++;
    ledger.push({...active,exitUTC:new Date(data[symbol][i].t).toISOString(),
      exitPrice:price,exitReason:reason,exitAction:type,
      heldHours:(i-entryBar)*4,netPnLVirtual:pnl,netReturnPct:100*(proceeds/paid-1),
      sellFeeVirtual:gross*cost,costsVirtual:active.buyFeeVirtual+gross*cost});
    trades.push({t:data[symbol][i].t,action:type,asset:symbol,reason,pnl});
    asset=null;units=0;paid=0;active=null;entryBar=0;
  }
  for(let i=start;i<n;i++){
    if(pending){
      const act=pending;pending=null;
      if(act.kind==='sell'){
        sell(i,act.reason,act.type);
        coolUntil=Math.max(coolUntil,i+cfg.waitBars);
      }else if(act.kind==='buy'&&!hardHalt&&i>=coolUntil)buy(i,act);
      else if(act.kind==='halt'){
        if(asset)sell(i,act.reason,'CIRCUIT');
        hardHalt=true;haltReason=act.reason;
      }
    }
    const nav=equity(i);
    if(!Number.isFinite(nav)||nav<0)throw Error('Patrimônio inválido');
    peak=Math.max(peak,nav);
    maxDrawdown=Math.max(maxDrawdown,100*(peak-nav)/peak);
    curve.push(nav);index.push(i);
    if(asset){
      const marked=units*data[asset][i].c*(1-cost);
      maxExposure=Math.max(maxExposure,100*marked/nav);
    }
    if(i===n-1||hardHalt)continue;
    // A drawdown pause is permanent for the current test period to prevent churn.
    if(nav<=peak*(1-cfg.drawdownCircuit)){
      pending={kind:'halt',reason:'Freio da carteira '+(100*cfg.drawdownCircuit).toFixed(1)+'%'};
      continue;
    }
    if(asset){
      const value=units*data[asset][i].c*(1-cost);
      const netChange=value/paid-1;
      const ownTrend=isAssetTrend(data,asset,i,cfg);
      const btcHealthy=isBtcRegime(data,i,cfg);
      if(netChange<=-active.stopPct/100){
        pending={kind:'sell',type:'STOP',reason:'Stop por volatilidade '+active.stopPct.toFixed(2)+'%'};
      }else if(netChange>=target){
        pending={kind:'sell',type:'TARGET',reason:'Meta líquida '+(100*target).toFixed(1)+'%'};
      }else if(!btcHealthy||!ownTrend){
        // Require two closed candles of weakness; avoid intrabar decisions.
        const weaknessPrev=!isBtcRegime(data,i-1,cfg)||!isAssetTrend(data,asset,i-1,cfg);
        if(weaknessPrev)pending={kind:'sell',type:'TREND',reason:'Tendência enfraqueceu por 2 candles'};
      }
      continue;
    }
    if(i<coolUntil)continue;
    const choice=signal(data,i,cfg);
    if(!choice)continue;
    signals++;
    const stop=clamp(cfg.volStopFactor*choice.vol,cfg.minStop,cfg.maxStop);
    const expectedBudget=Math.min(cash,cash*cfg.maxExposure,capital*cfg.riskBudget/stop);
    if(expectedBudget<min){rejectedByMin++;continue}
    pending={kind:'buy',symbol:choice.symbol,stop,reason:'3 candles: BTC + tendência '+choice.symbol+' + força'};
  }
  const ending=curve[curve.length-1];
  return {curve,index,final:ending,returnPct:(ending/capital-1)*100,maxDD:maxDrawdown,
    closed,wins,fees,ledger,trades,hardHalt,haltReason,maxExposure,
    rejectedByMin,signals,cfg,open:active};
}
function segment(c,a,b){
  let max=c[a],dd=0;
  for(let i=a;i<=b;i++){max=Math.max(max,c[i]);dd=Math.max(dd,(max-c[i])/max*100)}
  return {start:c[a],final:c[b],returnPct:(c[b]/c[a]-1)*100,maxDDPct:dd};
}
function evaluate(data,p,v1,v2){
  const comparison=v2.evaluate(data,p,v1);
  const test=simulate(data,p);
  const expectedStart=comparison.v2.index[0];
  if(test.index[0]!==expectedStart)throw Error('V2/V3 começam em períodos diferentes');
  if(test.curve.length!==comparison.length)throw Error('Curvas com durações diferentes');
  const curves={v3:test.curve,v2:comparison.curves.v2,
    v1Rotativo:comparison.curves.v1Rotativo,
    v1Conservador:comparison.curves.v1Conservador,
    btc:comparison.curves.buyHoldBTC,
    cash:Array(test.curve.length).fill(p.capital)};
  const split=comparison.split,metrics={};
  for(const name of Object.keys(curves)){
    const series=curves[name];
    metrics[name]={full:segment(series,0,series.length-1),
      first60:segment(series,0,split),
      final40:segment(series,split,series.length-1)};
  }
  return {v3:test,comparison,curves,metrics,split,
    period:comparison.period,capital:p.capital,
    warning:'Todos os períodos já foram examinados no projeto; a faixa final de 40% NÃO é holdout independente da V3. Use períodos novos ou paper trading futuro.'};
}
root.RotationLabV3Engine={SETTINGS,mean,volatility,signal,simulate,evaluate};
})(typeof window!=='undefined'?window:globalThis);
