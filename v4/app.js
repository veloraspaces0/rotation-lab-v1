/* Rotation Lab V4 — read-only dashboard for GitHub-committed paper-forward events. */
(function(){
'use strict';
const REPO='veloraspaces0/rotation-lab-v1';
const API='https://api.github.com/repos/'+REPO+'/contents/v4/state.json?ref=main';
const RAW='https://raw.githubusercontent.com/'+REPO+'/main/v4/state.json';
const $=id=>document.getElementById(id);
const cash=x=>Number(x).toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2});
const pct=x=>(x>0?'+':'')+Number(x).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
const localeUTC=x=>new Date(x).toLocaleString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' UTC';
let current=null,busy=false,loadedAt=null;
function error(msg){
  $('stateStatus').textContent=msg;
  $('stateStatus').className='statusline bad';
  $('refreshBtn').disabled=false;
  $('updateInfo').textContent='Uma falha de rede não altera o histórico nem cria operações. Verifique o GitHub Actions.';
}
async function dataFromGitHub(){
  let err;
  try{
    const r=await fetch(API+'&cache='+Date.now(),{
      cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
    if(!r.ok)throw Error('GitHub Contents HTTP '+r.status);
    const j=await r.json();
    if(j.encoding!=='base64'||!j.content)throw Error('Conteúdo JSON não disponível');
    const bytes=Uint8Array.from(atob(j.content.replace(/\s/g,'')),c=>c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }catch(e){err=e}
  try{
    const r=await fetch(RAW+'?v='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw Error('GitHub RAW HTTP '+r.status);
    return await r.json();
  }catch(e){throw Error('Não foi possível consultar o estado. API: '+err.message+' / RAW: '+e.message)}
}
async function sha256(s){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
async function audit(state){
  if(!state||state.schema!==1||!Array.isArray(state.events))throw Error('Formato de relatório inesperado');
  let previous='GENESIS';
  for(let i=0;i<state.events.length;i++){
    const e=state.events[i];
    if(e.seq!==i+1||e.prevHash!==previous)
      throw Error('Sequência inválida no evento '+(i+1));
    const input=JSON.stringify({seq:e.seq,prevHash:e.prevHash,
      type:e.type,recordedAtUTC:e.recordedAtUTC,candleOpenMs:e.candleOpenMs,payload:e.payload});
    if(await sha256(input)!==e.hash)throw Error('Hash SHA-256 inválido no evento '+(i+1));
    if(i&&e.candleOpenMs<=state.events[i-1].candleOpenMs)
      throw Error('Horário de candle duplicado ou retroativo');
    previous=e.hash;
  }
  if(state.events.length&&state.events[0].type!=='BASELINE')throw Error('Registro inicial inválido');
  return true;
}
const esc=x=>String(x).replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
function colorize(id,value){
  const el=$(id);
  el.classList.remove('up','down');
  if(value>0)el.classList.add('up');
  if(value<0)el.classList.add('down');
}
function metrics(state){
  const events=state.events,capital=state.config?.initialCapitalVirtual||50;
  $('cash').textContent=cash(capital);
  $('eventCount').textContent=events.length+' '+(events.length===1?'evento':'eventos');
  if(!events.length){
    $('equity').textContent=cash(capital);
    $('equityReturn').textContent='Sem observações · aguardando marco inicial';
    $('btc').textContent='—';
    $('btcReturn').textContent='Sem referência BTC inicial';
    $('drawdown').textContent='—';
    $('tradeCount').textContent='0 saídas';
    $('eventTime').textContent='Ainda não iniciado';
    $('lastDecision').textContent='Aguardando a primeira execução bem-sucedida no GitHub Actions.';
    $('position').textContent='Sem posição.';
    $('eventRows').innerHTML='<tr><td colspan="5">Sem registros ainda. Ative o workflow no GitHub Actions: a primeira execução criará somente o marco inicial.</td></tr>';
    $('stateStatus').className='statusline';
    $('stateStatus').textContent='Aguardando ativação da V4. Nenhuma operação virtual foi executada.';
    $('auditStatus').className='statusline';
    $('auditStatus').textContent='Estado inicial vazio: sem eventos para validar.';
    $('updateInfo').textContent='Última consulta ao GitHub: '+localeUTC(new Date().toISOString())+'.';
    draw(state);
    return;
  }
  const last=events.at(-1),a=last.payload.account;
  const gain=100*(a.equityVirtual/capital-1),btcGain=100*(a.btcBenchmarkVirtual/capital-1);
  $('equity').textContent=cash(a.equityVirtual);
  $('equityReturn').textContent=pct(gain)+' desde a ativação, já com custos';
  $('btc').textContent=cash(a.btcBenchmarkVirtual);
  $('btcReturn').textContent=pct(btcGain)+' incluindo custos estimados de ida/volta';
  $('drawdown').textContent=pct(Math.min(0,100*(a.equityVirtual/a.peakEquity-1)));
  colorize('equity',gain);colorize('btc',btcGain);
  const orders=events.filter(e=>e.type==='EVALUATION'&&e.payload.action.type.startsWith('SELL'));
  $('tradeCount').textContent=orders.length+' '+(orders.length===1?'saída':'saídas');
  $('eventTime').textContent=localeUTC(last.recordedAtUTC);
  const action=last.payload.action;
  $('lastDecision').textContent=last.type==='BASELINE'?
    'Marco inicial registrado. Nenhuma compra retroativa. Aguardando o próximo candle de 4 horas.':
    (action.type+(action.asset?' · '+action.asset:'')+' — '+action.reason+
      (last.payload.missedCandles>0?' · '+last.payload.missedCandles+' candle(s) sem avaliação retroativa.':''));
  $('position').textContent=a.hardHalt?
    'PROTEÇÃO ATIVADA — sem novas entradas neste experimento. Posição: '+(a.position||'caixa')+'.':
    a.position?(a.position+' · '+cash(a.investedVirtual)+' inicialmente aplicado; saldo em caixa '+cash(a.cash)+'.'):
    '100% em caixa virtual. Aguardando sinal confirmado.';
  const elapsed=(Date.now()-Date.parse(last.recordedAtUTC))/3600000;
  const fresh=elapsed<10;
  $('stateStatus').className='statusline '+(fresh?'good':'bad');
  $('stateStatus').textContent=a.hardHalt?
    'Freio de carteira ativado. A estratégia interrompeu novas compras. Registro auditável disponível.':
    ('Registro '+last.seq+' consultado do GitHub. '+(fresh?'Dados recentes.':
      'Última execução antiga; verifique se o workflow continua funcionando.'));
  $('updateInfo').textContent='Última execução registrada: '+localeUTC(last.recordedAtUTC)+
    ' · candle fechado: '+localeUTC(last.candleOpenMs+4*3600000)+
    ' · consulta do painel: '+localeUTC(new Date().toISOString())+
    '. As execuções podem atrasar.';
  $('auditStatus').className='statusline good';
  $('auditStatus').textContent='✓ Sequência e hashes SHA-256 verificados localmente ('+events.length+
    ' eventos). A cadeia detecta alterações, mas não é assinatura independente; confira os commits no GitHub.';
  const recent=[...events].reverse().slice(0,25);
  $('eventRows').innerHTML=recent.map(e=>{
    const p=e.payload,a=p.account,act=p.action||{type:'BASELINE',reason:'Início prospectivo; nenhuma ordem'};
    const note=act.reason+(p.missedCandles>0?
      ' · Pularam '+p.missedCandles+' candle(s) sem simular execução retroativa':'');
    return '<tr><td>'+esc(localeUTC(e.recordedAtUTC))+'</td>'+
      '<td><strong>'+esc(act.type)+'</strong>'+(act.asset?' · '+esc(act.asset):'')+'</td>'+
      '<td>'+cash(a.equityVirtual)+'</td><td>'+cash(a.btcBenchmarkVirtual)+'</td>'+
      '<td>'+esc(note)+'</td></tr>';
  }).join('');
  draw(state);
}
function draw(state){
  const canvas=$('equityChart'),width=Math.max(290,canvas.parentElement.clientWidth-20),height=280;
  const ratio=Math.min(3,window.devicePixelRatio||1);
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  canvas.style.width=width+'px';canvas.style.height=height+'px';
  const ctx=canvas.getContext('2d');if(!ctx)return;
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,width,height);
  const series=state.events.map(e=>e.payload.account);
  const capital=state.config?.initialCapitalVirtual||50;
  const total=series.length, values=series.flatMap(a=>[
    a.equityVirtual,a.btcBenchmarkVirtual,a.cashBenchmarkVirtual]);
  const min0=Math.min(...values,capital),max0=Math.max(...values,capital);
  const pad=Math.max(.5,(max0-min0)*.2),min=min0-pad,max=max0+pad;
  const x0=44,x1=width-10,y0=10,y1=height-30;
  const x=i=>x0+(total<=1?.5:i/(total-1))*(x1-x0);
  const y=v=>y1-(v-min)/(max-min)*(y1-y0);
  ctx.font='11px sans-serif';
  for(let j=0;j<5;j++){
    const v=min+(max-min)*j/4, yy=y(v);
    ctx.beginPath();ctx.strokeStyle='#29414d';ctx.lineWidth=.6;
    ctx.moveTo(x0,yy);ctx.lineTo(x1,yy);ctx.stroke();
    ctx.fillStyle='#a3b6c2';ctx.fillText('R$'+v.toFixed(0),2,yy+4);
  }
  const lines=[
    {field:'cashBenchmarkVirtual',stroke:'#f4c778'},
    {field:'btcBenchmarkVirtual',stroke:'#7daffa'},
    {field:'equityVirtual',stroke:'#66e4b6'}
  ];
  if(total){
    for(const line of lines){
      ctx.beginPath();ctx.strokeStyle=line.stroke;ctx.fillStyle=line.stroke;
      ctx.lineWidth=line.field==='equityVirtual'?2.8:1.7;
      series.forEach((a,i)=>i?ctx.lineTo(x(i),y(a[line.field])):ctx.moveTo(x(i),y(a[line.field])));
      if(total===1){ctx.arc(x(0),y(series[0][line.field]),3,0,Math.PI*2);ctx.fill()}
      else ctx.stroke();
    }
  }else{
    ctx.fillStyle='#a3b6c2';ctx.fillText('Aguardando o primeiro evento do GitHub Actions...',x0+12,height/2);
  }
  if(total){
    ctx.fillStyle='#a3b6c2';
    const date=state.events.at(-1).recordedAtUTC.slice(0,10);
    ctx.fillText('Último '+date,x0,y1+20);
  }
}
async function update(){
  if(busy)return;
  busy=true;$('refreshBtn').disabled=true;
  $('stateStatus').className='statusline';
  $('stateStatus').textContent='Consultando registro público do GitHub e verificando os hashes...';
  try{
    const s=await dataFromGitHub();
    if(!window.crypto?.subtle)throw Error('Este navegador não permite verificar SHA-256 em conexão segura');
    await audit(s);
    current=s;loadedAt=Date.now();
    metrics(s);
  }catch(e){error('Falha ao consultar/validar histórico: '+e.message)}
  finally{busy=false;$('refreshBtn').disabled=false}
}
$('refreshBtn').addEventListener('click',update);
window.addEventListener('resize',()=>{if(current)draw(current)});
update();
})();
