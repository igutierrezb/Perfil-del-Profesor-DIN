/*
  Perfil Académico Docente DIN
  Respaldo / restauración integral V7
  2026-09-29

  Cambios clave:
  - Vista de restauración independiente y más clara.
  - Detalle de la información que contiene cada profesor.
  - Restauración con botón explícito "Restablecer esta versión".
  - Respaldo preventivo selectivo o total según la operación.
  - Verificación Firestore después de cada escritura.
  - adminRestoreToken para forzar propagación a otros dispositivos.
*/

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc,
  serverTimestamp, Timestamp, GeoPoint
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const BACKUP_FORMAT = 'PAD_DIN_FIRESTORE_BACKUP';
const BACKUP_VERSION = 7;
let loadedBackup = null;
let restoreBusy = false;
let authUnsub = null;
let selectedPreviewUid = null;

const $ = id => document.getElementById(id);

function adminEmail(){
  return String(window.PAD_ADMIN_EMAIL || 'ivan.gutierrez@uteq.edu.mx').trim().toLowerCase();
}
function getFirebaseApp(){
  const c=window.FIREBASE_CONFIG||{};
  if(!c.apiKey||!c.projectId||!c.appId) throw new Error('Firebase no está configurado correctamente.');
  return getApps().length?getApp():initializeApp(c);
}
function adminContext(){
  const app=getFirebaseApp(),auth=getAuth(app),user=auth.currentUser;
  if(!user) throw new Error('Debe iniciar sesión.');
  if(String(user.email||'').trim().toLowerCase()!==adminEmail()) throw new Error('Esta función está disponible únicamente para Administración.');
  return {app,user,db:getFirestore(app)};
}
function esc(s=''){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function deepEncode(v){
  if(v===null||v===undefined)return v;
  if(Array.isArray(v))return v.map(deepEncode);
  if(typeof v!=='object')return v;
  if(typeof v.toDate==='function'&&typeof v.seconds==='number')return {__firestoreType:'Timestamp',seconds:Number(v.seconds),nanoseconds:Number(v.nanoseconds||0),iso:v.toDate().toISOString()};
  if(typeof v.latitude==='number'&&typeof v.longitude==='number'&&v.constructor?.name==='GeoPoint')return {__firestoreType:'GeoPoint',latitude:v.latitude,longitude:v.longitude};
  if(typeof v.path==='string'&&v.constructor?.name==='DocumentReference')return {__firestoreType:'DocumentReference',path:v.path};
  const o={};for(const[k,x]of Object.entries(v))o[k]=deepEncode(x);return o;
}
function deepDecode(v,db){
  if(v===null||v===undefined)return v;
  if(Array.isArray(v))return v.map(x=>deepDecode(x,db));
  if(typeof v!=='object')return v;
  if(v.__firestoreType==='Timestamp'){
    if(Number.isFinite(Number(v.seconds)))return new Timestamp(Number(v.seconds),Number(v.nanoseconds||0));
    if(v.iso)return Timestamp.fromDate(new Date(v.iso));
  }
  if(v.__firestoreType==='GeoPoint')return new GeoPoint(Number(v.latitude),Number(v.longitude));
  if(v.__firestoreType==='DocumentReference'&&v.path)return doc(db,String(v.path));
  const o={};for(const[k,x]of Object.entries(v))o[k]=deepDecode(x,db);return o;
}
async function readCollection(db,name){
  const s=await getDocs(collection(db,name));
  return s.docs.map(d=>({id:d.id,path:d.ref.path,data:deepEncode(d.data())}));
}
async function readSettings(db){
  const r=doc(db,'settings','app'),s=await getDoc(r);
  return s.exists()?[{id:'app',path:r.path,data:deepEncode(s.data())}]:[];
}
function teacherName(entry){
  const d=entry?.data||{},p=d.profile||{};
  return [p.apPat,p.apMat,p.nombres].map(x=>String(x||'').trim()).filter(Boolean).join(' ')||d.displayName||d.email||entry.id;
}
function teacherSummary(entry){
  const d=entry?.data||{},answers=d.answers&&typeof d.answers==='object'?d.answers:{},meta=d.programMeta&&typeof d.programMeta==='object'?d.programMeta:{},planning=d.planningByPeriod&&typeof d.planningByPeriod==='object'?d.planningByPeriod:{};
  const answerValues=Object.values(answers);
  const answered=answerValues.filter(a=>a&&typeof a==='object'&&a.status&&a.status!=='pending').length;
  const favorites=answerValues.filter(a=>a&&a.ideal===true).length;
  return {
    uid:entry.id,
    name:teacherName(entry),
    email:String(d.email||''),
    period:String(d.period||''),
    submittedPeriod:String(d.submittedPeriod||''),
    finalizedAtMs:Number(d.finalizedAtMs||0),
    dataRevision:Number(d.dataRevision||0),
    deletedByAdmin:d.deletedByAdmin===true,
    counts:{
      profileFields:Object.keys(d.profile||{}).length,
      answers:Object.keys(answers).length,
      answered,
      favorites,
      programMeta:Object.keys(meta).length,
      planningPeriods:Object.keys(planning).length
    }
  };
}
async function makeBackup({profileIds=null,includeSettings=true,includeAudit=true,scope='total'}={}){
  const {db,user}=adminContext();
  let profiles=await readCollection(db,'profiles');
  if(profileIds instanceof Set)profiles=profiles.filter(x=>profileIds.has(x.id));
  const [settings,audit]=await Promise.all([
    includeSettings?readSettings(db):Promise.resolve([]),
    includeAudit?readCollection(db,'audit'):Promise.resolve([])
  ]);
  return {
    backupFormat:BACKUP_FORMAT,
    backupVersion:BACKUP_VERSION,
    exportedAt:new Date().toISOString(),
    scope,
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
function safeName(s=''){
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'perfil';
}
function download(data,name){
  const b=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),u=URL.createObjectURL(b),a=document.createElement('a');
  a.href=u;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1600);
}
function setCardStatus(text,kind=''){
  const e=$('backupRestoreStatus');if(!e)return;e.textContent=text;e.dataset.kind=kind;
}
function setModalStatus(text,kind=''){
  const e=$('restoreModalStatus');if(!e)return;e.textContent=text;e.dataset.kind=kind;
}
function setProgress(pct,text){
  $('restoreProgress')?.classList.remove('hidden');
  if($('restoreProgressBar'))$('restoreProgressBar').style.width=`${Math.max(0,Math.min(100,pct))}%`;
  if($('restoreProgressText'))$('restoreProgressText').textContent=text||'';
}
function resetProgress(){
  $('restoreProgress')?.classList.add('hidden');
  if($('restoreProgressBar'))$('restoreProgressBar').style.width='0%';
  if($('restoreProgressText'))$('restoreProgressText').textContent='';
}
function setBusy(on){
  restoreBusy=!!on;
  document.querySelectorAll('#restoreModal button,#restoreModal input').forEach(el=>el.disabled=!!on);
}
function validateBackup(data){
  if(!data||typeof data!=='object'||data.backupFormat!==BACKUP_FORMAT)throw new Error('El archivo no corresponde a un respaldo válido de Perfil DIN.');
  const src=String(data.source?.projectId||''),cur=String(window.FIREBASE_CONFIG?.projectId||'');
  if(!src||src!==cur)throw new Error(`El respaldo pertenece a otro proyecto (${src||'sin identificar'}).`);
  if(!Array.isArray(data.collections?.profiles))throw new Error('El respaldo no contiene perfiles.');
}
function fmtDate(v){
  try{return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));}catch(_){return String(v||'');}
}
window.exportFullBackup=async()=>{
  try{
    setCardStatus('Preparando respaldo integral…','working');
    const b=await makeBackup({scope:'total',includeSettings:true,includeAudit:true});
    download(b,`RESPALDO_TOTAL_Perfil-DIN_${stamp()}.json`);
    setCardStatus(`Respaldo TOTAL generado: ${b.summary.profileDocuments} perfiles · configuración · auditoría.`,'ok');
  }catch(e){console.error(e);setCardStatus(e.message||'No fue posible generar el respaldo.','error');}
};

