/*
 Perfil DIN · Guardián de restauración y reapertura de edición V1
 2026-09-29

 Objetivo:
 - Si Administración restauró un perfil, conservar esa versión como referencia local.
 - Cuando Administración habilita nuevamente la edición, NO permitir que una copia
   local antigua/vacía reemplace profile, answers o programMeta restaurados.
 - No escribe cambios académicos en Firestore; solo rehidrata el almacenamiento local
   con el documento remoto que ya existe y recarga la interfaz.
*/

import { initializeApp,getApps,getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth,onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore,doc,onSnapshot } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

let unsub=null;
let previousEditState=null;
let lastRestoreToken='';

function app(){
  const c=window.FIREBASE_CONFIG||{};
  if(!c.apiKey||!c.projectId||!c.appId)return null;
  return getApps().length?getApp():initializeApp(c);
}
function readJson(key){
  try{return JSON.parse(localStorage.getItem(key)||'{}')}catch(_){return {}}
}
function writeJson(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));return true}catch(_){return false}
}
function hasProgramData(d){
  return Object.keys(d?.answers||{}).length>0 || Object.keys(d?.programMeta||{}).length>0;
}
function remoteVersion(d){
  return Number(d?.dataRevision||0);
}
function hydrateLocalFromRemote(uid,d){
  const current=readJson('PAD_UTEQ');
  const now=Number(d.clientUpdatedAt||0)||Date.now();
  const next={
    ...current,
    profile:d.profile||{},
    answers:d.answers||{},
    programMeta:d.programMeta||{},
    planningByPeriod:d.planningByPeriod&&typeof d.planningByPeriod==='object'?d.planningByPeriod:{},
    submittedPeriod:d.submittedPeriod||null,
    finalizedAtMs:Number(d.finalizedAtMs||0)||null,
    individualEditEnabled:!!d.individualEditEnabled,
    individualEditDisabled:!!d.individualEditDisabled,
    profileResetToken:d.profileResetToken||null,
    profileDeletionToken:d.profileDeletionToken||null,
    adminRestoreToken:d.adminRestoreToken||null,
    dataRevision:remoteVersion(d),
    localUpdatedAt:now,
    cloudUpdatedAt:now,
    lastSavedAt:now,
    syncPending:false
  };
  writeJson('PAD_UTEQ',next);

  writeJson(`PAD_UTEQ_PROFILE_${uid}`,{
    profile:next.profile,
    answers:next.answers,
    programMeta:next.programMeta,
    planningByPeriod:next.planningByPeriod,
    submittedPeriod:next.submittedPeriod,
    finalizedAtMs:next.finalizedAtMs,
    profileResetToken:next.profileResetToken,
    profileDeletionToken:next.profileDeletionToken,
    adminRestoreToken:next.adminRestoreToken,
    currentProgramIndex:Number(next.currentProgramIndex||0),
    localUpdatedAt:now,
    cloudUpdatedAt:now,
    syncPending:false,
    dataRevision:next.dataRevision,
    savedAt:Date.now()
  });

  if(d.adminRestoreToken){
    writeJson(`PAD_RESTORE_GUARD_${uid}`,{
      token:String(d.adminRestoreToken),
      profile:next.profile,
      answers:next.answers,
      programMeta:next.programMeta,
      planningByPeriod:next.planningByPeriod,
      submittedPeriod:next.submittedPeriod,
      finalizedAtMs:next.finalizedAtMs,
      dataRevision:next.dataRevision,
      updatedAt:Date.now()
    });
  }
}
function notice(text){
  let el=document.getElementById('restoreEditGuardNotice');
  if(!el){
    el=document.createElement('div');
    el.id='restoreEditGuardNotice';
    el.style.cssText='position:fixed;right:18px;bottom:18px;z-index:99999;max-width:390px;padding:11px 14px;border-radius:12px;background:#1c516e;color:#fff;font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.18);display:none';
    document.body.appendChild(el);
  }
  el.textContent=text;el.style.display='block';
}
function start(user){
  if(unsub){unsub();unsub=null}
  previousEditState=null;
  lastRestoreToken='';
  if(!user)return;

  const a=app();if(!a)return;
  const db=getFirestore(a);

  unsub=onSnapshot(doc(db,'profiles',user.uid),snap=>{
    if(!snap.exists())return;
    const d=snap.data()||{};
    if(d.deletedByAdmin===true)return;

    const token=String(d.adminRestoreToken||'');
    const editNow=!!d.individualEditEnabled;
    const tokenChanged=!!token && token!==lastRestoreToken;
    const editReopened=previousEditState===false && editNow===true;

    // Si llega una restauración, siempre copiarla al respaldo local.
    if(tokenChanged){
      hydrateLocalFromRemote(user.uid,d);
      lastRestoreToken=token;
      previousEditState=editNow;
      notice('Administración restauró una versión respaldada. Actualizando el perfil local…');
      setTimeout(()=>location.reload(),450);
      return;
    }

    // Punto crítico: al habilitar edición después de una restauración,
    // la información remota completa debe volver a sembrar el almacenamiento local
    // antes de que la aplicación pueda recuperar una copia antigua.
    if(editReopened && token && hasProgramData(d)){
      const guard=readJson(`PAD_RESTORE_GUARD_${user.uid}`);
      const local=readJson(`PAD_UTEQ_PROFILE_${user.uid}`);

      const localToken=String(local.adminRestoreToken||'');
      const localHas=hasProgramData(local);
      const guardToken=String(guard.token||'');

      if(localToken!==token || !localHas || guardToken===token){
        hydrateLocalFromRemote(user.uid,d);
        notice('Edición habilitada. Se conservaron íntegramente los datos restaurados.');
        setTimeout(()=>location.reload(),450);
        previousEditState=editNow;
        return;
      }
    }

    previousEditState=editNow;
    if(token)lastRestoreToken=token;
  },e=>console.warn('Guardia de restauración no disponible temporalmente',e));
}
function boot(){
  const a=app();if(!a)return;
  const auth=getAuth(a);
  onAuthStateChanged(auth,start);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
