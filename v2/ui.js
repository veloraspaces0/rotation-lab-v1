/* Rotation Lab V2 - painel independente e relatório GitHub */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const money=x=>Number(x).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct=x=>(x>0?'+':'')+Number(x).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
const plain=x=>Number(x).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const date=x=>new Date(x).toLocaleDateString('pt-BR',{timeZone:'UTC'});
const rows=[
  {key:'v2',label:'V2 · Risco controlado'},
  {key:'v1Rotativo',label:'V1 · Rotativo'},
  {key:'v1Conservador',label:'V1 · Conservador'},
  {key:'buyHoldBTC',label:'Comprar e manter BTC'}
];
let latest=null,source='demo',p0=null;
function signedCell(x){
  const cls=x>0?'v2-up':x<0?'v2-down':'';
  return '<span class="'+cls+'">'+pct(x)+'</span>';
}
function table(result){
  return rows.map(({key,label})=>{
    const r=result.metrics[key];
    return '<tr'+(key==='v2'?' class="v2-main-row"':'')+'><th scope="row">'+label+
      '</th><td>'+signedCell(r.full.returnPct)+'</td><td>'+signedCell(r.initial60.returnPct)+
      '</td><td>'+signedCell(r.validation40.returnPct)+'</td>'+
      '<td>'+plain(r.full.maxDDPct)+'%</td></tr>';
  }).join('');
}
function analyze(raw,p,origin){
  source=origin;
  p0=p;
  const engine=window.RotationLabV2Engine;
  const v1=window.RotationLabV1;
  if(!engine||!v1)return $('v2Status').textContent='Motor V2 não carregado.';
  try{
    const r=engine.evaluate(raw,p,v1);
    latest=r;
    const m=r.metrics.v2;
    const delta=m.validation40.returnPct-r.metrics.buyHoldBTC.validation40.returnPct;
    $('v2Final').textContent=money(r.v2.final);
    $('v2Return').textContent=pct(m.full.returnPct);
    $('v2Return').className='v2-value '+(m.full.returnPct>=0?'v2-up':'v2-down');
    $('v2Test').textContent=pct(m.validation40.returnPct);
    $('v2Test').className='v2-value '+(m.validation40.returnPct>=0?'v2-up':'v2-down');
    $('v2Risk').textContent='−'+plain(m.full.maxDDPct)+'%';
    $('v2CompareBody').innerHTML=table(r);
    $('v2Operations').textContent=r.v2.closed+' posições encerradas · '+r.v2.swaps+
      ' trocas · '+r.v2.brakes+' pausas de risco · custos estimados '+money(r.v2.costs)+
      '. Exposição máxima observada '+plain(r.v2.exposurePeak)+'%'+
      (r.v2.blockedSignals>0?' · '+r.v2.blockedSignals+' sinais bloqueados pelo mínimo de ordem.':'.');
    $('v2Period').textContent=date(r.period.from)+' a '+date(r.period.to)+
      ' · validação de '+date(r.period.splitAt)+' a '+date(r.period.to)+
      ' · '+r.length+' candles de 4h';
    $('v2Source').textContent=origin==='demo'?
      'DEMONSTRAÇÃO — preços fictícios, não use como evidência de lucro':
      'BINANCE — histórico público real; simulação sem ordens';
    $('v2Source').className='v2-source '+(origin==='demo'?'v2-warning':'v2-live');
    $('v2Signal').textContent='V2 vs. BTC na validação: '+
      (delta>=0?'+':'')+plain(delta)+' pontos percentuais. '+
      (delta>=0?'Superou BTC nessa janela.':'Ficou atrás do BTC nessa janela.')+
      ' Isso não comprova desempenho futuro.';
    $('v2Status').textContent='Simulação concluída. Os parâmetros da V2 são fixos para preservar a comparação; alterações nas configurações da V1 afetam os parâmetros compartilhados.';
    drawChart(r);
  }catch(e){
    latest=null;
    $('v2Status').textContent='Erro na comparação V2: '+String(e.message||e);
  }
}
function drawChart(r){
  const canvas=$('v2Chart');
  const parent=canvas.parentElement;
  const width=Math.max(290,parent.clientWidth-4),height=270,dpr=window.devicePixelRatio||1;
  canvas.style.width=width+'px';canvas.style.height=height+'px';
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,width,height);
  const {curves,split}=r;
  const colors={v2:'#63e1ae',v1Rotativo:'#ffc274',v1Conservador:'#bfabff',buyHoldBTC:'#73b7fa'};
  const graph={x0:47,x1:width-12,y0:15,y1:height-35};
  const all=Object.values(curves).flat();
  let min=Math.min(...all),max=Math.max(...all);
  if(max-min<1)max=min+1;
  const pad=(max-min)*0.12;
  min-=pad;max+=pad;
  const x=i=>graph.x0+(i/(r.length-1))*(graph.x1-graph.x0);
  const y=v=>graph.y1-(v-min)/(max-min)*(graph.y1-graph.y0);
  ctx.font='11px sans-serif';
  ctx.fillStyle='#91a9b8';
  for(let row=0;row<=4;row++){
    const value=min+(max-min)*(row/4),py=y(value);
    ctx.strokeStyle='#28404a';ctx.lineWidth=0.7;
    ctx.beginPath();ctx.moveTo(graph.x0,py);ctx.lineTo(graph.x1,py);ctx.stroke();
    ctx.fillText('R$'+Math.round(value),4,py+4);
  }
  const sx=x(split);
  ctx.fillStyle='rgba(116,177,255,.07)';
  ctx.fillRect(sx,graph.y0,graph.x1-sx,graph.y1-graph.y0);
  ctx.strokeStyle='#7eaacc';ctx.setLineDash([5,4]);
  ctx.beginPath();ctx.moveTo(sx,graph.y0);ctx.lineTo(sx,graph.y1);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#a2bdd0';ctx.fillText('Validação 40%',Math.max(graph.x0,Math.min(sx+5,graph.x1-83)),graph.y0+11);
  for(const key of ['buyHoldBTC','v1Conservador','v1Rotativo','v2']){
    const curve=curves[key];ctx.strokeStyle=colors[key];
    ctx.lineWidth=key==='v2'?2.8:1.5;
    ctx.beginPath();
    for(let i=0;i<curve.length;i++)i?ctx.lineTo(x(i),y(curve[i])):ctx.moveTo(x(i),y(curve[i]));
    ctx.stroke();
  }
  ctx.fillStyle='#91a9b8';
  ctx.fillText(date(r.period.from),graph.x0,graph.y1+20);
  const t=date(r.period.to),tw=ctx.measureText(t).width;
  ctx.fillText(t,graph.x1-tw,graph.y1+20);
}
function makeReport(){
  if(!latest)return null;
  const r=latest;
  const vals={};
  for(const item of rows){
    const m=r.metrics[item.key];
    vals[item.key]={totalPct:Number(m.full.returnPct.toFixed(3)),
      first60Pct:Number(m.initial60.returnPct.toFixed(3)),
      validation40Pct:Number(m.validation40.returnPct.toFixed(3)),
      maxDDPct:Number(m.full.maxDDPct.toFixed(3))};
  }
  const cfg=r.v2.cfg;
  return {project:'Rotation Lab V2',createdAtUTC:new Date().toISOString(),
    marketData:source==='demo'?'FICTITIOUS DEMO':'Binance public historical data',
    simulatedVirtualCapitalBRL:p0.capital,
    dateRangeUTC:{from:new Date(r.period.from).toISOString(),to:new Date(r.period.to).toISOString(),
      validationStart:new Date(r.period.splitAt).toISOString(),fourHourCandles:r.length},
    fees:{perSidePct:p0.fee*100,slippagePct:p0.slip*100,illustrativeMinOrderBRL:p0.minOrder},
    V2Rules:{maxExposurePct:cfg.exposure*100,positionStopPct:cfg.stop*100,
      takeProfitPct:p0.target*100,relativeStrengthBars:cfg.lookback,
      rotationAdvantage:cfg.rotationGap,
      btcTrendSMA:[cfg.trendFast,cfg.trendSlow],cooldownBars:cfg.cooldown,
      drawdownPauseTriggerPct:cfg.maxDrawdownTrigger*100,pauseBars:cfg.pauseAfterDrawdown},
    results:vals,
    V2Operations:{closed:r.v2.closed,wins:r.v2.wins,swaps:r.v2.swaps,
      circuitBreaks:r.v2.brakes,blockedSignals:r.v2.blockedSignals,
      costsEstimatedBRL:Number(r.v2.costs.toFixed(3)),exposurePeakPct:Number(r.v2.exposurePeak.toFixed(3))},
    caveats:'Simulacao educativa. Taxas estimadas. O valor R$ é unidade contabil ilustrativa sem USD/BRL. Backtest nao comprova lucro futuro; limites de perdas podem ser excedidos por gaps.'
  };
}
function publish(){
  const data=makeReport();
  if(!data)return $('v2ReportStatus').textContent='Rode uma simulação primeiro.';
  const title='[Rotation Lab V2] '+(source==='demo'?'DEMO':'BINANCE')+' · '+data.createdAtUTC.slice(0,16);
  const body='Relatório voluntário do Rotation Lab V2 (capital virtual, sem ordens reais):\n\n'+JSON.stringify(data,null,2);
  $('v2ReportStatus').textContent='Abrindo GitHub. Revise e toque em Submit new issue para enviar o relatório.';
  window.location.assign('https://github.com/veloraspaces0/rotation-lab-v1/issues/new?title='+
    encodeURIComponent(title)+'&body='+encodeURIComponent(body));
}
async function copy(){
  const data=makeReport();
  if(!data)return;
  const text=JSON.stringify(data,null,2);
  try{await navigator.clipboard.writeText(text);
    $('v2ReportStatus').textContent='Relatório copiado. Você pode colar no GitHub ou nesta conversa.';}
  catch(e){$('v2ReportStatus').textContent='Não foi possível copiar automaticamente. Use o botão Enviar relatório.';}
}
$('v2ReportBtn').addEventListener('click',publish);
$('v2CopyBtn').addEventListener('click',copy);
window.addEventListener('rotation-lab-v2-data',e=>analyze(e.detail.data,e.detail.p,e.detail.source));
window.addEventListener('resize',()=>{if(latest)drawChart(latest)});
if(window.RotationLabV1?.run)window.RotationLabV1.run();
})();