function injectModal(){
  if($('restoreModal'))return;
  const m=document.createElement('div');m.id='restoreModal';m.className='restore-modal hidden';
  m.innerHTML=`
  <div class="restore-backdrop"></div>
  <div class="restore-panel">
    <header class="restore-head">
      <div><span class="restore-kicker">Administración · Recuperación segura</span><h2>Restablecer una versión respaldada</h2><p>Revise qué información contiene el archivo antes de aplicarla a Firestore.</p></div>
      <button id="restoreClose" type="button">×</button>
    </header>
    <div class="restore-body">
      <section id="restoreSummary" class="restore-summary"></section>
      <div class="restore-columns">
        <section class="restore-section teacher-column">
          <div class="restore-section-title"><div><h3>Profesores del respaldo</h3><p>Seleccione los perfiles que desea restablecer.</p></div><span id="restoreCount">0 seleccionados</span></div>
          <div class="restore-tools"><button id="restoreSelectAll" type="button">✓ Todos</button><button id="restoreClearAll" type="button">Ninguno</button><input id="restoreSearch" type="search" placeholder="Buscar profesor o correo…"></div>
          <div id="restoreTeacherList" class="restore-list"></div>
        </section>
        <section class="restore-section detail-column">
          <div class="restore-section-title"><div><h3>Contenido de la versión</h3><p>Detalle del profesor señalado.</p></div></div>
          <div id="restoreTeacherDetail" class="restore-detail-empty">Seleccione un profesor para revisar exactamente qué se recuperará.</div>
        </section>
      </div>
      <section class="restore-section">
        <label class="restore-option"><input id="restoreSettings" type="checkbox"><span><b>Restablecer también configuración institucional</b><small>Periodo, programas, acrónimos, troncos comunes y configuración global.</small></span></label>
        <div class="restore-option locked"><span>🔒</span><span><b>Auditoría histórica</b><small>Permanece dentro del JSON como evidencia, pero no se reescribe porque Firestore la protege como historial inmutable.</small></span></div>
      </section>
      <div class="restore-safety"><b>Antes de aplicar:</b> revise cuidadosamente la versión seleccionada. No se descargará un respaldo automático; si desea una copia adicional del estado actual, utilice previamente “Descargar respaldo TOTAL”.</div>
      <div id="restoreProgress" class="restore-progress hidden"><div><i id="restoreProgressBar"></i></div><span id="restoreProgressText"></span></div>
      <div id="restoreModalStatus" class="restore-status"></div>
    </div>
    <footer class="restore-foot">
      <button id="restoreCancel" type="button" class="secondary">Cancelar</button>
      <button id="restoreSelected" type="button" class="primary">Restablecer versión seleccionada</button>
      <button id="restoreAll" type="button" class="danger">Restablecer todos los profesores</button>
    </footer>
  </div>`;
  document.body.appendChild(m);
  $('restoreClose').onclick=()=>{if(!restoreBusy)closeModal();};
  $('restoreCancel').onclick=()=>{if(!restoreBusy)closeModal();};
  m.querySelector('.restore-backdrop').onclick=()=>{if(!restoreBusy)closeModal();};
  $('restoreSelectAll').onclick=()=>{document.querySelectorAll('.restore-check').forEach(x=>x.checked=true);updateCount();};
  $('restoreClearAll').onclick=()=>{document.querySelectorAll('.restore-check').forEach(x=>x.checked=false);updateCount();};
  $('restoreSearch').oninput=e=>{
    const q=String(e.target.value||'').trim().toLowerCase();
    document.querySelectorAll('.restore-row').forEach(r=>r.hidden=!!q&&!String(r.dataset.search||'').includes(q));
  };
  $('restoreSelected').onclick=()=>restore(false);
  $('restoreAll').onclick=()=>restore(true);
}
function openModal(){injectModal();$('restoreModal').classList.remove('hidden');document.body.classList.add('restore-open');}
function closeModal(){$('restoreModal')?.classList.add('hidden');document.body.classList.remove('restore-open');}
function profileEntry(uid){return (loadedBackup?.collections?.profiles||[]).find(x=>x.id===uid)||null;}
function detailHtml(entry){
  if(!entry)return '<div class="restore-detail-empty">Seleccione un profesor.</div>';
  const d=entry.data||{},p=d.profile||{},e=p.extra||{},s=teacherSummary(entry);
  const answers=d.answers&&typeof d.answers==='object'?d.answers:{};
  const planning=d.planningByPeriod&&typeof d.planningByPeriod==='object'?d.planningByPeriod:{};

  const values=Object.values(answers).filter(x=>x&&typeof x==='object');
  const xCount=values.filter(a=>a.status==='X').length;
  const xxCount=values.filter(a=>a.status==='XX').length;
  const offCount=values.filter(a=>a.status==='off').length;
  const pendingCount=values.filter(a=>a.status==='pending').length;
  const naCount=values.filter(a=>a.status==='na').length;
  const favCount=values.filter(a=>a.ideal===true).length;

  const formation=[
    [e.f1a,e.f1b],[e.f2a,e.f2b],[e.f3a,e.f3b],[e.f4a,e.f4b],[e.f5a,e.f5b],[e.f6a,e.f6b],[e.f7a,e.f7b]
  ].filter(row=>row.some(Boolean));
  const teaching=[
    [e.d1a,e.d1c],[e.d2a,e.d2c],[e.d3a,e.d3c],[e.d4a,e.d4c]
  ].filter(row=>row.some(Boolean));
  const jobs=[
    [e.l1a,e.l1b,e.l1c],[e.l2a,e.l2b,e.l2c],[e.l3a,e.l3b,e.l3c],[e.l4a,e.l4b,e.l4c],[e.l5a,e.l5b,e.l5c]
  ].filter(row=>row.some(Boolean));

  const sample=(rows,labels)=>rows.length
    ? `<ul class="backup-real-data">${rows.map(row=>`<li>${row.map((v,i)=>v?`<span><b>${labels[i]}:</b> ${esc(v)}</span>`:'').filter(Boolean).join(' · ')}</li>`).join('')}</ul>`
    : '<span class="backup-empty-line">Sin registros en esta sección.</span>';

  return `
    <div class="detail-professor">
      <strong>${esc(s.name)}</strong>
      <span>${esc(s.email||s.uid)}</span>
      <span>${esc(p.gradoAcademico||'')} ${p.categoria?`· ${esc(p.categoria)}`:''}</span>
    </div>

    <div class="backup-data-proof">
      <strong>Contenido real guardado en este respaldo</strong>
      <span>Este panel lee directamente el JSON seleccionado; no es una estimación.</span>
    </div>

    <div class="detail-grid">
      <div><b>Asignaturas guardadas</b><span>${Object.keys(answers).length} registros</span></div>
      <div><b>Competencia</b><span>X: ${xCount} · XX: ${xxCount}</span></div>
      <div><b>Deshabilitadas / N.A.</b><span>${offCount} / ${naCount}</span></div>
      <div><b>Pendientes</b><span>${pendingCount}</span></div>
      <div><b>Favoritas</b><span>${favCount}</span></div>
      <div><b>Programas con metadatos</b><span>${Object.keys(d.programMeta||{}).length}</span></div>
      <div><b>Comisiones / planeación</b><span>${Object.keys(planning).length} periodo(s)</span></div>
      <div><b>Estado del perfil</b><span>${d.submittedPeriod?`Finalizado: ${esc(String(d.submittedPeriod))}`:'No finalizado'}</span></div>
      <div><b>Revisión respaldada</b><span>${Number(d.dataRevision||0)}</span></div>
      <div><b>Último cambio respaldado</b><span>${Number(d.clientUpdatedAt||0)?esc(fmtDate(Number(d.clientUpdatedAt))):'Sin fecha técnica'}</span></div>
    </div>

    <details class="backup-detail-section" open>
      <summary>Datos del profesor respaldados</summary>
      <div class="backup-profile-values">
        <span><b>Apellido paterno:</b> ${esc(p.apPat||'—')}</span>
        <span><b>Apellido materno:</b> ${esc(p.apMat||'—')}</span>
        <span><b>Nombres:</b> ${esc(p.nombres||'—')}</span>
        <span><b>Categoría:</b> ${esc(p.categoria||'—')}</span>
        <span><b>Grado académico:</b> ${esc(p.gradoAcademico||'—')}</span>
      </div>
    </details>

    <details class="backup-detail-section">
      <summary>Formación profesional (${formation.length})</summary>
      ${sample(formation,['Estudio','Institución'])}
    </details>

    <details class="backup-detail-section">
      <summary>Experiencia docente (${teaching.length})</summary>
      ${sample(teaching,['Institución','Periodo'])}
    </details>

    <details class="backup-detail-section">
      <summary>Experiencia laboral (${jobs.length})</summary>
      ${sample(jobs,['Organización','Cargo','Periodo'])}
    </details>

    <div class="detail-note">
      Al restablecer se sustituirá el documento del profesor por esta versión respaldada:
      <b>profile, answers, programMeta, planningByPeriod, estado de finalización y permisos asociados al perfil</b>.
      Después se genera una revisión técnica nueva para que móvil y escritorio adopten esta versión.
    </div>

    <button type="button" class="restore-one-btn" data-restore-one="${esc(entry.id)}">
      Restablecer exactamente esta versión de ${esc(s.name)}
    </button>`;
}
function showDetail(uid){
  selectedPreviewUid=uid;
  if($('restoreTeacherDetail'))$('restoreTeacherDetail').innerHTML=detailHtml(profileEntry(uid));
  const b=document.querySelector('[data-restore-one]');
  if(b)b.onclick=()=>{
    document.querySelectorAll('.restore-check').forEach(x=>x.checked=x.value===b.dataset.restoreOne);
    updateCount();
    restore(false);
  };
}
function updateCount(){
  const checks=[...document.querySelectorAll('.restore-check')],selected=checks.filter(x=>x.checked);
  if($('restoreCount'))$('restoreCount').textContent=`${selected.length} de ${checks.length} seleccionados`;
  if($('restoreSelected'))$('restoreSelected').disabled=restoreBusy||selected.length===0;
  if(selected.length===1)showDetail(selected[0].value);
  else if(selected.length===0&&$('restoreTeacherDetail'))$('restoreTeacherDetail').innerHTML='<div class="restore-detail-empty">Seleccione un profesor para revisar exactamente qué se recuperará.</div>';
}
function renderModal(data){
  injectModal();
  const teachers=Array.isArray(data.manifest?.teachers)?data.manifest.teachers:(data.collections?.profiles||[]).map(teacherSummary);
  $('restoreSummary').innerHTML=`
    <div class="valid">✓ Respaldo válido</div>
    <div><b>${esc(String(data.scope||'total').toUpperCase())}</b><span>Tipo de respaldo</span></div>
    <div><b>${teachers.length} perfiles</b><span>${esc(fmtDate(data.exportedAt))}</span></div>
    <div><b>${Number(data.summary?.auditDocuments||0)} movimientos</b><span>Auditoría conservada</span></div>`;
  $('restoreTeacherList').innerHTML=teachers.map(t=>`
    <label class="restore-row ${t.deletedByAdmin?'deleted':''}" data-search="${esc(`${t.name} ${t.email} ${t.uid}`.toLowerCase())}">
      <input class="restore-check" type="checkbox" value="${esc(t.uid)}" ${t.deletedByAdmin?'':'checked'}>
      <span class="tick"></span>
      <span class="teacher"><b>${esc(t.name)}</b><small>${esc(t.email||t.uid)}</small></span>
      <button type="button" class="inspect-btn" data-inspect="${esc(t.uid)}">Ver contenido</button>
    </label>`).join('');
  document.querySelectorAll('.restore-check').forEach(x=>x.onchange=updateCount);
  document.querySelectorAll('[data-inspect]').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();showDetail(b.dataset.inspect);});
  $('restoreSettings').checked=false;
  resetProgress();setModalStatus('Revise el contenido y utilice “Restablecer esta versión” o los botones inferiores.','');updateCount();openModal();
}
async function loadBackupFile(file){
  const data=JSON.parse(await file.text());validateBackup(data);loadedBackup=data;
  setCardStatus(`Respaldo cargado: ${data.collections.profiles.length} perfiles disponibles.`,'ok');renderModal(data);
}
function selectedIds(all){
  if(all)return new Set((loadedBackup.collections.profiles||[]).filter(x=>x?.data?.deletedByAdmin!==true).map(x=>x.id));
  return new Set([...document.querySelectorAll('.restore-check:checked')].map(x=>x.value));
}
function confirmRestore(count,withSettings){
  return new Promise(resolve=>{
    const d=document.createElement('div');d.className='confirm-overlay';d.innerHTML=`
      <div class="confirm-card"><div class="confirm-icon">!</div><h3>Aplicar versión respaldada</h3>
      <p>Se restablecerán <b>${count} perfil(es)</b>${withSettings?' y la <b>configuración institucional</b>':''}.</p>
      <div class="confirm-note">La restauración actualizará Firestore con la versión seleccionada. Si desea conservar una copia adicional del estado actual, descárguela manualmente antes de continuar.</div>
      <label><input id="confirmRestoreCheck" type="checkbox"><span>Confirmo que deseo sustituir el contenido actual de los perfiles seleccionados por la versión contenida en este respaldo.</span></label>
      <div class="confirm-actions"><button id="confirmRestoreBack">Volver</button><button id="confirmRestoreGo" disabled>Restablecer ahora</button></div></div>`;
    $('restoreModal').appendChild(d);
    $('confirmRestoreCheck').onchange=e=>$('confirmRestoreGo').disabled=!e.target.checked;
    $('confirmRestoreBack').onclick=()=>{d.remove();resolve(false);};
    $('confirmRestoreGo').onclick=()=>{d.remove();resolve(true);};
  });
}
async function restoreProfile(db,entry,restoreToken){
  const ref=doc(db,'profiles',entry.id),cur=await getDoc(ref),current=cur.exists()?cur.data():{},data=deepDecode(entry.data,db);
  const next=Math.max(Number(current.dataRevision||0),Number(data.dataRevision||0))+1;
  data.dataRevision=next;
  data.clientUpdatedAt=Date.now();
  data.updatedAt=serverTimestamp();
  data.adminRestoreToken=restoreToken;
  data.adminRestoredAt=serverTimestamp();
  await setDoc(ref,data,{merge:false});
  const verify=await getDoc(ref);
  if(!verify.exists())throw new Error(`No se pudo verificar el perfil ${entry.id}.`);
  const saved=verify.data()||{};
  if(String(saved.adminRestoreToken||'')!==restoreToken||Number(saved.dataRevision||0)!==next)throw new Error(`La verificación del perfil ${entry.id} no coincidió.`);
}
async function restoreSettingsEntry(db,entry){
  const data=deepDecode(entry.data,db);data.updatedAt=serverTimestamp();await setDoc(doc(db,'settings',entry.id||'app'),data,{merge:true});
}
async function restore(all){
  if(!loadedBackup||restoreBusy)return;
  try{
    validateBackup(loadedBackup);
    const {db,user}=adminContext(),ids=selectedIds(all),withSettings=!!$('restoreSettings')?.checked;
    if(!ids.size&&!withSettings){setModalStatus('Seleccione al menos un profesor o active configuración institucional.','error');return;}
    if(!await confirmRestore(ids.size,withSettings)){setModalStatus('Operación cancelada. No se modificó información.','');return;}

    setBusy(true);setModalStatus('Iniciando restauración verificable…','working');
    const entries=(loadedBackup.collections.profiles||[]).filter(x=>ids.has(x.id));

    // V67: no se genera respaldo automático. El administrador decide manualmente
    // cuándo descargar un respaldo TOTAL antes de restaurar.
    setProgress(8,'1 de 3 · Preparando la restauración seleccionada…');

    const restoreToken=`restore_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
    setProgress(18,`1 de 3 · Preparando ${entries.length} perfil(es)…`);
    for(let i=0;i<entries.length;i++){
      const t=teacherSummary(entries[i]),pct=15+Math.round((i/Math.max(1,entries.length))*68);
      setProgress(pct,`2 de 3 · Restableciendo ${i+1} de ${entries.length}: ${t.name}`);
      await restoreProfile(db,entries[i],restoreToken);
    }
    if(withSettings){
      setProgress(88,'2 de 3 · Restableciendo configuración institucional…');
      for(const e of loadedBackup.collections.settings||[])await restoreSettingsEntry(db,e);
    }
    setProgress(96,'3 de 3 · Registrando y confirmando operación…');
    await addDoc(collection(db,'audit'),{
      action:`Restauración verificable de ${entries.length} perfil(es) desde respaldo`,
      email:String(user.email||''),uid:user.uid,at:serverTimestamp(),period:'',
      backupExportedAt:String(loadedBackup.exportedAt||''),restoreToken,
      restoredProfileIds:entries.map(x=>x.id),settingsRestored:withSettings
    });
    setProgress(100,`Restauración aplicada · ${entries.length} perfil(es) verificados`);
    setModalStatus(`CAMBIOS APLICADOS EN FIRESTORE. ${entries.length} perfil(es) fueron restablecidos y verificados. El token de restauración obligará a los dispositivos abiertos a tomar esta versión respaldada.`,'ok');
    setCardStatus(`Restauración aplicada: ${entries.length} perfil(es) actualizados.`,'ok');

    if($('restoreSelected'))$('restoreSelected').textContent='✓ Versión restablecida';
    setTimeout(()=>{if($('restoreSelected'))$('restoreSelected').textContent='Restablecer versión seleccionada';},4000);
  }catch(e){
    console.error(e);setModalStatus(`La restauración se detuvo: ${e.message||'error no identificado'}. Revise el respaldo original y el estado actual antes de intentar nuevamente.`,'error');setCardStatus('La última restauración no concluyó.','error');
  }finally{setBusy(false);updateCount();}
}

function styles(){
  if($('backupRestoreStyles'))return;
  const s=document.createElement('style');s.id='backupRestoreStyles';s.textContent=`
  body.restore-open{overflow:hidden}
  @media(min-width:1180px){#admin .admin-core-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;align-items:stretch}#excelExportCard{order:1}#captureControlCard{order:2}#backupRestoreCard{order:3}#institutionalConfig{order:4}}
  #backupRestoreCard{min-width:0}.backup-badge{padding:4px 9px;border-radius:999px;background:#e3f2fb;color:#0d527e;font-size:.72rem;font-weight:650}.backup-note{padding:9px 10px;border-radius:10px;border:1px solid #d5e4ef;background:#f0f7fb;color:#34546c;font-size:.76rem;line-height:1.35;margin:8px 0 10px}.backup-actions{display:grid;gap:8px}.backup-actions button,.backup-actions label{display:flex;align-items:center;justify-content:center;min-height:38px;padding:8px 10px;border-radius:9px;font-size:.78rem;font-weight:650;cursor:pointer}.backup-actions button{border:1px solid #075283;background:linear-gradient(180deg,#126a9f,#0a4d78);color:white}.backup-actions label{border:1px solid #9dbdce;background:white;color:#174e70}#backupFileInput{display:none}#backupRestoreStatus{margin-top:9px;padding:8px 9px;min-height:36px;border:1px solid #d8e2e9;border-radius:9px;background:white;color:#4b6475;font-size:.72rem}#backupRestoreStatus[data-kind=ok]{background:#edf8f0;color:#165b31}#backupRestoreStatus[data-kind=working]{background:#eef6fd;color:#174e78}#backupRestoreStatus[data-kind=error]{background:#fff1ee;color:#8a2d1d}
  .restore-modal{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:20px}.restore-modal.hidden{display:none!important}.restore-backdrop{position:absolute;inset:0;background:rgba(5,25,42,.68);backdrop-filter:blur(3px)}.restore-panel{position:relative;width:min(1180px,97vw);max-height:94vh;display:grid;grid-template-rows:auto minmax(0,1fr) auto;border-radius:20px;overflow:hidden;background:#f9fbfd;box-shadow:0 28px 80px rgba(0,0,0,.28)}.restore-head{display:flex;justify-content:space-between;padding:22px 28px;background:linear-gradient(120deg,#123a57,#2c7693);color:white}.restore-kicker{font-size:.7rem;font-weight:600;opacity:.8;text-transform:uppercase}.restore-head h2{margin:3px 0 4px;font-size:1.5rem}.restore-head p{margin:0;opacity:.88;font-size:.84rem}.restore-head button{width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:white;font-size:25px}.restore-body{overflow:auto;padding:22px 26px}.restore-summary{display:grid;grid-template-columns:auto repeat(3,minmax(0,1fr));gap:10px}.restore-summary>div{padding:11px 13px;border:1px solid #d5e3ec;border-radius:13px;background:white}.restore-summary b,.restore-summary span{display:block}.restore-summary span{margin-top:3px;color:#607585;font-size:.7rem}.restore-summary .valid{display:grid;place-items:center;background:#eaf8ef;color:#165d33;font-weight:650}
  .restore-columns{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);gap:18px}.restore-section{margin-top:14px;padding:14px;border:1px solid #dce6ed;border-radius:15px;background:white}.restore-section-title{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}.restore-section-title h3{margin:0;color:#0b3554;font-size:.95rem}.restore-section-title p{margin:3px 0 0;color:#657989;font-size:.73rem}.restore-section-title>span{padding:5px 9px;border-radius:999px;background:#eef6fb;color:#174e70;font-size:.7rem;font-weight:650;white-space:nowrap}.restore-tools{display:grid;grid-template-columns:auto auto minmax(180px,1fr);gap:7px;margin-bottom:9px}.restore-tools button,.restore-tools input{min-height:34px;border-radius:8px;border:1px solid #bfd0dc;background:white;color:#244b66;padding:6px 9px}.restore-list{max-height:350px;overflow:auto;border:1px solid #dae5ec;border-radius:12px}.restore-row{display:grid;grid-template-columns:20px 18px minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px 12px;border-bottom:1px solid #eef3f6;cursor:pointer;background:#fff}.restore-row:hover{background:#f6fafc}.restore-row[hidden]{display:none!important}.restore-check{width:17px;height:17px;accent-color:#0c6595}.tick{width:21px;height:21px;border-radius:7px;background:#e9f4fa;position:relative}.restore-check:checked+.tick:after{content:'✓';position:absolute;inset:0;display:grid;place-items:center;color:#0c6595;font-weight:650}.teacher b,.teacher small{display:block}.teacher b{color:#173f58;font-size:.79rem;font-weight:600}.teacher small{color:#718392;font-size:.66rem;margin-top:2px}.inspect-btn{border:1px solid #c7d8e2;background:#fff;color:#2a5975;border-radius:9px;padding:6px 10px;font-size:.68rem;font-weight:600}.restore-detail-empty{display:grid;place-items:center;min-height:260px;text-align:center;color:#7a8d9a;padding:20px}.detail-professor{padding-bottom:10px;border-bottom:1px solid #e2e9ee}.detail-professor strong,.detail-professor span{display:block}.detail-professor strong{color:#123e5c;font-size:1rem}.detail-professor span{color:#6c7f8d;font-size:.72rem;margin-top:3px}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:11px}.detail-grid>div{padding:9px;border-radius:9px;background:#f3f8fb;border:1px solid #dfebf2}.detail-grid b,.detail-grid span{display:block}.detail-grid b{font-size:.7rem;color:#254d68}.detail-grid span{font-size:.68rem;color:#657988;margin-top:3px}.detail-note{margin-top:10px;padding:9px;border-radius:9px;background:#fff8e9;border:1px solid #edd19a;color:#665127;font-size:.7rem;line-height:1.35}.restore-one-btn{width:100%;margin-top:10px;border:1px solid #0a5e8e;background:#0b6697;color:white;border-radius:9px;padding:10px;font-weight:650}
  .restore-option{display:flex;gap:10px;padding:10px;border:1px solid #dbe5ec;border-radius:11px;background:#fbfdff;margin-top:7px}.restore-option input{width:17px;height:17px;accent-color:#0c6595}.restore-option b,.restore-option small{display:block}.restore-option b{color:#21445e;font-size:.77rem}.restore-option small{color:#718391;font-size:.68rem;margin-top:3px}.restore-option.locked{background:#f6f8fa}.restore-safety{margin-top:14px;padding:11px 13px;border:1px solid #edd19a;border-radius:12px;background:#fff8e9;color:#6c5425;font-size:.73rem;line-height:1.4}.restore-progress{margin-top:13px;padding:11px;border:1px solid #cfdfeb;border-radius:12px;background:white}.restore-progress.hidden{display:none!important}.restore-progress>div{height:9px;border-radius:999px;overflow:hidden;background:#e4edf3}.restore-progress i{display:block;width:0;height:100%;background:linear-gradient(90deg,#0a6697,#35a883);transition:width .25s}.restore-progress span{display:block;margin-top:6px;color:#3d5d73;font-size:.72rem;font-weight:600}.restore-status{margin-top:10px;min-height:18px;font-size:.74rem}.restore-status[data-kind=ok]{color:#176036;font-weight:600}.restore-status[data-kind=working]{color:#0e5d8c}.restore-status[data-kind=error]{color:#9a3322;font-weight:600}
  .restore-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px;border-top:1px solid #dce7ed;background:white}.restore-foot button{min-height:39px;padding:8px 14px;border-radius:9px;font-weight:650}.restore-foot .secondary{border:1px solid #c8d5dd;background:white;color:#405b6d}.restore-foot .primary{border:1px solid #0a5e8e;background:#0b6697;color:white}.restore-foot .danger{border:1px solid #b65a49;background:#fff2ee;color:#8b3425}.confirm-overlay{position:absolute;inset:0;z-index:10;display:grid;place-items:center;background:rgba(8,29,45,.62);padding:20px}.confirm-card{width:min(520px,92%);padding:21px;border-radius:17px;background:white;text-align:center}.confirm-icon{display:grid;place-items:center;width:46px;height:46px;margin:auto;border-radius:13px;background:#fff0e8;color:#a44a2e;font-size:25px;font-weight:650}.confirm-note{padding:9px 11px;background:#f4f8fb;border-radius:9px;text-align:left;font-size:.73rem;color:#526a7a}.confirm-card label{display:flex;gap:8px;margin:12px 0;padding:9px;border:1px solid #d7e2e9;border-radius:9px;text-align:left;font-size:.73rem}.confirm-actions{display:flex;justify-content:center;gap:8px}.confirm-actions button{padding:8px 12px;border-radius:8px;font-weight:650}

  .backup-data-proof{margin-top:10px;padding:10px 11px;border-radius:10px;background:#eaf8ef;border:1px solid #b8ddc3;color:#165b31}
  .backup-data-proof strong,.backup-data-proof span{display:block}.backup-data-proof span{margin-top:3px;font-size:.68rem;color:#4e7560}
  .backup-detail-section{margin-top:9px;border:1px solid #dce7ed;border-radius:10px;background:#fff;overflow:hidden}
  .backup-detail-section summary{cursor:pointer;padding:9px 10px;background:#f3f8fb;color:#244d68;font-size:.72rem;font-weight:650}
  .backup-profile-values{display:grid;grid-template-columns:1fr 1fr;gap:7px;padding:10px}
  .backup-profile-values span{font-size:.69rem;color:#536c7c}
  .backup-real-data{margin:0;padding:9px 12px 10px 26px;color:#526a7a;font-size:.68rem;line-height:1.4}
  .backup-real-data li+li{margin-top:5px}.backup-empty-line{display:block;padding:9px 10px;color:#81909b;font-size:.68rem}

  @media(max-width:900px){.restore-modal{padding:6px}.restore-panel{width:100%;max-height:97vh;border-radius:14px}.restore-body{padding:12px}.restore-columns{grid-template-columns:1fr}.restore-summary{grid-template-columns:1fr 1fr}.restore-tools{grid-template-columns:1fr 1fr}.restore-tools input{grid-column:1/-1}.restore-foot{flex-wrap:wrap}.restore-foot button{flex:1 1 180px}}
  @media(max-width:1179px){#backupRestoreCard{grid-column:1/-1}}
  `;
  document.head.appendChild(s);
}
function buildCard(){
  const c=document.createElement('section');c.id='backupRestoreCard';c.className='card admin-core-card';c.innerHTML=`
  <div class="admin-core-head"><div><h2>Respaldo y restauración</h2><p>Protección integral de la información capturada.</p></div><span class="backup-badge">JSON</span></div>
  <div class="backup-note">Descarga un respaldo TOTAL o carga un archivo para revisar y restablecer versiones de profesores.</div>
  <div class="backup-actions"><button id="btnFullBackup" type="button">↓ Descargar respaldo TOTAL</button><label id="backupFileLabel" for="backupFileInput">↑ Cargar respaldo para restablecer</label><input id="backupFileInput" type="file" accept=".json,application/json"></div>
  <div id="backupRestoreStatus">Sin operaciones de respaldo en esta sesión.</div>`;return c;
}
function cleanAdmin(){
  $('commissionsAdminCard')?.remove();
  const b=$('commissionsBlock');if(b){b.classList.remove('hidden');b.style.display='';const n=b.querySelector('.required-note');if(n)n.textContent='Opcional · referencia para planeación';}
}
function renderAdmin(user){
  cleanAdmin();$('backupRestoreCard')?.remove();
  if(!user||String(user.email||'').trim().toLowerCase()!==adminEmail())return;
  const g=$('admin')?.querySelector('.admin-core-grid');if(!g)return;
  g.appendChild(buildCard());
  $('btnFullBackup').onclick=window.exportFullBackup;
  $('backupFileInput').onchange=async e=>{
    const f=e.target.files?.[0];if(!f)return;
    try{setCardStatus('Validando respaldo…','working');await loadBackupFile(f);}catch(err){console.error(err);loadedBackup=null;setCardStatus(err.message||'Archivo no válido.','error');alert(err.message||'Archivo no válido.');}
    e.target.value='';
  };
}
function boot(){
  styles();injectModal();
  const a=getFirebaseApp(),auth=getAuth(a);
  if(authUnsub)authUnsub();
  authUnsub=onAuthStateChanged(auth,u=>setTimeout(()=>renderAdmin(u),120));
  const ad=$('admin');if(ad)new MutationObserver(()=>{cleanAdmin();const u=auth.currentUser;if(u&&String(u.email||'').trim().toLowerCase()===adminEmail()&&!$('backupRestoreCard'))renderAdmin(u);}).observe(ad,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
