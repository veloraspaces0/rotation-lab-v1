/* Rotation Lab V1: compartilhar resultados voluntariamente via GitHub */
'use strict';
(function(){
const $=x=>document.getElementById(x),base='https://github.com/veloraspaces0/rotation-lab-v1/issues/new';
const round=(v,n=3)=>Number(Number(v).toFixed(n));
let report=null;
const el=document.createElement('section');
el.className='panel';el.style.marginTop='16px';
el.innerHTML=[
'<div class="section-id">02 / RELATÓRIOS</div>',
'<h2 class="panel-title" style="margin-top:6px">Resultados no GitHub</h2>',
'<p class="panel-desc">Compartilhe seus testes sem enviar prints. Não depende de servidores de sincronização externos.</p>',
'<div class="status" id="shareStatus" role="status">Preparando relatório...</div>',
'<div class="header-actions" style="margin-top:12px;gap:8px">',
'<button class="button primary" type="button" id="shareGitHub">Enviar resultado ao GitHub</button>',
'<button class="button outline" type="button" id="shareCopy">Copiar resultado</button>',
'</div>',
'<p class="hint" style="margin-top:12px">Ao tocar em <strong>Enviar resultado ao GitHub</strong>, confirme em <strong>Submit new issue</strong>. ',
'Depois poderei consultar o resultado diretamente no repositório conectado, sem prints. É necessário confirmar cada novo relatório; não é sincronização automática.</p>',
'<p class="hint" style="margin-top:8px">Dados somente virtuais, mas públicos no GitHub. ',
'Se o app GitHub não preencher a descrição, toque em Copiar resultado para colá-la manualmente.</p>'
].join('');
const settings=$('runStatus')?.closest('section');if(!settings)return;
settings.insertAdjacentElement('afterend',el);
const status=s=>$('shareStatus').textContent=s;
const stats=x=>({finalVirtualBRL:round(x.final,2),returnPct:round(x.return),
maxDrawdownPct:x.maxDD==null?null:round(x.maxDD),swaps:x.swaps??null,
closedTrades:x.closed??null,winningTrades:x.wins??null,
estimatedFees:x.fees==null?null:round(x.fees)});
function build(d){
const p=d.p;
return {application:'Rotation Lab V1',kind:'Backtest with virtual capital only',
reportedAt:new Date().toISOString(),
source:d.source==='demo'?'DEMO FICTICIO':'Binance historico publico',
mode:d.mode,periodUTC:{from:d.startUTC,to:d.endUTC,candles:d.candles,intervalHours:4},
settings:{virtualCapitalBRL:p.capital,targetPct:round(p.target*100),stopPct:round(p.stop*100),
lookbackCandles:p.lookback,rotationGap:p.gap,feePct:round(p.fee*100),
slippagePct:round(p.slip*100),minOrderVirtualBRL:p.minOrder},
performance:{rotativo:stats(d.rot),conservador:stats(d.con),holdBTC:stats(d.hold)},
recentSimulatedOrders:d.active.trades.slice(-8).map(t=>({timeUTC:new Date(t.t).toISOString(),
action:t.action,asset:t.s,reason:t.reason,pnlVirtual:t.pl==null?null:round(t.pl,2)}))};
}
function publish(){
if(!report)return status('Rode a simulação primeiro.');
const title='[Rotation Lab] '+report.mode+' '+report.source+' '+report.reportedAt.slice(0,16);
const body=['Rotation Lab V1 - relatório voluntário de teste com capital virtual.',
'Fonte: '+report.source,JSON.stringify(report,null,2)].join('\n\n');
const uri=base+'?title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
window.location.assign(uri);
}
async function copy(){
if(!report)return status('Rode a simulação primeiro.');
try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));
status('Relatório copiado. Cole aqui no chat ou na descrição do GitHub.')}
catch(e){const area=document.createElement('textarea');area.value=JSON.stringify(report,null,2);
area.style.width='100%';area.style.minHeight='120px';el.appendChild(area);area.select();
status('Selecione e copie o texto no campo abaixo.')}
}
$('shareGitHub').addEventListener('click',publish);
$('shareCopy').addEventListener('click',copy);
window.addEventListener('rotation-lab-results',e=>{
report=build(e.detail);
const p=report.performance;
status(report.source+' · Rotativo '+p.rotativo.returnPct+'% · Conservador '+p.conservador.returnPct+'% · Manter BTC '+p.holdBTC.returnPct+'%.');
});
if(window.RotationLabV1?.run)window.RotationLabV1.run();
})();
