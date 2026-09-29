
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc,
  serverTimestamp, Timestamp, GeoPoint
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const BACKUP_FORMAT = 'PAD_DIN_FIRESTORE_BACKUP';
const BACKUP_VERSION = 4;
let loadedBackup = null;
let restoreBusy = false;
let authUnsub = null;

const $ = id => document.getElementById(id);

function adminEmail(){
  return String(window.PAD_ADMIN_EMAIL || 'ivan.gutierrez@uteq.edu.mx').trim().toLowerCase();
}
function app(){
  const c = window.FIREBASE_CONFIG || {};
  if(!c.apiKey || !c.projectId || !c.appId) throw new Error('Firebase no está configurado correctamente.');
  return getApps().length ? getApp() : initializeApp(c);
}
function adminContext(){
  const a = app(), auth = getAuth(a), user = auth.currentUser;
  if(!user) throw new Error('Debe iniciar sesión.');
  if(String(user.email||'').trim().toLowerCase() !== adminEmail()) {
    throw new Error('Esta función está disponible únicamente para Administración.');
  }
  return {app:a,user,db:getFirestore(a)};
}
function esc(s=''){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function enc(v){
  if(v===null || v===undefined) return v;
  if(Array.isArray(v)) return v.map(enc);
  if(typeof v!=='object') return v;
  if(typeof v.toDate==='function' && typeof v.seconds==='number'){
    return {__firestoreType:'Timestamp',seconds:Number(v.seconds),nanoseconds:Number(v.nanoseconds||0),iso:v.toDate().toISOString()};
  }
  if(typeof v.latitude==='number' && typeof v.longitude==='number' && v.constructor?.name==='GeoPoint'){
    return {__firestoreType:'GeoPoint',latitude:v.latitude,longitude:v.longitude};
  }
  if(typeof v.path==='string' && v.constructor?.name==='DocumentReference'){
    return {__firestoreType:'DocumentReference',path:v.path};
  }
  const o={}; for(const [k,x] of Object.entries(v)) o[k]=enc(x); return o;
}
function dec(v,db){
  if(v===null || v===undefined) return v;
  if(Array.isArray(v)) return v.map(x=>dec(x,db));
  if(typeof v!=='object') return v;
  if(v.__firestoreType==='Timestamp'){
    if(Number.isFinite(Number(v.seconds))) return new Timestamp(Number(v.seconds),Number(v.nanoseconds||0));
    if(v.iso) return Timestamp.fromDate(new Date(v.iso));
  }
  if(v.__firestoreType==='GeoPoint') return new GeoPoint(Number(v.latitude),Number(v.longitude));
  if(v.__firestoreType==='DocumentReference' && v.path) return doc(db,String(v.path));
  const o={}; for(const [k,x] of Object.entries(v)) o[k]=dec(x,db); return o;
}
async function readCollection(db,name){
  const s=await getDocs(collection(db,name));
  return s.docs.map(d=>({id:d.id,path:d.ref.path,data:enc(d.data())}));
}
async function readSettings(db){
  const r=doc(db,'settings','app'),s=await getDoc(r);
  return s.exists() ? [{id:'app',path:r.path,data:enc(s.data())}] : [];
}
function teacherSummary(entry){
  const d=entry?.data||{}, p=d.profile||{};
  const name=[p.apPat,p.apMat,p.nombres].map(x=>String(x||'').trim()).filter(Boolean).join(' ') || d.displayName || d.email || entry.id;
  return {
    uid:entry.id,name,email:String(d.email||''),period:String(d.period||''),
    submittedPeriod:String(d.submittedPeriod||''),deletedByAdmin:d.deletedByAdmin===true
  };
}
async function makeBackup(){
  const {db,user}=adminContext();
  const [settings,profiles,audit]=await Promise.all([
    readSettings(db),readCollection(db,'profiles'),readCollection(db,'audit')
  ]);
  return {
    backupFormat:BACKUP_FORMAT,
    backupVersion:BACKUP_VERSION,
    exportedAt:new Date().toISOString(),
    source:{projectId:String(window.FIREBASE_CONFIG?.projectId||''),application:'Perfil Académico Docente DIN',administrator:String(user.email||'')},
    summary:{settingsDocuments:settings.length,profileDocuments:profiles.length,auditDocuments:audit.length,totalDocuments:settings.length+profiles.length+audit.length},
    manifest:{teachers:profiles.map(teacherSummary)},
    collections:{settings,profiles,audit}
  };
}
function stamp(){
  const d=new Date(),p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function download(data,name){
  const b=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
  const u=URL.createObjectURL(b),a=document.createElement('a');
  a.href=u;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),1500);
}
function cardStatus(text,kind=''){
  if(!$('backupRestoreStatus')) return;
  $('backupRestoreStatus').textContent=text;
  $('backupRestoreStatus').dataset.kind=kind;
}
function modalStatus(text,kind=''){
  if(!$('restoreModalStatus')) return;
  $('restoreModalStatus').textContent=text;
  $('restoreModalStatus').dataset.kind=kind;
}
function progress(pct,text){
  $('restoreProgress')?.classList.remove('hidden');
  if($('restoreProgressBar')) $('restoreProgressBar').style.width=`${Math.max(0,Math.min(100,pct))}%`;
  if($('restoreProgressText')) $('restoreProgressText').textContent=text||'';
}
function resetProgress(){
  $('restoreProgress')?.classList.add('hidden');
  if($('restoreProgressBar')) $('restoreProgressBar').style.width='0%';
  if($('restoreProgressText')) $('restoreProgressText').textContent='';
}
function busy(on){
  restoreBusy=!!on;
  document.querySelectorAll('#restoreModal button,#restoreModal input').forEach(el=>el.disabled=!!on);
}
window.exportFullBackup=async()=>{
  try{
    cardStatus('Preparando respaldo integral…','working');
    const b=await makeBackup();
    download(b,`respaldo-perfil-din_${stamp()}.json`);
    cardStatus(`Respaldo generado: ${b.summary.profileDocuments} perfiles · ${b.summary.auditDocuments} registros de auditoría.`,'ok');
  }catch(e){
    console.error(e);cardStatus(e.message||'No fue posible generar el respaldo.','error');alert(e.message||'No fue posible generar el respaldo.');
  }
};
function validateBackup(data){
  if(!data || typeof data!=='object' || data.backupFormat!==BACKUP_FORMAT) throw new Error('El archivo no corresponde a un respaldo válido de Perfil DIN.');
  const src=String(data.source?.projectId||''),cur=String(window.FIREBASE_CONFIG?.projectId||'');
  if(!src || src!==cur) throw new Error(`El respaldo pertenece a otro proyecto (${src||'sin identificar'}).`);
  if(!Array.isArray(data.collections?.profiles)) throw new Error('El respaldo no contiene perfiles.');
}
function fmtDate(v){
  try{return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));}catch(_){return String(v||'');}
}
function injectModal(){
  if($('restoreModal')) return;
  const m=document.createElement('div');
  m.id='restoreModal';m.className='restore-modal hidden';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');
  m.innerHTML=`
  <div class="restore-backdrop"></div>
  <div class="restore-panel">
    <header class="restore-head">
      <div><span class="restore-kicker">Administración · Recuperación segura</span><h2>Restaurar respaldo</h2><p>Seleccione exactamente qué información desea recuperar.</p></div>
      <button id="restoreClose" type="button">×</button>
    </header>
    <div class="restore-body">
      <section id="restoreSummary" class="restore-summary"></section>
      <section class="restore-section">
        <div class="restore-section-title"><div><h3>Profesores incluidos</h3><p>Seleccione uno, varios o todos.</p></div><span id="restoreCount">0 seleccionados</span></div>
        <div class="restore-tools">
          <button id="restoreSelectAll" type="button">✓ Seleccionar todos</button>
          <button id="restoreClearAll" type="button">Quitar selección</button>
          <input id="restoreSearch" type="search" placeholder="Buscar profesor o correo…">
        </div>
        <div id="restoreTeacherList" class="restore-list"></div>
      </section>
      <section class="restore-section">
        <div class="restore-section-title"><div><h3>Configuración institucional</h3><p>Opcional; no es necesaria para recuperar profesores.</p></div></div>
        <label class="restore-option"><input id="restoreSettings" type="checkbox"><span><b>Restaurar configuración institucional</b><small>Periodo, programas, acrónimos, troncos comunes y demás configuración global.</small></span></label>
        <div class="restore-option locked"><span>🔒</span><span><b>Auditoría histórica</b><small>Se conserva completa en el JSON, pero no se reescribe porque las reglas actuales la protegen como historial inmutable.</small></span></div>
      </section>
      <div class="restore-safety"><b>Protección activa:</b> antes de restaurar se descargará automáticamente un respaldo preventivo del estado actual. No se eliminan otros perfiles.</div>
      <div id="restoreProgress" class="restore-progress hidden"><div><i id="restoreProgressBar"></i></div><span id="restoreProgressText"></span></div>
      <div id="restoreModalStatus" class="restore-status"></div>
    </div>
    <footer class="restore-foot">
      <button id="restoreCancel" type="button" class="secondary">Cancelar</button>
      <button id="restoreSelected" type="button" class="primary">Restaurar seleccionados</button>
      <button id="restoreAll" type="button" class="danger">Restaurar todos los profesores</button>
    </footer>
  </div>`;
  document.body.appendChild(m);

  $('restoreClose').onclick=()=>{if(!restoreBusy) closeModal();};
  $('restoreCancel').onclick=()=>{if(!restoreBusy) closeModal();};
  m.querySelector('.restore-backdrop').onclick=()=>{if(!restoreBusy) closeModal();};
  $('restoreSelectAll').onclick=()=>{document.querySelectorAll('.restore-check').forEach(x=>x.checked=true);updateCount();};
  $('restoreClearAll').onclick=()=>{document.querySelectorAll('.restore-check').forEach(x=>x.checked=false);updateCount();};
  $('restoreSearch').oninput=e=>{
    const q=String(e.target.value||'').trim().toLowerCase();
    document.querySelectorAll('.restore-row').forEach(r=>r.hidden=!!q && !String(r.dataset.search||'').includes(q));
  };
  $('restoreSelected').onclick=()=>restore(false);
  $('restoreAll').onclick=()=>restore(true);
}
function openModal(){ injectModal(); $('restoreModal').classList.remove('hidden');document.body.classList.add('restore-open'); }
function closeModal(){ $('restoreModal')?.classList.add('hidden');document.body.classList.remove('restore-open'); }
function updateCount(){
  const s=document.querySelectorAll('.restore-check:checked').length,t=document.querySelectorAll('.restore-check').length;
  if($('restoreCount')) $('restoreCount').textContent=`${s} de ${t} seleccionados`;
  if($('restoreSelected')) $('restoreSelected').disabled=restoreBusy || s===0;
}
function renderModal(data){
  injectModal();
  const teachers=Array.isArray(data.manifest?.teachers)?data.manifest.teachers:(data.collections?.profiles||[]).map(teacherSummary);
  $('restoreSummary').innerHTML=`
    <div class="valid">✓ Respaldo válido</div>
    <div><b>${teachers.length} perfiles</b><span>${esc(fmtDate(data.exportedAt))}</span></div>
    <div><b>${Number(data.summary?.auditDocuments||0)} movimientos</b><span>Auditoría incluida</span></div>
    <div><b>${esc(data.source?.projectId||'')}</b><span>Proyecto Firebase</span></div>`;
  $('restoreTeacherList').innerHTML=teachers.map(t=>`
    <label class="restore-row ${t.deletedByAdmin?'deleted':''}" data-search="${esc(`${t.name} ${t.email} ${t.uid}`.toLowerCase())}">
      <input class="restore-check" type="checkbox" value="${esc(t.uid)}" ${t.deletedByAdmin?'':'checked'}>
      <span class="tick"></span>
      <span class="teacher"><b>${esc(t.name)}</b><small>${esc(t.email||t.uid)}</small></span>
      <span class="meta"><b>${esc(t.submittedPeriod||t.period||'Perfil guardado')}</b><small>${esc(t.uid)}</small></span>
    </label>`).join('');
  document.querySelectorAll('.restore-check').forEach(x=>x.onchange=updateCount);
  $('restoreSettings').checked=false;
  resetProgress();modalStatus('Seleccione los perfiles y confirme con los botones inferiores.','');updateCount();openModal();
}
async function loadFile(file){
  const data=JSON.parse(await file.text());validateBackup(data);loadedBackup=data;cardStatus(`Respaldo cargado: ${data.collections.profiles.length} perfiles disponibles.`,'ok');renderModal(data);
}
function selectedIds(all){
  if(all) return new Set((loadedBackup.collections.profiles||[]).filter(x=>x?.data?.deletedByAdmin!==true).map(x=>x.id));
  return new Set([...document.querySelectorAll('.restore-check:checked')].map(x=>x.value));
}
function confirmRestore(count,withSettings){
  return new Promise(resolve=>{
    const host=$('restoreModal'),d=document.createElement('div');
    d.className='confirm-overlay';d.innerHTML=`
      <div class="confirm-card"><div class="confirm-icon">!</div><h3>Confirmar restauración</h3>
      <p>Se restaurarán <b>${count} perfil(es)</b>${withSettings?' y la <b>configuración institucional</b>':''}.</p>
      <div class="confirm-note">Primero se descargará un respaldo preventivo. Esta operación no elimina otros perfiles.</div>
      <label><input id="confirmRestoreCheck" type="checkbox"><span>Entiendo que los perfiles seleccionados volverán al contenido guardado en este respaldo.</span></label>
      <div class="confirm-actions"><button id="confirmRestoreBack">Volver</button><button id="confirmRestoreGo" disabled>Confirmar y restaurar</button></div></div>`;
    host.appendChild(d);
    $('confirmRestoreCheck').onchange=e=>$('confirmRestoreGo').disabled=!e.target.checked;
    $('confirmRestoreBack').onclick=()=>{d.remove();resolve(false);};
    $('confirmRestoreGo').onclick=()=>{d.remove();resolve(true);};
  });
}
async function restoreProfile(db,entry){
  const ref=doc(db,'profiles',entry.id),cur=await getDoc(ref),current=cur.exists()?cur.data():{};
  const data=dec(entry.data,db);
  const next=Math.max(Number(current.dataRevision||0),Number(data.dataRevision||0))+1;
  data.dataRevision=next;data.clientUpdatedAt=Date.now();data.updatedAt=serverTimestamp();
  await setDoc(ref,data,{merge:true});
  const v=await getDoc(ref);
  if(!v.exists() || Number(v.data()?.dataRevision||0)!==next) throw new Error(`No se pudo verificar el perfil ${entry.id}.`);
}
async function restoreSettings(db,entry){
  const data=dec(entry.data,db);data.updatedAt=serverTimestamp();await setDoc(doc(db,'settings',entry.id||'app'),data,{merge:true});
}
async function restore(all){
  if(!loadedBackup || restoreBusy) return;
  try{
    validateBackup(loadedBackup);
    const {db,user}=adminContext();
    const ids=selectedIds(all),withSettings=!!$('restoreSettings')?.checked;
    if(!ids.size && !withSettings){modalStatus('Seleccione al menos un profesor o active configuración institucional.','error');return;}
    if(!await confirmRestore(ids.size,withSettings)){modalStatus('Operación cancelada. No se modificó información.','');return;}

    busy(true);modalStatus('Iniciando proceso protegido…','working');progress(5,'1 de 4 · Generando respaldo preventivo…');
    const emergency=await makeBackup();download(emergency,`PRE-RESTAURACION_perfil-din_${stamp()}.json`);
    await new Promise(r=>setTimeout(r,800));

    const entries=(loadedBackup.collections.profiles||[]).filter(x=>ids.has(x.id));
    progress(15,`2 de 4 · Preparando ${entries.length} perfil(es)…`);

    for(let i=0;i<entries.length;i++){
      const t=teacherSummary(entries[i]),pct=15+Math.round((i/Math.max(1,entries.length))*70);
      progress(pct,`3 de 4 · Restaurando ${i+1} de ${entries.length}: ${t.name}`);
      await restoreProfile(db,entries[i]);
    }

    if(withSettings){
      progress(88,'3 de 4 · Restaurando configuración institucional…');
      for(const e of loadedBackup.collections.settings||[]) await restoreSettings(db,e);
    }

    progress(95,'4 de 4 · Verificando y registrando operación…');
    await addDoc(collection(db,'audit'),{
      action:`Restauración segura de ${entries.length} perfil(es) desde respaldo`,
      email:String(user.email||''),uid:user.uid,at:serverTimestamp(),period:'',
      backupExportedAt:String(loadedBackup.exportedAt||''),restoredProfileIds:entries.map(x=>x.id),settingsRestored:withSettings
    });

    progress(100,`Restauración concluida · ${entries.length} perfil(es) verificados`);
    modalStatus(`Restauración concluida correctamente. ${entries.length} perfil(es) fueron escritos y verificados en Firestore. Los dispositivos abiertos recibirán la nueva revisión mediante sincronización.`,'ok');
    cardStatus(`Última restauración: ${entries.length} perfil(es) recuperados correctamente.`,'ok');
  }catch(e){
    console.error(e);modalStatus(`La restauración se detuvo: ${e.message||'error no identificado'}. El respaldo preventivo permite volver al estado anterior.`,'error');cardStatus('La última restauración no concluyó.','error');
  }finally{busy(false);updateCount();}
}
function styles(){
  if($('backupRestoreStyles')) return;
  const s=document.createElement('style');s.id='backupRestoreStyles';s.textContent=`
  body.restore-open{overflow:hidden}
  @media(min-width:1180px){#admin .admin-core-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;align-items:stretch}#excelExportCard{order:1}#captureControlCard{order:2}#backupRestoreCard{order:3}#institutionalConfig{order:4}}
  #backupRestoreCard{min-width:0}.backup-badge{padding:4px 9px;border-radius:999px;background:#e3f2fb;color:#0d527e;font-size:.72rem;font-weight:900}
  .backup-note{padding:9px 10px;border-radius:10px;border:1px solid #d5e4ef;background:#f0f7fb;color:#34546c;font-size:.76rem;line-height:1.35;margin:8px 0 10px}
  .backup-actions{display:grid;gap:8px}.backup-actions button,.backup-actions label{display:flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:8px 10px;border-radius:9px;font-size:.78rem;font-weight:900;cursor:pointer;box-sizing:border-box}
  #btnFullBackup{border:1px solid #075283;background:linear-gradient(180deg,#126a9f,#0a4d78);color:#fff}#backupFileLabel{border:1px solid #9dbdce;background:#fff;color:#174e70}#backupFileInput{display:none}
  #backupRestoreStatus{margin-top:9px;padding:8px 9px;min-height:36px;border:1px solid #d8e2e9;border-radius:9px;background:#fff;color:#4b6475;font-size:.72rem;line-height:1.35}#backupRestoreStatus[data-kind=ok]{border-color:#acd8b8;background:#edf8f0;color:#165b31}#backupRestoreStatus[data-kind=working]{border-color:#bdd5ea;background:#eef6fd;color:#174e78}#backupRestoreStatus[data-kind=error]{border-color:#efbcb0;background:#fff1ee;color:#8a2d1d}
  .restore-modal{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:24px}.restore-modal.hidden{display:none!important}.restore-backdrop{position:absolute;inset:0;background:rgba(5,25,42,.68);backdrop-filter:blur(3px)}
  .restore-panel{position:relative;width:min(1120px,96vw);max-height:92vh;display:grid;grid-template-rows:auto minmax(0,1fr) auto;border-radius:24px;overflow:hidden;background:#f7fbfe;box-shadow:0 28px 80px rgba(0,0,0,.28)}
  .restore-head{display:flex;justify-content:space-between;gap:20px;padding:22px 26px;background:linear-gradient(120deg,#0b2f4c,#16698d);color:#fff}.restore-kicker{font-size:.72rem;font-weight:800;opacity:.8;text-transform:uppercase}.restore-head h2{margin:3px 0 4px;font-size:1.55rem}.restore-head p{margin:0;opacity:.9;font-size:.86rem}.restore-head button{width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);color:#fff;font-size:26px}
  .restore-body{min-height:0;overflow:auto;padding:22px 26px 18px}.restore-summary{display:grid;grid-template-columns:auto repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px}.restore-summary>div{padding:12px 14px;border:1px solid #d5e3ec;border-radius:14px;background:#fff}.restore-summary b,.restore-summary span{display:block}.restore-summary b{color:#0b3554}.restore-summary span{margin-top:4px;color:#607585;font-size:.72rem}.restore-summary .valid{display:grid;place-items:center;background:#eaf8ef;border-color:#b6dfc2;color:#165d33;font-weight:900}
  .restore-section{margin-top:16px;padding:16px;border:1px solid #d6e4ed;border-radius:16px;background:#fff}.restore-section-title{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:12px}.restore-section-title h3{margin:0;color:#0b3554}.restore-section-title p{margin:4px 0 0;color:#657989;font-size:.76rem}.restore-section-title>span{padding:6px 10px;border-radius:999px;background:#eef6fb;color:#174e70;font-size:.72rem;font-weight:900}
  .restore-tools{display:grid;grid-template-columns:auto auto minmax(220px,1fr);gap:8px;margin-bottom:10px}.restore-tools button,.restore-tools input{min-height:36px;border-radius:9px;border:1px solid #bfd0dc;background:#fff;color:#244b66;padding:7px 10px}.restore-tools button{font-weight:800}
  .restore-list{max-height:330px;overflow:auto;border:1px solid #dae5ec;border-radius:13px;background:#fbfdff}.restore-row{display:grid;grid-template-columns:22px 24px minmax(0,1fr) minmax(170px,.7fr);gap:10px;align-items:center;padding:11px 12px;border-bottom:1px solid #edf2f5;cursor:pointer}.restore-row:hover{background:#f0f7fb}.restore-row[hidden]{display:none!important}.restore-check{width:18px;height:18px;accent-color:#0c6595}.tick{width:22px;height:22px;border-radius:8px;background:#e9f4fa;position:relative}.restore-check:checked+.tick:after{content:'✓';position:absolute;inset:0;display:grid;place-items:center;color:#0c6595;font-weight:900}.teacher,.meta{min-width:0}.teacher b,.teacher small,.meta b,.meta small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.teacher b{color:#143c59;font-size:.82rem}.teacher small,.meta small{color:#718392;font-size:.68rem;margin-top:3px}.meta{text-align:right}.meta b{color:#536b7c;font-size:.68rem}
  .restore-option{display:flex;align-items:flex-start;gap:10px;padding:11px 12px;border:1px solid #dbe5ec;border-radius:12px;background:#fbfdff;margin-top:8px}.restore-option input{width:18px;height:18px;accent-color:#0c6595}.restore-option b,.restore-option small{display:block}.restore-option b{color:#21445e;font-size:.8rem}.restore-option small{margin-top:3px;color:#718391;font-size:.7rem}.restore-option.locked{background:#f6f8fa}
  .restore-safety{margin-top:16px;padding:12px 14px;border:1px solid #edd19a;border-radius:13px;background:#fff8e9;color:#6c5425;font-size:.76rem;line-height:1.4}.restore-progress{margin-top:16px;padding:12px;border:1px solid #cfdfeb;border-radius:13px;background:#fff}.restore-progress.hidden{display:none!important}.restore-progress>div{height:10px;border-radius:999px;overflow:hidden;background:#e4edf3}.restore-progress i{display:block;width:0;height:100%;background:linear-gradient(90deg,#0a6697,#35a883);transition:width .25s}.restore-progress span{display:block;margin-top:7px;color:#3d5d73;font-size:.74rem;font-weight:700}.restore-status{margin-top:12px;min-height:20px;color:#526b7c;font-size:.76rem}.restore-status[data-kind=ok]{color:#176036;font-weight:700}.restore-status[data-kind=working]{color:#0e5d8c}.restore-status[data-kind=error]{color:#9a3322;font-weight:700}
  .restore-foot{display:flex;justify-content:flex-end;gap:9px;padding:15px 26px;border-top:1px solid #dce7ed;background:#fff}.restore-foot button{min-height:40px;padding:9px 15px;border-radius:10px;font-weight:900}.restore-foot .secondary{border:1px solid #c8d5dd;background:#fff;color:#405b6d}.restore-foot .primary{border:1px solid #0a5e8e;background:#0b6697;color:#fff}.restore-foot .danger{border:1px solid #b65a49;background:#fff2ee;color:#8b3425}
  .confirm-overlay{position:absolute;inset:0;z-index:10;display:grid;place-items:center;padding:22px;background:rgba(8,29,45,.62)}.confirm-card{width:min(520px,92%);padding:22px;border-radius:18px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center}.confirm-icon{display:grid;place-items:center;width:48px;height:48px;margin:0 auto 10px;border-radius:14px;background:#fff0e8;color:#a44a2e;font-size:26px;font-weight:900}.confirm-note{padding:10px 12px;border-radius:10px;background:#f4f8fb;color:#526a7a;font-size:.75rem;text-align:left}.confirm-card label{display:flex;gap:9px;align-items:flex-start;margin:13px 0;padding:10px;border:1px solid #d7e2e9;border-radius:10px;text-align:left;font-size:.76rem}.confirm-actions{display:flex;justify-content:center;gap:8px}.confirm-actions button{min-height:38px;padding:8px 13px;border-radius:9px;font-weight:900}
  @media(max-width:900px){.restore-modal{padding:8px}.restore-panel{width:100%;max-height:96vh;border-radius:16px}.restore-head{padding:16px}.restore-body{padding:14px}.restore-foot{padding:12px 14px;flex-wrap:wrap}.restore-foot button{flex:1 1 180px}.restore-summary{grid-template-columns:1fr 1fr}.restore-tools{grid-template-columns:1fr 1fr}.restore-tools input{grid-column:1/-1}.restore-row{grid-template-columns:22px 24px minmax(0,1fr)}.meta{grid-column:3;text-align:left}}
  @media(max-width:1179px){#backupRestoreCard{grid-column:1/-1}}
  `;
  document.head.appendChild(s);
}
function buildCard(){
  const c=document.createElement('section');c.id='backupRestoreCard';c.className='card admin-core-card';
  c.innerHTML=`
  <div class="admin-core-head"><div><h2>Respaldo y restauración</h2><p>Protección integral de la información capturada.</p></div><span class="backup-badge">JSON</span></div>
  <div class="backup-note">Incluye perfiles completos, respuestas por asignatura, comisiones, estado de cierre, configuración institucional y auditoría.</div>
  <div class="backup-actions"><button id="btnFullBackup" type="button">↓ Descargar respaldo completo</button><label id="backupFileLabel" for="backupFileInput">↑ Cargar respaldo para restaurar</label><input id="backupFileInput" type="file" accept=".json,application/json"></div>
  <div id="backupRestoreStatus">Sin operaciones de respaldo en esta sesión.</div>`;
  return c;
}
function cleanAdmin(){
  $('commissionsAdminCard')?.remove();
  const b=$('commissionsBlock');if(b){b.classList.remove('hidden');b.style.display='';const n=b.querySelector('.required-note');if(n)n.textContent='Opcional · referencia para planeación';}
}
function renderAdmin(user){
  cleanAdmin();$('backupRestoreCard')?.remove();
  if(!user || String(user.email||'').trim().toLowerCase()!==adminEmail()) return;
  const g=$('admin')?.querySelector('.admin-core-grid');if(!g)return;
  g.appendChild(buildCard());
  $('btnFullBackup').onclick=window.exportFullBackup;
  $('backupFileInput').onchange=async e=>{
    const f=e.target.files?.[0];if(!f)return;
    try{cardStatus('Validando respaldo…','working');await loadFile(f);}catch(err){console.error(err);loadedBackup=null;cardStatus(err.message||'Archivo no válido.','error');alert(err.message||'Archivo no válido.');}
    e.target.value='';
  };
}
function boot(){
  styles();injectModal();
  const a=app(),auth=getAuth(a);
  if(authUnsub)authUnsub();
  authUnsub=onAuthStateChanged(auth,u=>setTimeout(()=>renderAdmin(u),120));
  const ad=$('admin');if(ad)new MutationObserver(()=>{cleanAdmin();const u=auth.currentUser;if(u&&String(u.email||'').trim().toLowerCase()===adminEmail()&&!$('backupRestoreCard'))renderAdmin(u);}).observe(ad,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
