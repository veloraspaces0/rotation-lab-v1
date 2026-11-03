/* Rotation Lab V2 - motor de pesquisa. Sem ordens ou dados privados. */
(function(root){
'use strict';
const SYMBOLS=['BTC','ETH','SOL','BNB','XRP'];
const DEFAULTS=Object.freeze({
  exposure:0.60,stop:0.03,lookback:12,minimumScore:0.8,
  rotationGap:2.0,minimumHold:6,cooldown:12,
  trendFast:36,trendSlow:72,trendBuffer:0.002,
  maxDrawdownTrigger:0.08,pauseAfterDrawdown:48
});
function sma(prices,s,i,length){
  if(i<length-1)return NaN;
  let sum=0;
  for(let j=i-length+1;j<=i;j++)sum+=prices[s][j].c;
  return sum/length;
}
function momentum(prices,s,i,length){
  if(i<length)return -Infinity;
  const bars=prices[s],now=bars[i].c,old=bars[i-length].c;
  const fast=bars[i-Math.max(2,Math.floor(length/3))].c;
  if(!(now>0&&old>0&&fast>0))return -Infinity;
  const total=Math.log(now/old)*100,short=Math.log(now/fast)*100;
  let sum=0,sq=0;
  for(let j=i-length+1;j<=i;j++){
    const r=Math.log(bars[j].c/bars[j-1].c)*100;
    sum+=r;sq+=r*r;
  }
  const volatility=Math.sqrt(Math.max(0,sq/length-Math.pow(sum/length,2)))*Math.sqrt(length);
  return 0.7*total+0.3*short-0.08*volatility;
}
function simulate(prices,p,custom){
  const cfg=Object.assign({},DEFAULTS,custom||{});
  const n=prices.BTC.length;
  if(!SYMBOLS.every(s=>prices[s]&&prices[s].length===n))throw Error('Séries desalinhadas');
  const start=Math.max(cfg.trendSlow+2,p.lookback+2,cfg.lookback+2);
  if(n<=start+20)throw Error('Histórico insuficiente para V2');
  const unitCost=p.fee+p.slip;
  const minOrder=p.minOrder,capital=p.capital;
  let cash=capital,position=null,units=0,spent=0,entryBar=0;
  let peak=capital,maxDD=0,cooldownUntil=start,pausedUntil=0,queued=null;
  let costs=0,closed=0,wins=0,swaps=0,brakes=0,orders=[],exposurePeak=0;
  const curve=[],index=[];
  function equityAt(i){
    return cash+(position?units*prices[position][i].c*(1-unitCost):0);
  }
  function buy(sym,i,reason){
    const price=prices[sym][i].o;
    const nav=cash;
    const amount=Math.min(cash,nav*cfg.exposure);
    if(!(amount+1e-8>=minOrder&&price>0))return false;
    spent=amount;units=amount*(1-unitCost)/price;cash-=amount;
    costs+=amount*unitCost;position=sym;entryBar=i;
    orders.push({t:prices[sym][i].t,action:'COMPRA',s:sym,reason,pl:null});
    return true;
  }
  function sell(i,reason,kind){
    if(!position)return;
    const sym=position,price=prices[sym][i].o;
    const gross=units*price,received=gross*(1-unitCost),pl=received-spent;
    costs+=gross*unitCost;cash+=received;closed++;if(pl>=0)wins++;
    orders.push({t:prices[sym][i].t,action:kind==='brake'?'PAUSA':kind==='stop'?'STOP':'VENDA',s:sym,reason,pl});
    position=null;spent=0;units=0;entryBar=0;
  }
  for(let i=start;i<n;i++){
    if(queued){
      const item=queued;queued=null;
      if(item.kind==='brake'){
        if(position)sell(i,item.reason,'brake');
        peak=cash;pausedUntil=Math.max(pausedUntil,i+cfg.pauseAfterDrawdown);
        cooldownUntil=Math.max(cooldownUntil,pausedUntil);
      }else if(item.kind==='sell'){
        sell(i,item.reason,item.reason.startsWith('Stop')?'stop':'sell');
        cooldownUntil=Math.max(cooldownUntil,i+cfg.cooldown);
      }else if(item.kind==='buy'){
        if(i>=pausedUntil&&i>=cooldownUntil)buy(item.to,i,item.reason);
      }else if(item.kind==='switch'){
        sell(i,item.reason,'sell');swaps++;
        const entered=buy(item.to,i,item.reason);
        if(!entered)cooldownUntil=i+cfg.cooldown;
      }
    }
    const nav=equityAt(i);
    if(!Number.isFinite(nav)||nav<0)throw Error('Patrimônio inválido');
    peak=Math.max(peak,nav);
    maxDD=Math.max(maxDD,(peak-nav)/peak*100);
    curve.push(nav);index.push(i);
    if(position){
      const mark=units*prices[position][i].c*(1-unitCost);
      exposurePeak=Math.max(exposurePeak,mark/nav*100);
    }
    if(i===n-1)continue;
    // Todas as decisões usam apenas fechamento do candle i; ordens na abertura i+1.
    if(nav<=peak*(1-cfg.maxDrawdownTrigger)&&i>=pausedUntil){
      brakes++;queued={kind:'brake',reason:'Circuit breaker: queda '+(cfg.maxDrawdownTrigger*100).toFixed(0)+'%'};
      continue;
    }
    if(i<pausedUntil)continue;
    const fast=sma(prices,'BTC',i,cfg.trendFast);
    const slow=sma(prices,'BTC',i,cfg.trendSlow);
    const healthy=Number.isFinite(fast)&&Number.isFinite(slow)&&
      fast>slow*(1+cfg.trendBuffer)&&prices.BTC[i].c>slow;
    if(!healthy){
      if(position)queued={kind:'sell',reason:'Filtro de tendência: caixa'};
      continue;
    }
    const ranks=SYMBOLS.map(s=>({s,score:momentum(prices,s,i,cfg.lookback)}))
      .sort((a,b)=>b.score-a.score);
    const best=ranks[0];
    if(!position){
      if(i>=cooldownUntil&&best.score>=cfg.minimumScore){
        const budget=nav*cfg.exposure;
        if(budget+1e-8>=minOrder)queued={kind:'buy',to:best.s,reason:'Entrada confirmada por tendência'};
      }
      continue;
    }
    const pnl=(units*prices[position][i].c*(1-unitCost))/spent-1;
    const held=i-entryBar;
    if(pnl<=-cfg.stop){
      queued={kind:'sell',reason:'Stop '+(cfg.stop*100).toFixed(1)+'%'};
      continue;
    }
    if(pnl>=p.target){
      queued={kind:'sell',reason:'Alvo líquido '+(p.target*100).toFixed(1)+'%'};
      continue;
    }
    const current=ranks.find(x=>x.s===position);
    if(held>=cfg.minimumHold&&pnl>=0&&best.s!==position&&
      best.score>=cfg.minimumScore&&best.score-current.score>=cfg.rotationGap){
      queued={kind:'switch',to:best.s,reason:'Troca seletiva: vantagem '+(best.score-current.score).toFixed(2)};
    }
  }
  return {curve,index,final:curve[curve.length-1],returnPct:(curve[curve.length-1]/capital-1)*100,
    maxDD,costs,closed,wins,swaps,brakes,orders,exposurePeak,cfg};
}
function stats(curve,initial,from,to){
  const a=from==null?0:from,b=to==null?curve.length-1:to;
  if(a<0||b>=curve.length||b<=a)throw Error('Segmento inválido');
  // Rendimentos usam patrimônio ao início de cada janela (capital não é reinicializado).
  let peak=curve[a],dd=0;
  for(let i=a;i<=b;i++){
    peak=Math.max(peak,curve[i]);
    dd=Math.max(dd,(peak-curve[i])/peak*100);
  }
  return {start:curve[a],final:curve[b],
    returnPct:(curve[b]/curve[a]-1)*100,
    maxDDPct:dd};
}
function evaluate(data,p,v1){
  const v2=simulate(data,p);
  const start=v2.index[0];
  const warm=p.lookback+2;
  const cut=start-warm;
  if(cut<0)throw Error('Janela de aquecimento insuficiente');
  const aligned={};
  for(const s of SYMBOLS)aligned[s]=data[s].slice(cut);
  const rot=v1.simulate(aligned,p,'rotativo');
  const con=v1.simulate(aligned,p,'conservador');
  const btc=v1.benchmark(aligned,p,rot.index);
  const length=v2.curve.length;
  if(![rot,con,btc].every(x=>x.curve.length===length))
    throw Error('Falha no alinhamento dos históricos');
  // Janela final de 40% nunca é usada para selecionar regras da V2.
  const split=Math.max(2,Math.floor((length-1)*0.60));
  const curves={v2:v2.curve,v1Rotativo:rot.curve,v1Conservador:con.curve,buyHoldBTC:btc.curve};
  const metrics={};
  for(const key of Object.keys(curves)){
    const curve=curves[key];
    metrics[key]={full:stats(curve,p.capital,0,length-1),
      initial60:stats(curve,p.capital,0,split),
      validation40:stats(curve,p.capital,split,length-1)};
  }
  return {curves,metrics,v2,v1:{rot,con,btc},length,split,
    period:{from:data.BTC[start].t,to:data.BTC[numericLastIndex(data)].t,
      splitAt:data.BTC[start+split].t},
    note:'V2 com parâmetros pré-definidos; faixa final de 40% é validação temporal, não previsão.'};
}
function numericLastIndex(data){return data.BTC.length-1}
root.RotationLabV2Engine={simulate,evaluate,stats,momentum,DEFAULTS};
})(typeof window!=='undefined'?window:globalThis);
