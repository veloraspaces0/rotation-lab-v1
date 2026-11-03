/* Rotation Lab V4 — experimento prospectivo, exclusivamente virtual.
 * Cada observação usa somente candles de 4h fechados e uma cotação consultada na execução.
 * Nunca cria operações retroativas. Eventos encadeados via SHA-256, auditáveis nos commits.
 */
'use strict';
const {createHash}=require('node:crypto');
const ASSETS=['BTC','ETH','SOL','BNB','XRP'];
const BAR_MS=4*3600000;
const DEFAULT_CONFIG=Object.freeze({
  strategyId:'rotation-v4-frozen-2026-11',initialCapitalVirtual:50,
  maxExposure:0.65,riskBudget:0.03,minVirtualOrder:30,
  feePctPerSide:0.1,slippagePctPerSide:0.05,
  btcFast:36,btcSlow:72,assetFast:12,assetSlow:36,
  confirmationBars:3,lookback:12,minimumStrength:1,
  maxExtension:0.045,volatilityBars:20,volatilityStopFactor:2.5,
  minimumStop:0.025,maximumStop:0.05,takeProfit:0.02,
  cooldownBars:12,circuitDrawdown:0.06
});
const round=(n,d=8)=>Number(Number(n).toFixed(d));
const iso=t=>new Date(t).toISOString();
function hash(value){return createHash('sha256').update(value).digest('hex')}
function eventHash(e){
  return hash(JSON.stringify({seq:e.seq,prevHash:e.prevHash,type:e.type,
    recordedAtUTC:e.recordedAtUTC,candleOpenMs:e.candleOpenMs,payload:e.payload}));
}
function verify(state){
  if(!state||state.schema!==1||!Array.isArray(state.events))throw Error('Estado inválido');
  let parent='GENESIS';
  for(let i=0;i<state.events.length;i++){
    const e=state.events[i];
    if(e.seq!==i+1||e.prevHash!==parent||e.hash!==eventHash(e))
      throw Error('Integridade da cadeia comprometida no evento '+(i+1));
    if(i>0&&e.candleOpenMs<=state.events[i-1].candleOpenMs)
      throw Error('Candle não avança no evento '+(i+1));
    parent=e.hash;
  }
  if(state.events.length&&state.events[0].type!=='BASELINE')
    throw Error('Falta o marco inicial');
  return true;
}
function append(state,type,recordedAtUTC,candleOpenMs,payload){
  const last=state.events.at(-1);
  const ev={seq:state.events.length+1,prevHash:last?.hash||'GENESIS',
    type,recordedAtUTC,candleOpenMs,payload};
  ev.hash=eventHash(ev);
  state.events.push(ev);
  return ev;
}
function sma(data,s,i,n){
  if(i<n-1)return NaN;
  let total=0;for(let k=i-n+1;k<=i;k++)total+=data[s][k].c;
  return total/n;
}
function vol(data,s,i,n){
  if(i<n)return NaN;
  let sum=0,sq=0;
  for(let k=i-n+1;k<=i;k++){
    const r=Math.log(data[s][k].c/data[s][k-1].c);
    if(!Number.isFinite(r))return NaN;
    sum+=r;sq+=r*r;
  }
  return Math.sqrt(Math.max(0,sq/n-(sum/n)**2));
}
function btcOK(data,i,c){
  const f=sma(data,'BTC',i,c.btcFast),s=sma(data,'BTC',i,c.btcSlow);
  return Number.isFinite(f)&&Number.isFinite(s)&&f>s*1.002&&data.BTC[i].c>s;
}
function coinOK(data,sym,i,c){
  const fast=sma(data,sym,i,c.assetFast),slow=sma(data,sym,i,c.assetSlow);
  const price=data[sym][i].c;
  return Number.isFinite(fast)&&Number.isFinite(slow)&&fast>slow&&
    price>fast&&price<=fast*(1+c.maxExtension);
}
function strength(data,sym,i,c){
  if(i<c.lookback)return -Infinity;
  const a=data[sym][i].c,b=data[sym][i-c.lookback].c;
  const sigma=vol(data,sym,i,c.volatilityBars);
  if(!(a>0&&b>0&&Number.isFinite(sigma)))return -Infinity;
  return 100*Math.log(a/b)-40*sigma;
}
function entrySignal(data,c){
  const last=data.BTC.length-1;
  for(let back=0;back<c.confirmationBars;back++)
    if(!btcOK(data,last-back,c))return null;
  const candidates=[];
  for(const asset of ASSETS){
    let eligible=true;
    for(let back=0;back<c.confirmationBars;back++){
      const k=last-back;
      if(!coinOK(data,asset,k,c)||strength(data,asset,k,c)<c.minimumStrength){
        eligible=false;break;
      }
    }
    if(eligible)candidates.push({asset,strength:strength(data,asset,last,c),
      vol:vol(data,asset,last,c.volatilityBars)});
  }
  candidates.sort((a,b)=>b.strength-a.strength);
  return candidates[0]||null;
}
function clamp(x,a,b){return Math.max(a,Math.min(x,b))}
function validateMarket(market,c){
  const arr=ASSETS.map(s=>market.candles[s]);
  const minCount=Math.max(c.btcSlow+5,c.assetSlow+c.confirmationBars+5,c.volatilityBars+5);
  if(arr.some(a=>!Array.isArray(a)||a.length<minCount))throw Error('Candles insuficientes');
  const n=arr[0].length,last=n-1,t=arr[0][last].t;
  if(!Number.isInteger(t)||t%BAR_MS!==0)throw Error('Horário de candle inválido');
  if(arr.some(a=>a.length!==n||a[last].t!==t))
    throw Error('Mercados com horários desalinhados');
  for(const s of ASSETS){
    const q=market.quotes[s];
    if(!(q>0&&Number.isFinite(q)))throw Error('Cotação inválida: '+s);
    for(let k=0;k<market.candles[s].length;k++){
      const row=market.candles[s][k];
      if(!(row.c>0&&Number.isFinite(row.c))||row.t!==t-(n-1-k)*BAR_MS)
        throw Error('Série histórica incompleta: '+s);
    }
  }
  if(market.candleOpenMs!==t)throw Error('Snapshot inconsistente');
  if(!Number.isFinite(Date.parse(market.capturedAtUTC)))throw Error('Registro sem horário válido');
}
function liquidValue(account,quotes,c){
  const fee=(c.feePctPerSide+c.slippagePctPerSide)/100;
  return account.cash+(account.position?
    account.units*quotes[account.position]* (1-fee):0);
}
function snapshotWithMetrics(a,quotes,c){
  const cost=(c.feePctPerSide+c.slippagePctPerSide)/100;
  const equity=liquidValue(a,quotes,c);
  return {...a,equityVirtual:round(equity),
    btcBenchmarkVirtual:round(a.btcUnits*quotes.BTC*(1-cost)),
    cashBenchmarkVirtual:c.initialCapitalVirtual};
}
function runCycle(state,market,options={}){
  verify(state);
  const config={...DEFAULT_CONFIG,...(state.config||{})};
  const coreHash=options.coreHash||'TEST_ONLY';
  validateMarket(market,config);
  const t=market.candleOpenMs,now=market.capturedAtUTC;
  if(Date.parse(now)<t+BAR_MS)throw Error('Tentativa de avaliar candle ainda aberto');
  // Never backfill before the first successful invocation.
  if(!state.events.length){
    const cost=(config.feePctPerSide+config.slippagePctPerSide)/100;
    const a={cash:config.initialCapitalVirtual,position:null,units:0,investedVirtual:0,
      entryPrice:0,entryAtUTC:null,stopFraction:0,
      cooldownUntilCandleMs:0,hardHalt:false,peakEquity:config.initialCapitalVirtual,
      closedTrades:0,winningTrades:0,cumulativeCostsVirtual:0,
      btcUnits:config.initialCapitalVirtual*(1-cost)/market.quotes.BTC};
    append(state,'BASELINE',now,t,{coreHash,
      message:'Início prospectivo. Nenhum sinal ou compra anterior será calculado.',
      quotes:market.quotes,
      account:snapshotWithMetrics(a,market.quotes,config)});
    return {changed:true,event:state.events.at(-1)};
  }
  const initial=state.events[0];
  if(initial.payload.coreHash!==coreHash)
    throw Error('O motor da estratégia mudou. V4 bloqueada para preservar regras congeladas. Crie nova versão.');
  const previous=state.events.at(-1);
  if(t<=previous.candleOpenMs)return {changed:false,reason:'Candle já registrado ou anterior'};
  const missing=Math.max(0,Math.floor((t-previous.candleOpenMs)/BAR_MS)-1);
  const prior=previous.payload.account;
  const a={...prior};
  delete a.equityVirtual;delete a.btcBenchmarkVirtual;delete a.cashBenchmarkVirtual;
  const c=config,cost=(c.feePctPerSide+c.slippagePctPerSide)/100;
  let action={type:'HOLD',reason:'Sem condições confirmadas'};
  const before=liquidValue(a,market.quotes,c);
  a.peakEquity=Math.max(a.peakEquity,before);
  const drawdown=1-before/a.peakEquity;
  const last=market.candles.BTC.length-1;
  const candidates=entrySignal(market.candles,c);
  const possible=candidates?{
    asset:candidates.asset,strength:round(candidates.strength,4),
    volatility:round(candidates.vol,6)}:null;
  function close(reason,kind){
    const asset=a.position;
    const price=market.quotes[asset];
    const gross=a.units*price,received=gross*(1-cost),netPnl=received-a.investedVirtual;
    a.cash+=received;a.cumulativeCostsVirtual+=gross*cost;
    a.closedTrades++;if(netPnl>=0)a.winningTrades++;
    action={type:kind,asset,reason,entryAtUTC:a.entryAtUTC,
      entryPrice:a.entryPrice,exitPrice:price,
      heldHours:round((Date.parse(now)-Date.parse(a.entryAtUTC))/3600000,1),
      investedVirtual:round(a.investedVirtual,4),
      realizedPnlVirtual:round(netPnl,4),
      netReturnPct:round(100*netPnl/a.investedVirtual,4),
      simulatedExitCostVirtual:round(gross*cost,4)};
    a.position=null;a.units=0;a.investedVirtual=0;a.entryPrice=0;
    a.entryAtUTC=null;a.stopFraction=0;
    a.cooldownUntilCandleMs=t+c.cooldownBars*BAR_MS;
  }
  if(!a.hardHalt&&drawdown>=c.circuitDrawdown){
    if(a.position)close('Freio de carteira por queda acumulada','SELL_CIRCUIT');
    else action={type:'HALT',reason:'Freio de carteira em caixa'};
    a.hardHalt=true;
  }else if(a.hardHalt){
    action={type:'HOLD',reason:'Operações bloqueadas pelo freio de carteira'};
  }else if(a.position){
    const marked=a.units*market.quotes[a.position]*(1-cost);
    const positionPct=marked/a.investedVirtual-1;
    const weakNow=!btcOK(market.candles,last,c)||!coinOK(market.candles,a.position,last,c);
    const weakPrev=!btcOK(market.candles,last-1,c)||!coinOK(market.candles,a.position,last-1,c);
    if(positionPct<=-a.stopFraction)close('Stop ajustado à volatilidade','SELL_STOP');
    else if(positionPct>=c.takeProfit)close('Meta líquida da posição','SELL_TARGET');
    else if(weakNow&&weakPrev)close('Dois candles de enfraquecimento','SELL_TREND');
    else action={type:'HOLD',asset:a.position,reason:'Manter posição; nenhuma saída sinalizada'};
  }else if(t<a.cooldownUntilCandleMs){
    action={type:'HOLD',reason:'Aguardando cooldown entre posições'};
  }else if(candidates){
    const stop=clamp(c.volatilityStopFactor*candidates.vol,c.minimumStop,c.maximumStop);
    const cash0=a.cash;
    const budget=Math.min(cash0,cash0*c.maxExposure,c.initialCapitalVirtual*c.riskBudget/stop);
    if(budget+1e-8<c.minVirtualOrder){
      action={type:'SKIP',reason:'Sinal ignorado: orçamento abaixo do mínimo simulado',
        asset:candidates.asset,budgetVirtual:round(budget,4)};
    }else{
      const price=market.quotes[candidates.asset];
      a.position=candidates.asset;a.entryPrice=price;
      a.investedVirtual=budget;a.units=budget*(1-cost)/price;
      a.cash-=budget;a.entryAtUTC=now;a.stopFraction=stop;
      a.cumulativeCostsVirtual+=budget*cost;
      action={type:'BUY',asset:candidates.asset,
        reason:'Três candles confirmam BTC e tendência individual da moeda',
        simulatedEntryPrice:price,investedVirtual:round(budget,4),
        stopPct:round(stop*100,3),costVirtual:round(budget*cost,4)};
    }
  }else action={type:'HOLD',reason:'Nenhum ativo superou os filtros em 3 candles'};
  const after=liquidValue(a,market.quotes,c);
  a.peakEquity=Math.max(a.peakEquity,after);
  const finalAccount=snapshotWithMetrics(a,market.quotes,c);
  append(state,'EVALUATION',now,t,{
    source:'Binance Spot público; preços de execução simulados a partir de ticker consultado no momento',
    missedCandles:missing,quoteCapturedAtUTC:now,
    quotes:market.quotes,
    candidate:possible,
    action,
    account:finalAccount
  });
  return {changed:true,event:state.events.at(-1)};
}
module.exports={ASSETS,BAR_MS,DEFAULT_CONFIG,eventHash,verify,runCycle,
  sma,vol,btcOK,coinOK,strength,entrySignal};
