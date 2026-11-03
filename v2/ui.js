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
    renderDiagnostic(r);
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

function escapeText(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function whenUTC(s){
  return new Date(s).toLocaleString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' UTC';
}
function diagnosis(r){
  const trades=r.v2.completedTrades||[];
  const groups={};
  const byCoin={};
  for(const t of trades){
    let reason='Outra saída';
    if(t.exitAction==='STOP')reason='Stop de posição';
    else if(t.exitAction==='PAUSA')reason='Proteção da carteira';
    else if(t.exitReason.startsWith('Filtro de tendência'))reason='Filtro de tendência';
    else if(t.exitReason.startsWith('Alvo'))reason='Meta de lucro';
    else if(t.exitReason.startsWith('Troca'))reason='Troca de moeda';
    if(!groups[reason])groups[reason]={count:0,pnl:0};
    groups[reason].count++;groups[reason].pnl+=t.netPnLVirtual;
    if(!byCoin[t.asset])byCoin[t.asset]={count:0,pnl:0};
    byCoin[t.asset].count++;byCoin[t.asset].pnl+=t.netPnLVirtual;
  }
  const pnlClosed=trades.reduce((acc,t)=>acc+t.netPnLVirtual,0);
  const winCount=trades.filter(t=>t.netPnLVirtual>=0).length;
  const avgHours=trades.length?trades.reduce((acc,t)=>acc+t.hoursHeld,0)/trades.length:0;
  const worst=trades.length?trades.reduce((a,b)=>a.netPnLVirtual<=b.netPnLVirtual?a:b):null;
  return {trades,groups,byCoin,pnlClosed,winCount,avgHours,worst};
}
function renderDiagnostic(result){
  const d=diagnosis(result);
  const trades=d.trades;
  $('v2DiagnosticsSummary').textContent=trades.length+' posições encerradas · '+d.winCount+' no zero ou com lucro · '+
    (trades.length-d.winCount)+' com prejuízo · P&L realizado '+money(d.pnlClosed)+
    ' · duração média '+plain(d.avgHours)+' horas.';
  const body=$('v2TradeBody');
  if(!trades.length){
    body.innerHTML='<tr><td colspan="7">Nenhuma posição encerrada nessa janela.</td></tr>';
  }else{
    body.innerHTML=trades.map((t,i)=>'<tr><td><strong>#'+(i+1)+' · '+escapeText(t.asset)+'</strong></td>'+
      '<td>'+whenUTC(t.entryUTC)+'</td><td>'+whenUTC(t.exitUTC)+'</td>'+
      '<td>'+t.hoursHeld+'h</td>'+
      '<td>'+escapeText(t.exitReason)+'</td>'+
      '<td><span class="'+(t.netPnLVirtual<0?'v2-down':'v2-up')+'">'+money(t.netPnLVirtual)+'</span></td>'+
      '<td>'+signedCell(t.netReturnPct)+'</td></tr>').join('');
  }
  const reasons=Object.entries(d.groups).sort((a,b)=>a[1].pnl-b[1].pnl);
  const byCoin=Object.entries(d.byCoin).sort((a,b)=>a[1].pnl-b[1].pnl);
  $('v2DiagnosticsBreakdown').textContent='Motivos: '+
    (reasons.length?reasons.map(([reason,v])=>reason+' '+v.count+'× ('+money(v.pnl)+')').join(' · '):'sem saídas')+
    '. Por moeda: '+(byCoin.length?byCoin.map(([s,v])=>s+' '+v.count+'× ('+money(v.pnl)+')').join(' · '):'sem saídas')+'.';
  $('v2OpenTrade').textContent=result.v2.openTrade?
    'Existe uma posição ainda aberta: '+result.v2.openTrade.asset+'. O P&L não realizado não aparece na soma de posições encerradas.':
    'Nenhuma posição aberta no último candle.';
}
function csvTrades(){
  if(!latest){$('v2ReportStatus').textContent='Rode a simulação antes de exportar.';return;}
  const cols=['moeda','data_compra_utc','data_venda_utc','preco_compra_usdt','preco_venda_usdt',
    'duracao_horas','motivo_compra','motivo_venda','capital_aplicado_virtual',
    'pnl_liquido_virtual','retorno_liquido_pct','custos_estimados_virtuais'];
  const rows=[cols,...latest.v2.completedTrades.map(t=>[
    t.asset,t.entryUTC,t.exitUTC,t.entryPrice,t.exitPrice,t.hoursHeld,
    t.entryReason,t.exitReason,t.investedVirtual,t.netPnLVirtual,t.netReturnPct,t.estimatedTotalCostsVirtual])];
  const csv='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v==null?'':v).replaceAll('"','""')+'"').join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const link=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=link;a.download='rotation_lab_v2_operacoes.csv';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(link),1000);
  $('v2ReportStatus').textContent='Arquivo CSV preparado com todas as posições encerradas neste teste.';
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
    tradeDiagnostics:(()=>{const d=diagnosis(r);return {
      closedCount:d.trades.length,zeroOrWinning:d.winCount,
      losing:d.trades.length-d.winCount,closedPnLVirtual:Number(d.pnlClosed.toFixed(3)),
      averageHoldingHours:Number(d.avgHours.toFixed(1)),
      exitReasons:Object.fromEntries(Object.entries(d.groups).map(([k,v])=>[k,{count:v.count,pnlVirtual:Number(v.pnl.toFixed(3))}])),
      byAsset:Object.fromEntries(Object.entries(d.byCoin).map(([k,v])=>[k,{count:v.count,pnlVirtual:Number(v.pnl.toFixed(3))}])),
      openPosition:r.v2.openTrade?{asset:r.v2.openTrade.asset,entryUTC:r.v2.openTrade.entryUTC}:null
    }})(),
    tradeLedgerColumns:['asset','entryUTC','exitUTC','hoursHeld','exitAction','exitReason','netPnLVirtual','netReturnPct','estimatedCostsVirtual'],
    tradeLedger:r.v2.completedTrades.map(t=>[
      t.asset,t.entryUTC,t.exitUTC,t.hoursHeld,t.exitAction,t.exitReason,
      Number(t.netPnLVirtual.toFixed(3)),Number(t.netReturnPct.toFixed(3)),
      Number(t.estimatedTotalCostsVirtual.toFixed(3))]),
    caveats:'Simulacao educativa. Taxas estimadas. O valor R$ é unidade contabil ilustrativa sem USD/BRL. Backtest nao comprova lucro futuro; limites de perdas podem ser excedidos por gaps.'
  };
}
function publish(){
  const data=makeReport();
  if(!data)return $('v2ReportStatus').textContent='Rode uma simulação primeiro.';
  const title='[Rotation Lab V2] '+(source==='demo'?'DEMO':'BINANCE')+' · '+data.createdAtUTC.slice(0,16);
  const body='Relatório voluntário do Rotation Lab V2 (capital virtual, sem ordens reais).\n'+
    'Fonte: '+data.marketData+' · Operações encerradas: '+data.tradeDiagnostics.closedCount+
    ' · Prejuízos: '+data.tradeDiagnostics.losing+'\n\n'+JSON.stringify(data);
  $('v2ReportStatus').textContent='Abrindo GitHub. Revise e toque em Submit new issue para enviar o relatório.';
  const url='https://github.com/veloraspaces0/rotation-lab-v1/issues/new?title='+
    encodeURIComponent(title)+'&body='+encodeURIComponent(body);
  if(url.length>8500){
    $('v2ReportStatus').textContent='Relatório longo demais para preencher via link. Toque em Copiar relatório e cole na descrição de uma nova issue no GitHub.';
    return;
  }
  window.location.assign(url);
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
$('v2CsvBtn').addEventListener('click',csvTrades);
window.addEventListener('rotation-lab-v2-data',e=>analyze(e.detail.data,e.detail.p,e.detail.source));
window.addEventListener('resize',()=>{if(latest)drawChart(latest)});
if(window.RotationLabV1?.run)window.RotationLabV1.run();
})();
