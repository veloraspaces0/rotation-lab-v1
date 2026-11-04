/* V4.1.1 independent read-only integrity audit. Does not change the frozen V4.1 engine. */
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const core=require('../v4-1/core.js');
const SHA=x=>crypto.createHash('sha256').update(x).digest('hex');
const FREEZE_FILES=['v4-1/core.js','v4-1/runner.cjs','.github/workflows/rotation-lab-v4-1.yml'];
function bundleHash(root=path.resolve(__dirname,'..')){
 return SHA(JSON.stringify(FREEZE_FILES.map(file=>({file,sha256:SHA(fs.readFileSync(path.join(root,file)))}))));
}
function audit(state,options={}){
 core.verify(state);
 if(!state.events.length)throw Error('BASELINE ausente');
 const baseline=state.events[0];
 const config={...core.DEFAULT_CONFIG,...(state.config||{})};
 const actualConfigHash=SHA(JSON.stringify(config));
 if(actualConfigHash!==baseline.payload?.configHash)throw Error('Configuração divergente do BASELINE');
 const expected=options.expectedBundleHash;
 if(expected!==undefined&&expected!==baseline.payload?.coreHash)
  throw Error('Motor divergente do BASELINE');
 let prev=-Infinity,previousTime=-Infinity;
 for(let i=0;i<state.events.length;i++){
  const e=state.events[i];
  if(e.seq!==i+1)throw Error('Sequência descontínua no índice '+i);
  const time=Date.parse(e.recordedAtUTC);
  if(!Number.isFinite(time)||time<previousTime)throw Error('recordedAtUTC inválido ou regressivo no evento '+e.seq);
  if(!Number.isSafeInteger(e.candleOpenMs)||e.candleOpenMs<=prev)
   throw Error('Candle inválido no evento '+e.seq);
  prev=e.candleOpenMs;previousTime=time;
 }
 return {ok:true,events:state.events.length,configHash:actualConfigHash,
  baselineBundleHash:baseline.payload.coreHash,checkedBundleHash:expected??null};
}
function latestClosedMinute(rows,now){
 if(!Array.isArray(rows))throw Error('Candles 1m inválidos');
 const valid=rows.map(row=>{
  if(!Array.isArray(row)||row.length<7)throw Error('Candle 1m malformado');
  const open=Number(row[0]),closeAt=Number(row[6]),close=Number(row[4]);
  if(!Number.isSafeInteger(open)||!Number.isSafeInteger(closeAt)||
   open<0||closeAt<open+59000||closeAt>open+60000||
   !Number.isFinite(close)||close<=0)throw Error('Candle 1m inválido');
  return {open,closeAt,close};
 }).filter(r=>r.open<=now&&r.open+60000<=now&&r.closeAt<=now-3000);
 if(!valid.length)throw Error('Nenhum candle 1m fechado');
 valid.sort((a,b)=>a.open-b.open);
 const last=valid.at(-1);
 return {close:last.close,closedAtMs:last.closeAt};
}
function classifySignals(state){
 const result={executable:0,shadowOnly:0,unknown:0,total:0};
 for(const e of state.events){
  const signals=e.payload?.shadow?.emitted;
  if(!Array.isArray(signals))continue;
  const count=signals.length;result.total+=count;
  const delay=e.payload?.latencyMinutes;
  if(e.payload?.action?.type==='SKIP_STALE'||(Number.isFinite(delay)&&delay>90))
   result.shadowOnly+=count;
  else if(Number.isFinite(delay)&&delay>=0&&delay<=90)result.executable+=count;
  else result.unknown+=count;
 }
 result.executableFraction=result.total?result.executable/result.total:null;
 result.lowExecutableShare=result.total>0&&result.executableFraction<.5;
 return result;
}
function main(){
 const root=path.resolve(__dirname,'..');
 const state=JSON.parse(fs.readFileSync(path.join(root,'v4-1/state.json'),'utf8'));
 const result=audit(state,{expectedBundleHash:bundleHash(root)});
 console.log(JSON.stringify({...result,signalClasses:classifySignals(state)},null,2));
}
if(require.main===module){try{main()}catch(e){console.error('V4.1.1 AUDIT FAILED:',e.message);process.exitCode=1}}
module.exports={audit,bundleHash,latestClosedMinute,classifySignals};
