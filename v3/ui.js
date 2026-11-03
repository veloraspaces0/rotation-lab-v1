/* Rotation Lab V3 - browser-only interface, no trading integration */
(function(){
'use strict';
const $=id=>document.getElementById(id),formatMoney=x=>Number(x).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),
  signed=x=>(x>0?'+':'')+Number(x).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%',
  num=x=>Number(x).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),
  day=x=>new Date(x).toLocaleDateString('pt-BR',{timeZone:'UTC'}),
  moment=x=>new Date(x).toLocaleString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' UTC',
  esc=x=>String(x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const names={v3:'V3 · Confirmação + volatilidade',v2:'V2 · Defesa',v1Rotativo:'V1 · Rotativo',v1Conservador:'V1 · Conservador',btc:'Comprar e manter BTC',cash:'Ficar 100% em caixa'};
let report=null,marketSource='demo',params=null;
function tone(value){
  return '<span class="'+(value<0?'v2-down':value>0?'v2-up':'')+'">'+signed(value)+'</span>';
}
function drawTable(r){
  $('v3CompareBody').innerHTML=Object.keys(names).map(key=>{
    const m=r.metrics[key];
    return '<tr'+(key==='v3'?' class="v2-main-row"':'')+'><th scope="row">'+esc(names[key])+
      '</th><td>'+tone(m.full.returnPct)+'</td><td>'+tone(m.first60.returnPct)+
      '</td><td>'+tone(m.final40.returnPct)+'</td><td>'+num(m.full.maxDDPct)+'%</td></tr>';
  }).join('');
}
function diagnostics(r){
  const ledger=r.v3.ledger;
  const byReason={},byCoin={};
  for(const t of ledger){
    let reason=t.exitAction==='STOP'?'Stop por volatilidade':
      t.exitAction==='CIRCUIT'?'Freio da carteira':
      t.exitAction==='TARGET'?'Meta de lucro':'Perda de tendência';
    if(!byReason[reason])byReason[reason]={count:0,pnl:0};
    byReason[reason].count++;byReason[reason].pnl+=t.netPnLVirtual;
    if(!byCoin[t.symbol])byCoin[t.symbol]={count:0,pnl:0};
    byCoin[t.symbol].count++;byCoin[t.symbol].pnl+=t.netPnLVirtual;
  }
  const sum=ledger.reduce((a,t)=>a+t.netPnLVirtual,0);
  const winners=ledger.filter(t=>t.netPnLVirtual>=0).length;
  $('v3Diagnostics').textContent=r.v3.closed+' saídas · '+winners+' vencedoras · '+(r.v3.closed-winners)+
    ' perdedoras · Custos estimados '+formatMoney(r.v3.fees)+' · P&L realizado '+formatMoney(sum)+
    ' · '+(r.v3.hardHalt?'Circuito acionado: '+r.v3.haltReason:'Circuito não acionado')+
    ' · Sinais bloqueados pelo mínimo de ordem: '+r.v3.rejectedByMin+'.';
  $('v3Reasons').textContent='Por motivo: '+(Object.entries(byReason).map(([k,v])=>k+
    ' '+v.count+'× ('+formatMoney(v.pnl)+')').join(' · ')||'nenhum')+
    '. Por moeda: '+(Object.entries(byCoin).map(([k,v])=>k+' '+v.count+'× ('+
      formatMoney(v.pnl)+')').join(' · ')||'nenhum')+'.';
  $('v3Orders').innerHTML=ledger.length?ledger.map((t,i)=>
    '<tr><td>'+String(i+1)+' · '+esc(t.symbol)+'</td>'+
    '<td>'+moment(t.enteredUTC)+'</td><td>'+moment(t.exitUTC)+'</td>'+
    '<td>'+t.heldHours+'h</td><td>'+esc(t.exitReason)+'</td>'+
    '<td class="'+(t.netPnLVirtual<0?'v2-down':'v2-up')+'">'+formatMoney(t.netPnLVirtual)+'</td>'+
    '<td class="'+(t.netReturnPct<0?'v2-down':'v2-up')+'">'+signed(t.netReturnPct)+'</td></tr>').join(''):
    '<tr><td colspan="7">Nenhuma posição encerrada nessa simulação.</td></tr>';
  $('v3Open').textContent=r.v3.open?
    'Posição ainda aberta: '+r.v3.open.symbol+'. Seu resultado não está somado ao P&L das saídas encerradas.':
    'Nenhuma posição aberta no último candle.';
  return {byReason,byCoin,sum,winners};
}
function draw(r){
  const canvas=$('v3Chart'),w=Math.max(320,canvas.parentElement.clientWidth-22),
    h=260,dpr=Math.min(3,window.devicePixelRatio||1);
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  canvas.style.width=w+'px';canvas.style.height=h+'px';
  const ctx=canvas.getContext('2d');if(!ctx)return;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const list=Object.values(r.curves).flat(),lo=Math.min(...list),hi=Math.max(...list);
  const pad=Math.max(1,(hi-lo)*.13),min=lo-pad,max=hi+pad;
  const left=45,right=w-10,top=16,bottom=h-32;
  const x=i=>left+(right-left)*i/(r.curves.v3.length-1);
  const y=v=>bottom-(bottom-top)*(v-min)/(max-min);
  ctx.font='11px sans-serif';ctx.fillStyle='#8dabb8';
  for(let j=0;j<=4;j++){
    const value=min+(max-min)*j/4,level=y(value);
    ctx.strokeStyle='#2b414b';ctx.lineWidth=.65;ctx.beginPath();
    ctx.moveTo(left,level);ctx.lineTo(right,level);ctx.stroke();
    ctx.fillText('R$'+Math.round(value),2,level+4);
  }
  const xx=x(r.split);
  ctx.fillStyle='rgba(122,167,255,.07)';ctx.fillRect(xx,top,right-xx,bottom-top);
  ctx.strokeStyle='#cbb574';ctx.setLineDash([5,4]);ctx.beginPath();
  ctx.moveTo(xx,top);ctx.lineTo(xx,bottom);ctx.stroke();ctx.setLineDash([]);
  const colors={cash:'#f3cf76',btc:'#77bbf0',v1Rotativo:'#d69b80',
    v1Conservador:'#bba9fc',v2:'#6de0b0',v3:'#fafafa'};
  for(const key of ['v1Rotativo','v1Conservador','btc','cash','v2','v3']){
    ctx.strokeStyle=colors[key];ctx.lineWidth=key==='v3'?3:1.5;
    ctx.beginPath();
    r.curves[key].forEach((value,i)=>i?ctx.lineTo(x(i),y(value)):ctx.moveTo(x(i),y(value)));
    ctx.stroke();
  }
  ctx.fillStyle='#a9bfca';ctx.fillText(day(r.period.from),left,bottom+18);
  const end=day(r.period.to);ctx.fillText(end,right-ctx.measureText(end).width,bottom+18);
}
function refresh(data,p,source){
  marketSource=source;params=p;
  try{
    const result=window.RotationLabV3Engine.evaluate(data,p,window.RotationLabV1,window.RotationLabV2Engine);
    report=result;
    $('v3Final').textContent=formatMoney(result.v3.final);
    $('v3Return').textContent=signed(result.metrics.v3.full.returnPct);
    $('v3Return').className='v2-value '+(result.metrics.v3.full.returnPct>=0?'v2-up':'v2-down');
    $('v3DD').textContent='−'+num(result.v3.maxDD)+'%';
    $('v3VsCash').textContent=signed(result.metrics.v3.full.returnPct-result.metrics.cash.full.returnPct);
    $('v3Source').textContent=source==='demo'?
      'DADOS FICTÍCIOS · sem significado financeiro':
      'BINANCE · histórico público de preços';
    $('v3Source').className='v2-source '+(source==='demo'?'v2-warning':'v2-live');
    $('v3Period').textContent=day(result.period.from)+' — '+day(result.period.to)+
      ' · divisão ilustrativa em '+day(result.period.splitAt)+
      ' · '+result.curves.v3.length+' candles 4H.';
    drawTable(result);diagnostics(result);draw(result);
    $('v3Status').textContent='Comparação concluída. '+(result.v3.signals||0)+
      ' sinais candidatos; '+result.v3.closed+' posições fechadas.'+
      (result.v3.hardHalt?' Filtro de segurança interrompeu novas compras.':'');
  }catch(e){report=null;$('v3Status').textContent='Erro no teste V3: '+String(e.message||e)}
}
function pack(){
  if(!report)return null;
  const r=report;
  const res={};for(const key of Object.keys(names)){
    const o=r.metrics[key];res[key]={
      full:Number(o.full.returnPct.toFixed(3)),
      initial60:Number(o.first60.returnPct.toFixed(3)),
      last40:Number(o.final40.returnPct.toFixed(3)),
      maxDD:Number(o.full.maxDDPct.toFixed(3))};
  }
  const byReason={},byCoin={};
  for(const t of r.v3.ledger){
    const reason=t.exitAction;
    byReason[reason]??={n:0,pnl:0};byReason[reason].n++;byReason[reason].pnl+=t.netPnLVirtual;
    byCoin[t.symbol]??={n:0,pnl:0};byCoin[t.symbol].n++;byCoin[t.symbol].pnl+=t.netPnLVirtual;
  }
  const compress=d=>Object.fromEntries(Object.entries(d).map(([k,v])=>[k,{n:v.n,pnl:Number(v.pnl.toFixed(3))}]));
  const trades=r.v3.ledger.map(t=>[t.symbol,t.enteredUTC.slice(0,16),t.exitUTC.slice(0,16),
    t.heldHours,t.exitAction,Number(t.netPnLVirtual.toFixed(3)),Number(t.netReturnPct.toFixed(3)),
    Number(t.stopPct.toFixed(2))]);
  return {project:'Rotation Lab V3',dateUTC:new Date().toISOString(),
    source:marketSource==='demo'?'DEMO FICTICIO':'Binance historico publico',
    disclaimer:'Simulador sem dinheiro real. Os 40% finais nao sao validacao independente: conhecimos esse periodo antes de criar a V3.',
    capitalVirtualBRL:params.capital,period:{from:new Date(r.period.from).toISOString(),
      to:new Date(r.period.to).toISOString(),split:new Date(r.period.splitAt).toISOString(),
      candles:r.curves.v3.length},feesPerSidePct:params.fee*100,slippagePct:params.slip*100,
    minOrderVirtualBRL:params.minOrder,rules:r.v3.cfg,results:res,
    V3:{closed:r.v3.closed,wins:r.v3.wins,feesVirtual:Number(r.v3.fees.toFixed(3)),
      blockedSignals:r.v3.rejectedByMin,hardHalt:r.v3.hardHalt,haltReason:r.v3.haltReason,
      peakExposurePct:Number(r.v3.maxExposure.toFixed(2)),reasons:compress(byReason),
      byAsset:compress(byCoin),openAsset:r.v3.open?.symbol||null},
    tradeColumns:['asset','entryUTC','exitUTC','hours','exitType','pnlVirtual','netPct','stopPct'],
    trades};
}
function publish(){
  const summary=pack();if(!summary)return $('v3ReportStatus').textContent='Rode a simulação primeiro.';
  const title='[Rotation Lab V3] '+(marketSource==='demo'?'DEMO':'BINANCE')+' · '+summary.dateUTC.slice(0,16);
  const base='Relatório de simulação virtual Rotation Lab V3. Sem ordens reais.\n';
  let payload=summary;
  let content=base+JSON.stringify(payload);
  let link='https://github.com/veloraspaces0/rotation-lab-v1/issues/new?title='+
    encodeURIComponent(title)+'&body='+encodeURIComponent(content);
  // Keep a useful loss sample and aggregated totals if the URL would be too long for mobile.
  if(link.length>8200){
    payload={...summary,trades:[...summary.trades].sort((a,b)=>a[5]-b[5]).slice(0,15),
      tradeSubsetNote:'Inclui até 15 piores resultados; tabela completa no CSV do aplicativo.'};
    content=base+JSON.stringify(payload);
    link='https://github.com/veloraspaces0/rotation-lab-v1/issues/new?title='+
      encodeURIComponent(title)+'&body='+encodeURIComponent(content);
  }
  if(link.length>8200)return $('v3ReportStatus').textContent='Relatório extenso. Use Copiar relatório e cole no campo da issue.';
  $('v3ReportStatus').textContent='No GitHub, confirme em Submit new issue. O relatório ficará público.';
  window.location.assign(link);
}
async function copy(){
  const obj=pack();if(!obj)return;
  try{await navigator.clipboard.writeText(JSON.stringify(obj,null,2));
    $('v3ReportStatus').textContent='Relatório copiado para colar no GitHub.';}
  catch(e){$('v3ReportStatus').textContent='Cópia não disponível neste navegador.';}
}
function csv(){
  if(!report)return;
  const r=report.v3;
  const table=[['asset','entryUTC','exitUTC','entryPriceUSDT','exitPriceUSDT',
    'durationHours','stopPct','reason','netPnlVirtual','netReturnPct','costVirtual']];
  for(const t of r.ledger)table.push([t.symbol,t.enteredUTC,t.exitUTC,t.entryPrice,t.exitPrice,
    t.heldHours,t.stopPct,t.exitReason,t.netPnLVirtual,t.netReturnPct,t.costsVirtual]);
  const val='\uFEFF'+table.map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\r\n');
  const u=URL.createObjectURL(new Blob([val],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=u;a.download='rotation_lab_v3_trade_ledger.csv';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),2000);
  $('v3ReportStatus').textContent='CSV das operações preparado.';
}
$('v3GitHub').addEventListener('click',publish);
$('v3Copy').addEventListener('click',copy);
$('v3Csv').addEventListener('click',csv);
window.addEventListener('rotation-lab-v3-data',e=>refresh(e.detail.data,e.detail.p,e.detail.source));
window.addEventListener('resize',()=>{if(report)draw(report)});
if(window.RotationLabV1?.run)window.RotationLabV1.run();
})();
