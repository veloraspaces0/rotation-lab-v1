/* Rotation Lab V4.1 research-only benchmarks.
 * Does not alter frozen core/runner/workflow or paper trades.
 */
(function(root){
'use strict';
const ASSETS=['BTC','ETH','SOL','BNB','XRP'];
const cost=config=>(Number(config.feePctPerSide)+Number(config.slippagePctPerSide))/100;
function evaluate(state){
  if(!state?.events?.length)return {points:[],last:null};
  const cfg=state.config,init=Number(cfg.initialCapitalVirtual),base=state.events[0].payload.quotes;
  const c=cost(cfg),accounting=(1-c)*(1-c);
  if(!ASSETS.every(s=>Number.isFinite(base[s])&&base[s]>0))throw Error('Baseline sem preços válidos para benchmark');
  const points=state.events.map(event=>{
    const quotes=event.payload.quotes;
    const ratio=s=>quotes[s]/base[s];
    const b65=init*(0.35+0.65*accounting*ratio('BTC'));
    const equal=init*accounting*ASSETS.reduce((sum,s)=>sum+ratio(s)/ASSETS.length,0);
    return {at:event.recordedAtUTC,exposureMatchedBTC:b65,equalWeightFive:equal,
      btc100:event.payload.account.btcBenchmarkVirtual,
      cash100:event.payload.account.cashBenchmarkVirtual,
      v41:event.payload.account.equityVirtual};
  });
  return {points,last:points.at(-1),assumptions:{
    matched:'65% BTC + 35% caixa, com compra/venda simuladas a custo total de ida/volta',
    equal:'20% de cada BTC, ETH, SOL, BNB e XRP, com custos de ida/volta',
    prices:'Preço público ticker USDT, unidade virtual não convertida para BRL',
    causality:'Benchmark fixo a partir do preço consultado no marco inicial, sem rebalanceamentos',
    caution:'Comparação de exposição, não prova de habilidade; carteira V4.1 pode ficar 100% em caixa por muitos candles.'}};
}
root.RotationLabV41Analysis={evaluate};
})(typeof window!=='undefined'?window:globalThis);
