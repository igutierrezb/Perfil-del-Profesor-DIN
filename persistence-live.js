/*
 Perfil Académico Docente DIN
 Sincronización persistente multidispositivo V74
 2026-09-29

 - Escucha únicamente versiones remotas realmente más nuevas.
 - Nunca vacía una copia local válida por un documento remoto vacío accidental.
 - Evita recargar mientras el usuario está escribiendo.
 - Al volver a la pestaña o recuperar internet verifica nuevamente Firestore.
*/

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const PROFILE_PREFIX='PAD_UTEQ_PROFILE_';
let unsubscribe=null;
let pendingRemote=null;
let pendingUid=null;
let applyTimer=null;

function firebaseApp(){
  const c=window.FIREBASE_CONFIG||{};
  if(!c.apiKey||!c.projectId||!c.appId)return null;
  return getApps().length?getApp():initializeApp(c);
}
function readJson(key){
  try{
    const raw=localStorage.getItem(key);
    return raw?JSON.parse(raw):{};
  }catch(_){return {}}
}
function writeJson(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));return true}
  catch(e){console.warn('No fue posible actualizar persistencia local',e);return false}
}
function timestampMs(v){
  if(!v)return 0;
  if(typeof v==='number')return v;
  if(typeof v.toDate==='function')return v.toDate().getTime();
  if(Number.isFinite(Number(v.seconds)))return Number(v.seconds)*1000+Math.floor(Number(v.nanoseconds||0)/1e6);
  return 0;
}
function hasTeacherData(d){
  if(!d||typeof d!=='object')return false;
  const p=d.profile||{};
  return !!(
    p.apPat||p.apMat||p.nombres||p.categoria||p.gradoAcademico||
    Object.values(p.extra||{}).some(Boolean)||
    Object.keys(d.answers||{}).length||
    Object.keys(d.programMeta||{}).length||
    Object.keys(d.planningByPeriod||{}).length||
    d.submittedPeriod||d.finalizedAtMs
  );
}
function remoteVersion(d){
  return {
    revision:Number(d?.dataRevision||0),
    updatedAt:Number(d?.clientUpdatedAt||0)||timestampMs(d?.updatedAt)
  };
}
function localVersion(d){
  return {
    revision:Number(d?.dataRevision||0),
    updatedAt:Number(d?.localUpdatedAt||d?.savedAt||0)
  };
}
function isRemoteNewer(remote,local){
  if(!remote||remote.deletedByAdmin===true)return false;

  const rh=hasTeacherData(remote),lh=hasTeacherData(local);
  if(!rh)return false;
  if(!lh)return true;

  const rv=remoteVersion(remote),lv=localVersion(local);
  if(rv.revision>0&&lv.revision>0){
    if(rv.revision!==lv.revision)return rv.revision>lv.revision;
    return rv.updatedAt>lv.updatedAt+250;
  }
  return rv.updatedAt>lv.updatedAt+250;
}
function activeEditor(){
  const el=document.activeElement;
  return !!el&&(
    el.matches?.('input,textarea,select,[contenteditable="true"]')||
    !!el.closest?.('input,textarea,select,[contenteditable="true"]')
  );
}
function hydrate(uid,d){
  const shared=readJson('PAD_UTEQ');
  const prior=readJson(PROFILE_PREFIX+uid);
  const v=remoteVersion(d);
  const now=v.updatedAt||Date.now();

  const teacher={
    profile:d.profile&&typeof d.profile==='object'?d.profile:{},
    answers:d.answers&&typeof d.answers==='object'?d.answers:{},
    programMeta:d.programMeta&&typeof d.programMeta==='object'?d.programMeta:{},
    planningByPeriod:d.planningByPeriod&&typeof d.planningByPeriod==='object'?d.planningByPeriod:{},
    submittedPeriod:d.submittedPeriod||null,
    finalizedAtMs:Number(d.finalizedAtMs||0)||null,
    individualEditEnabled:!!d.individualEditEnabled,
    individualEditDisabled:!!d.individualEditDisabled,
    profileResetToken:d.profileResetToken||null,
    profileDeletionToken:d.profileDeletionToken||null,
    currentProgramIndex:0,
    localUpdatedAt:now,
    cloudUpdatedAt:now,
    syncPending:false,
    dataRevision:v.revision,
    savedAt:Date.now()
  };

  writeJson(PROFILE_PREFIX+uid,teacher);
  writeJson('PAD_UTEQ',{
    ...shared,
    ...teacher,
    answers:teacher.answers,
    programMeta:teacher.programMeta,
    planningByPeriod:teacher.planningByPeriod
  });
}
function notice(text){
  let el=document.getElementById('dinPersistenceNotice');
  if(!el){
    el=document.createElement('div');
    el.id='dinPersistenceNotice';
    el.style.cssText='position:fixed;right:16px;bottom:16px;z-index:99999;max-width:340px;padding:10px 13px;border-radius:11px;background:#174f6e;color:#fff;font:500 12px/1.35 system-ui,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.18);display:none';
    document.body.appendChild(el);
  }
  el.textContent=text;
  el.style.display='block';
}
function scheduleApply(uid,d){
  pendingUid=uid;
  pendingRemote=d;
  clearTimeout(applyTimer);
  applyTimer=setTimeout(()=>{
    if(!pendingRemote||!pendingUid)return;

    // No interrumpir un campo activo. Al terminar de editar se aplicará.
    if(activeEditor()){
      notice('Hay una versión más reciente guardada en otro dispositivo. Se actualizará al terminar de editar este campo.');
      scheduleApply(pendingUid,pendingRemote);
      return;
    }

    const local=readJson(PROFILE_PREFIX+pendingUid);
    if(!isRemoteNewer(pendingRemote,local)){
      pendingRemote=null;
      pendingUid=null;
      return;
    }

    hydrate(pendingUid,pendingRemote);
    pendingRemote=null;
    pendingUid=null;
    notice('Se recibió una versión más reciente de su perfil. Actualizando…');
    setTimeout(()=>location.reload(),420);
  },500);
}
async function verifyNow(user){
  if(!user)return;
  try{
    const db=getFirestore(firebaseApp());
    const snap=await getDoc(doc(db,'profiles',user.uid));
    if(!snap.exists())return;
    const d=snap.data()||{};
    if(d.deletedByAdmin===true)return; // app.js administra la eliminación explícita.
    const local=readJson(PROFILE_PREFIX+user.uid);
    if(isRemoteNewer(d,local))scheduleApply(user.uid,d);
  }catch(_){}
}
function listen(user){
  if(unsubscribe){unsubscribe();unsubscribe=null}
  pendingRemote=null;
  pendingUid=null;
  if(!user)return;

  const db=getFirestore(firebaseApp());
  unsubscribe=onSnapshot(doc(db,'profiles',user.uid),snap=>{
    if(!snap.exists())return;
    const d=snap.data()||{};
    if(d.deletedByAdmin===true)return;

    const local=readJson(PROFILE_PREFIX+user.uid);
    if(isRemoteNewer(d,local))scheduleApply(user.uid,d);
  },e=>console.warn('Sincronización multidispositivo temporalmente no disponible',e));
}
function boot(){
  const app=firebaseApp();
  if(!app)return;
  const auth=getAuth(app);

  onAuthStateChanged(auth,user=>listen(user));

  document.addEventListener('focusout',()=>{
    const user=auth.currentUser;
    if(user&&pendingRemote)scheduleApply(user.uid,pendingRemote);
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)verifyNow(auth.currentUser);
  });
  window.addEventListener('online',()=>verifyNow(auth.currentUser));
  window.addEventListener('focus',()=>verifyNow(auth.currentUser));
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',boot,{once:true});
}else{
  boot();
}
