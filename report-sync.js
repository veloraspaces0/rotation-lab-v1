/* Rotation Lab V1: compartilhamento voluntario de resultados simulados */
'use strict';
(function(){
  const KEY='rotation_lab_v1_public_report_url';
  const ENDPOINT='https://api.jsonstorage.net/v1/json';
  let url=null,latest=null,busy=false,queued=false;
  const id=s=>document.getElementById(s);
  const round=(x,n=3)=>Number(Number(x).toFixed(n));
  function valid(v){
    try{const x=new URL(v);return x.protocol==='https:'&&x.hostname==='api.jsonstorage.net'&&/^\/v1\/json\/[^/]+\/[^/]+\/?$/.test(x.pathname)}
    catch(e){return false}
  }
  try{let saved=localStorage.getItem(KEY);if(valid(saved))url=saved}catch(e){}
  const card=document.createElement('section');
  card.className='panel';
  card.style.marginTop='16px';
  card.innerHTML=[
    '<div class="section-id">02 / RELATÓRIOS</div>',
    '<h2 class="panel-title" style="margin-top:6px">Relatórios online</h2>',
    '<p class="panel-desc">Compartilhe resultados dos testes sem precisar enviar prints. É opcional.</p>',
    '<div class="status" id="repStatus" role="status"></div>',
    '<button class="button primary" type="button" id="repEnable" style="width:100%;margin-top:10px">☁ Ativar sincronização</button>',
    '<div id="repTools" style="display:none;margin-top:10px">',
    '<input type="text" readonly id="repLink" style="width:100%;font-size:12px" aria-label="Link do relatório">',
    '<div class="header-actions" style="margin-top:10px;gap:8px">',
    '<button class="button primary" type="button" id="repCopy">Copiar link</button>',
    '<button class="button outline" type="button" id="repStop">Parar envios</button>',
    '</div></div>',
    '<p class="hint" style="margin-top:12px">Envie o link ao ChatGPT <strong>uma vez</strong>. As próximas simulações serão enviadas enquanto esta página estiver aberta. Somente dados virtuais são compartilhados com um serviço externo. Quem tiver o link pode ler os resultados. Parar envios não apaga o conteúdo publicado.</p>',
    '<button class="button outline" type="button" id="repGithub" style="width:100%;margin-top:12px">Enviar pelo GitHub (alternativa)</button>'
  ].join('');
  const settings=id('runStatus')?.closest('section');
  if(!settings)return;
  settings.insertAdjacentElement('afterend',card);
  function status(s){
    id('repEnable').style.display=url?'none':'block';
    id('repTools').style.display=url?'block':'none';
    id('repLink').value=url||'';
    id('repStatus').textContent=s||(url?'Sincronização ativada':'Sincronização desativada');
  }
  function summary(x){
    return {finalBRL:round(x.final,2),returnPct:round(x.return),
      drawdownPct:x.maxDD==null?null:round(x.maxDD),
      swaps:x.swaps??null,closed:x.closed??null,wins:x.wins??null,
      estimatedFees:x.fees==null?null:round(x.fees)};
  }
  function build(d){
    const p=d.p;
    return {
      app:'Rotation Lab V1',version:1,sentAt:new Date().toISOString(),
      type:'simulacao_educacional_sem_dinheiro_real',
      dataSource:d.source==='demo'?'dados_ficticios':'binance_dados_publicos',
      mode:d.mode,
      period:{startUTC:d.startUTC,endUTC:d.endUTC,candles:d.candles},
      parameters:{virtualCapitalBRL:p.capital,targetPct:round(p.target*100),stopPct:round(p.stop*100),
        lookbackCandles:p.lookback,gap:p.gap,feePct:round(p.fee*100),slippagePct:round(p.slip*100),
        minimumVirtualOrderBRL:p.minOrder},
      results:{rotativo:summary(d.rot),conservador:summary(d.con),holdBTC:summary(d.hold)},
      recentOrders:d.active.trades.slice(-8).map(t=>({date:new Date(t.t).toISOString(),
        action:t.action,coin:t.s,reason:t.reason,pnlVirtual:t.pl==null?null:round(t.pl,2)}))
    };
  }
  async function sync(){
    if(!url||!latest)return;
    if(busy){queued=true;return}
    busy=true;
    const dest=url;
    status('Sincronizando resultado...');
    try{
      const r=await fetch(dest,{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(latest),cache:'no-store'});
      if(!r.ok)throw Error('HTTP '+r.status);
      if(url===dest)status('✓ Resultado atualizado online em '+new Date().toLocaleTimeString('pt-BR'));
    }catch(e){
      if(url===dest)status('Falha ao atualizar ('+e.message+'). Use o GitHub como alternativa.');
    }finally{
      busy=false;
      if(queued){queued=false;if(url)sync()}
    }
  }
  async function activate(){
    if(!latest){status('Faça uma simulação primeiro.');return}
    id('repEnable').disabled=true;
    status('Criando relatório...');
    try{
      const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(latest),cache:'no-store'});
      if(!r.ok)throw Error('HTTP '+r.status);
      const obj=await r.json();
      if(!obj||!valid(obj.uri))throw Error('URL inválida retornada pelo serviço');
      url=obj.uri;
      try{localStorage.setItem(KEY,url)}catch(e){}
      status('✓ Ativado! Copie o link e envie uma única vez ao ChatGPT.');
    }catch(e){status('Não foi possível ativar ('+e.message+'). Tente a alternativa GitHub.')}
    finally{id('repEnable').disabled=false}
  }
  async function copy(){
    if(!url)return;
    try{await navigator.clipboard.writeText(url);status('✓ Link copiado. Cole no ChatGPT uma vez.')}
    catch(e){id('repLink').focus();id('repLink').select();status('Copie o link selecionado no campo acima.')}
  }
  function stop(){
    url=null;queued=false;
    try{localStorage.removeItem(KEY)}catch(e){}
    status('Envios parados. O relatório antigo continua acessível pelo link anterior.');
  }
  function github(){
    if(!latest){status('Rode uma simulação primeiro.');return}
    const title='Rotation Lab V1 · '+latest.mode+' · '+latest.sentAt.slice(0,16);
    const body='Relatório de simulação virtual. Dados de mercado públicos.\n\n'+JSON.stringify(latest,null,2);
    const link='https://github.com/veloraspaces0/rotation-lab-v1/issues/new?title='+
      encodeURIComponent(title)+'&body='+encodeURIComponent(body);
    window.open(link,'_blank','noopener,noreferrer');
    status('No GitHub, toque em Submit new issue para compartilhar o resultado.');
  }
  id('repEnable').addEventListener('click',activate);
  id('repCopy').addEventListener('click',copy);
  id('repStop').addEventListener('click',stop);
  id('repGithub').addEventListener('click',github);
  window.addEventListener('rotation-lab-results',e=>{latest=build(e.detail);if(url)sync()});
  status();
  if(window.RotationLabV1?.run)window.RotationLabV1.run();
})();
