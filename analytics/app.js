/* Rotation Lab Analytics UI — read-only GitHub data; no exchange credentials. */
(function(){
'use strict';
const A=window.RotationLabAnalytics;
const $=id=>document.getElementById(id);
const fmtBR=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2,minimumFractionDigits:2});
const money=v=>Number.isFinite(v)?'R$ '+fmtBR.format(v):'—';
const percent=(v,sign=false)=>Number.isFinite(v)?(sign&&v>0?'+':'')+fmtBR.format(v)+'%':'—';
const integer=v=>new Intl.NumberFormat('pt-BR').format(v||0);
const when=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const API='https://api.github.com/repos/veloraspaces0/rotation-lab-v1/contents/v4-1/state.json?ref=main';
const RAW='https://raw.githubusercontent.com/veloraspaces0/rotation-lab-v1/main/v4-1/state.json';
let context=null,mode='liquidated',horizon=6;
async function fetchState(){
  const cache='t='+Date.now();
  try{
    const response=await fetch(RAW+'?'+cache,{cache:'no-store'});
    if(!response.ok)throw Error('RAW HTTP '+response.status);
    const value=await response.json();
    if(value?.schema!==1)throw Error('Formato inválido');
    return value;
  }catch(rawError){
    const response=await fetch(API+'&'+cache,{cache:'no-store',
      headers:{Accept:'application/vnd.github+json'}});
    if(!response.ok)throw Error('GitHub indisponível (RAW e API). '+rawError.message);
    const file=await response.json();
    if(!file.content)throw Error('Arquivo grande demais para API; falha no acesso RAW');
    const text=decodeURIComponent(Array.from(atob(file.content.replace(/\s/g,'')),
      c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join(''));
    return JSON.parse(text);
  }
}
async function digest(text){
  if(!window.crypto?.subtle)throw Error('Este navegador não suporta Web Crypto (SHA-256).');
  const data=new TextEncoder().encode(text);
  const output=await window.crypto.subtle.digest('SHA-256',data);
  return Array.from(new Uint8Array(output),b=>b.toString(16).padStart(2,'0')).join('');
}
function indicator(id,value){$(id).textContent=value}
function paintSigned(id,value){const el=$(id);el.textContent=percent(value,true);
 el.classList.remove('positive','negative','na');
 el.classList.add(value==null?'na':value>=0?'positive':'negative');
}
function renderHeader(state,research){
  const ev=state.events||[];
  indicator('totalEvents',integer(ev.length));
  indicator('totalSignals',integer(research.emittedSignals));
  indicator('totalSelected',integer(research.selectedOrigins));
  indicator('totalRecovered',integer(research.recovered));
  indicator('missingBars',integer(research.missingCandles));
  indicator('unavailableResults',integer(research.unavailable));
  indicator('nativeMismatches',integer(research.mismatches));
  indicator('updatedAt','Consultado: '+when(new Date()));
  indicator('sampleWindow',ev.length?'Desde '+when(ev[0].recordedAtUTC):'Ainda sem marco inicial');
  const last=ev.at(-1);
  const older=last&&Date.now()-Date.parse(last.recordedAtUTC)>9*3600000;
  indicator('statusLabel',!ev.length?'Sem observações':ev.length===1?'Somente marco inicial':older?'Sem registro recente':'Histórico prospectivo disponível');
  indicator('auditedEvents',integer(ev.length));
  indicator('firstRecord',when(ev[0]?.recordedAtUTC));
  indicator('lastRecord',when(last?.recordedAtUTC));
  indicator('frozenHash',ev[0]?.payload?.coreHash?.slice(0,13)+'…'||'—');
}

/* V1.1: risk, halt, and realized P&L use only signed V4.1 event history. */
function renderRisk(state){
  const portfolio=A.portfolioRisk(state),stats=A.tradeStatistics(state),
    model=A.riskRewardConfig(state.config);
  indicator('tradeCount',integer(stats.closed));
  indicator('tradeSummary',stats.closed?
    integer(stats.winners)+' vitória(s) · '+integer(stats.losers)+' perda(s) · '+
      integer(stats.flat)+' empate(s)':
    'Nenhuma operação virtual encerrada');
  indicator('winRate',percent(stats.winRatePct));
  indicator('avgWin',percent(stats.averageWinPct,true));
  indicator('avgLoss',percent(stats.averageLossPct,true));
  indicator('payoff',Number.isFinite(stats.payoff)?fmtBR.format(stats.payoff)+'×':'—');
  paintSigned('expectancy',stats.expectancyPct);
  const pnl=$('totalPnL');
  pnl.textContent=money(stats.totalRealizedPnLVirtual);
  pnl.classList.remove('positive','negative','na');
  pnl.classList.add(stats.closed===0?'na':stats.totalRealizedPnLVirtual>=0?'positive':'negative');
  const caveats=[];
  if(stats.closed===0)caveats.push('Ainda não houve operações virtuais encerradas. Não é possível calcular acerto, payoff ou expectativa.');
  else if(stats.insufficientSample)caveats.push('Apenas '+stats.closed+' operação(ões): estatísticas descritivas, amostra pequena demais para avaliar vantagem.');
  else caveats.push('Estatísticas descritivas das operações realizadas, não previsão de resultados futuros.');
  if(stats.malformed)caveats.push(stats.malformed+' fechamento(s) com dados inválidos foram excluídos.');
  if(stats.differenceFromAccount!=null&&stats.differenceFromAccount!==0)
    caveats.push('ATENÇÃO: contagem da conta diverge em '+stats.differenceFromAccount+' fechamento(s).');
  caveats.push('A expectativa percentual usa retorno médio sobre o capital comprometido em cada operação, não sobre o saldo total.');
  indicator('tradeSampleNote',caveats.join(' '));
  indicator('currentDrawdown',percent(portfolio.currentDrawdownPct));
  indicator('worstDrawdown',percent(portfolio.maxObservedDrawdownPct));
  indicator('peakEquity',money(portfolio.peakEquity));
  indicator('underwaterNow',integer(portfolio.currentUnderwaterBars));
  indicator('underwaterLongest',integer(portfolio.longestUnderwaterBars));
  indicator('underwaterTotal',integer(portfolio.underwaterObservedBars));
  indicator('riskMissing',integer(portfolio.unobservedBars));
  indicator('drawdownNote','Cada candle representa 4h de observação e não negociação contínua. A sequência atual equivale a '+
    integer(portfolio.currentUnderwaterBars*4)+' horas de candles consecutivos abaixo do pico. '+
    (portfolio.unobservedBars?'Houve '+integer(portfolio.unobservedBars)+
      ' candle(s) sem registro; a duração nesses intervalos é desconhecida.':
      'Nenhuma lacuna detectada entre as avaliações registradas.')+
    ' O drawdown reflete os snapshots publicados, não os extremos intrabar.');
  const fmt=n=>Number.isFinite(n)?fmtBR.format(n):'—';
  indicator('riskModelNote','Configuração congelada: alvo teórico +'+fmt(model.takeProfitPct)+
    '%, stop entre −'+fmt(model.minimumStopPct)+'% e −'+fmt(model.maximumStopPct)+
    '%. Se toda operação terminasse exatamente no alvo ou stop, a taxa de acerto de equilíbrio seria de '+
    fmt(model.breakEvenAtMinimumStopPct)+'% a '+fmt(model.breakEvenAtMaximumStopPct)+
    '%. Isso NÃO é uma previsão; saídas reais do simulador podem ocorrer em outros preços.');
  const banner=$('haltBanner');
  banner.hidden=!portfolio.halted;
  if(portfolio.halted){
    indicator('statusLabel','Carteira bloqueada pelo freio');
    indicator('haltMessage','O primeiro freio permanente ocorreu no evento #'+portfolio.firstHaltSeq+
      ' ('+when(portfolio.firstHaltAtUTC)+'). Nenhuma nova compra virtual é permitida neste experimento. '+
      'Após o freio, '+integer(portfolio.shadowEventsAfterHalt)+
      ' avaliação(ões) com registro-sombra foram gravadas. O registro-sombra pode continuar, sujeito a novas coletas.');
  }
}

function renderStudy(research){
  const report=A.summarize(research,horizon);
  paintSigned('eligibleDelta',report.deltaEligible);
  paintSigned('selectedDelta',report.deltaSelected);
  paintSigned('eligibleMean',report.eligibleMean);
  paintSigned('allMean',report.allMean);
  indicator('eligibleCount',integer(report.eligibleCount));
  indicator('pairedOrigins',integer(report.eligibleCI.origins));
  indicator('temporalBlocks',integer(report.eligibleCI.blocks));
  const result=report.eligibleCI;
  const ci=result.ci?('IC 90% por blocos: '+percent(result.ci[0],true)+' a '+percent(result.ci[1],true)):
    'IC 90%: ainda não estimável com a amostra disponível';
  indicator('eligibleCI',ci);
  const disclaimer=result.ci?
    'Intervalo de confiança descritivo por reamostragem de '+result.blocks+' blocos de '+(result.blockBars*4)+'h. Não prova lucro, não corrige sozinho múltiplos testes nem a seleção de parâmetros.':
    'Existem '+result.origins+' origens pareadas e '+result.blocks+' blocos temporais. Precisamos de pelo menos 20 origens e 8 blocos para estimar uma faixa exploratória. Sem novos candles, não há resultado a calcular.';
  indicator('confidenceNote',disclaimer);
  $('horizonRows').innerHTML=A.HORIZONS.map(h=>{
    const s=A.summarize(research,h),ci=s.eligibleCI.ci;
    return '<tr><td><b>'+h*4+'h</b> / '+h+' candle(s)</td>'+
      '<td>'+integer(s.records)+'</td><td>'+integer(s.eligibleCount)+'</td>'+
      '<td>'+integer(s.selectedCount)+'</td><td>'+integer(s.recovered)+'</td>'+
      '<td>'+percent(s.deltaEligible,true)+'</td>'+
      '<td>'+(ci?(percent(ci[0],true)+' a '+percent(ci[1],true)):
        '<span class="na">Amostra insuficiente ('+s.eligibleCI.blocks+' blocos)</span>')+'</td></tr>';
  }).join('');
}
function seriesDefinition(){
  const liquidation=mode==='liquidated';
  return [
    {name:'V4.1 (estratégia)',key:'strategy',color:'#61dab5',description:'Patrimônio líquido registrado no motor congelado'},
    {name:'BTC 100%',key:liquidation?'btcLiquidated':'btcMarked',color:'#87b9ff',
      description:liquidation?'Valor hipotético de liquidação':'Preço de mercado após custo inicial'},
    {name:'BTC 65% + caixa 35%',key:liquidation?'btc65Liquidated':'btc65Marked',color:'#c9aafa',
      description:liquidation?'Custos de entrada e saída':'Somente custo de entrada'},
    {name:'Cinco ativos, 20% cada',key:liquidation?'equalLiquidated':'equalMarked',color:'#f6c878',
      description:liquidation?'Custos de entrada e saída':'Somente custo de entrada'},
    {name:'100% caixa',key:'cash',color:'#cbd5e1',description:'Sem remuneração'}];
}
function renderBenchmarks(state,points){
  const defs=seriesDefinition(),capital=Number(state.config?.initialCapitalVirtual)||50;
  const last=points.at(-1);
  $('benchmarkRows').innerHTML=defs.map(d=>{
    const value=last?.[d.key];
    const change=Number.isFinite(value)?(value/capital-1)*100:null;
    return '<tr><td><span style="color:'+d.color+'">●</span> '+d.name+'</td>'+
      '<td>'+money(value)+'</td><td class="'+(change==null?'na':change>=0?'positive':'negative')+
      '">'+percent(change,true)+'</td><td>'+d.description+'</td></tr>';
  }).join('');
  const note='Os benchmarks mostram '+(mode==='liquidated'?
    'valor hipotético após venda (entrada + saída); ':'valor de mercado após entrada, sem venda; ')+
    'a V4.1 permanece no método de liquidação que seu motor congelado já registra. USDT é utilizado como unidade contábil, sem conversão para BRL.';
  indicator('benchmarkMethod',note);
  drawChart(points,defs);
}
function drawChart(points,defs){
  const canvas=$('chart'),parent=canvas.parentElement;
  const width=Math.max(315,parent?.clientWidth||700),height=260;
  const ratio=Math.min(3,window.devicePixelRatio||1);
  canvas.width=Math.ceil(width*ratio);canvas.height=Math.ceil(height*ratio);
  canvas.style.height=height+'px';canvas.style.width=width+'px';
  const ctx=canvas.getContext('2d');if(!ctx)return;
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,width,height);
  if(!points.length){
    ctx.fillStyle='#9cacc1';ctx.font='13px sans-serif';
    ctx.fillText('Aguardando o primeiro registro prospectivo.',14,75);return;
  }
  const vals=points.flatMap(p=>defs.map(d=>p[d.key]).filter(Number.isFinite));
  let min=Math.min(...vals),max=Math.max(...vals);
  const padding=Math.max(.4,(max-min)*.15);min-=padding;max+=padding;
  const l=48,r=width-15,t=10,b=height-30;
  const x=i=>l+(points.length===1?.5:i/(points.length-1))*(r-l);
  const y=v=>b-(v-min)/(max-min)*(b-t);
  ctx.font='11px sans-serif';
  for(let k=0;k<5;k++){
    const v=min+(max-min)*k/4,yy=y(v);
    ctx.beginPath();ctx.strokeStyle='#2b4058';ctx.lineWidth=.7;
    ctx.moveTo(l,yy);ctx.lineTo(r,yy);ctx.stroke();
    ctx.fillStyle='#a9bbcf';ctx.fillText(v.toFixed(1),1,yy+4);
  }
  for(const d of defs){
    ctx.beginPath();ctx.strokeStyle=d.color;ctx.fillStyle=d.color;
    ctx.lineWidth=d.key==='strategy'?2.7:1.6;
    points.forEach((p,i)=>{
      const v=p[d.key];if(!Number.isFinite(v))return;
      if(i===0)ctx.moveTo(x(i),y(v));else ctx.lineTo(x(i),y(v));
    });
    ctx.stroke();
    if(points.length===1&&Number.isFinite(points[0][d.key])){
      ctx.beginPath();ctx.arc(x(0),y(points[0][d.key]),3.4,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.fillStyle='#a9bbcf';ctx.font='10px sans-serif';
  ctx.fillText('Início',l,b+20);ctx.fillText(points.length>1?'Último registro':'BASELINE',r-85,b+20);
}
function showError(error){
  $('haltBanner').hidden=true;
  indicator('statusLabel','Falha na consulta');
  indicator('chainStatus','Falha na verificação');
  $('chainStatus').classList.add('negative');
  indicator('integrityNotice','Não foi possível exibir dados verificados: '+String(error?.message||error)+'. Não interprete métricas antigas como atuais.');
  console.error('Rotation Lab Analytics',error);
}
function renderAll(){
  if(!context)return;
  renderHeader(context.state,context.research);
  renderRisk(context.state);
  renderStudy(context.research);
  renderBenchmarks(context.state,context.points);
}
async function update(){
  const btn=$('refresh');btn.disabled=true;btn.textContent='Verificando…';
  try{
    indicator('statusLabel','Lendo o histórico público…');
    const state=await fetchState();
    await A.verifyChain(state,digest); // fail closed: never present unverified results.
    const research=A.reconstruct(state);
    if(research.mismatches)throw Error('Retorno-sombra registrado diverge da reconstrução em '+research.mismatches+' ocorrências.');
    context={state,research,points:A.benchmarks(state)};
    indicator('chainStatus','✓ Cadeia SHA-256 válida');
    $('chainStatus').classList.remove('negative');
    indicator('integrityNotice','Cadeia de eventos conferida no navegador. A fonte é o GitHub; os hashes não substituem uma assinatura externa independente. Nenhuma operação real é enviada pelo Analytics.');
    renderAll();
  }catch(error){context=null;showError(error)}
  finally{btn.disabled=false;btn.textContent='↻ Atualizar dados'}
}
$('refresh').addEventListener('click',update);
$('horizon').addEventListener('change',e=>{horizon=Number(e.target.value);if(context)renderStudy(context.research)});
document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>{
  mode=btn.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(node=>node.classList.toggle('active',node.dataset.mode===mode));
  if(context)renderBenchmarks(context.state,context.points);
}));
window.addEventListener('resize',()=>{if(context)renderBenchmarks(context.state,context.points)});
update();
})();
