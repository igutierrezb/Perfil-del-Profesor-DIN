/*
 Perfil DIN · Sincronización multidispositivo V2
 2026-09-29

 V2 añade soporte explícito para restauraciones administrativas:
 si adminRestoreToken cambia, la versión remota restaurada prevalece incluso
 cuando exista una copia local antigua o marcada como pendiente.
*/
import { initializeApp,getApps,getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth,onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore,doc,onSnapshot } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

let unsub=null,pending=null,timer=null,lastRev=0,lastUpdated=0;
const RESTORE_TOKEN_KEY='PAD_LAST_ADMIN_RESTORE_TOKEN';

function configured(){const c=window.FIREBASE_CONFIG||{};return !!(c.apiKey&&c.projectId&&c.appId)}
function app(){if(!configured())return null;return getApps().length?getApp():initializeApp(window.FIREBASE_CONFIG)}
function readStore(){try{return JSON.parse(localStorage.getItem('PAD_UTEQ')||'{}')}catch(_){return {}}}
function write(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(_){return false}}
function tms(v){if(!v)return 0;if(typeof v==='number')return v;if(typeof v.toDate==='function')return v.toDate().getTime();if(Number.isFinite(v.seconds))return Number(v.seconds)*1000+Math.floor((Number(v.nanoseconds)||0)/1e6);return 0}
function activeEditor(){const e=document.activeElement;return !!e&&(e.matches?.('input,textarea,select,[contenteditable="true"]')||!!e.closest?.('input,textarea,select,[contenteditable="true"]'))}
function notice(text){
 let e=document.getElementById('multiDeviceSyncNotice');
 if(!e){e=document.createElement('div');e.id='multiDeviceSyncNotice';e.style.cssText='position:fixed;right:16px;bottom:16px;z-index:99999;max-width:360px;padding:11px 14px;border-radius:12px;background:#0b4e79;color:#fff;font:600 13px/1.35 system-ui,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.18);display:none';document.body.appendChild(e)}
 e.textContent=text;e.style.display='block'
}
function hide(){const e=document.getElementById('multiDeviceSyncNotice');if(e)e.style.display='none'}
function version(d){return {revision:Number(d?.dataRevision||0),updatedAt:Number(d?.clientUpdatedAt||0)||tms(d?.updatedAt)}}
function localVersion(){const s=readStore();return {revision:Number(s.dataRevision||0),updatedAt:Number(s.localUpdatedAt||s.lastSavedAt||0),pending:!!s.syncPending}}
function restoreTokenChanged(d){
 const token=String(d?.adminRestoreToken||'');
 if(!token)return false;
 return token!==String(localStorage.getItem(RESTORE_TOKEN_KEY)||'');
}
function newer(d){
 if(restoreTokenChanged(d))return true;
 const r=version(d),l=localVersion();
 if(l.pending)return false;
 if(r.revision>0&&l.revision>0)return r.revision>l.revision;
 return r.updatedAt>l.updatedAt+250
}
function merge(d,uid){
 const cur=readStore(),v=version(d);
 const next={...cur,profile:d.profile||{},answers:d.answers||{},programMeta:d.programMeta||{},planningByPeriod:d.planningByPeriod&&typeof d.planningByPeriod==='object'?d.planningByPeriod:(cur.planningByPeriod||{}),submittedPeriod:d.submittedPeriod||null,finalizedAtMs:Number(d.finalizedAtMs||0)||null,individualEditEnabled:!!d.individualEditEnabled,individualEditDisabled:!!d.individualEditDisabled,profileResetToken:d.profileResetToken||null,profileDeletionToken:d.profileDeletionToken||null,localUpdatedAt:v.updatedAt||Date.now(),cloudUpdatedAt:v.updatedAt||Date.now(),dataRevision:v.revision||Number(cur.dataRevision||0),syncPending:false,lastSavedAt:v.updatedAt||Date.now(),adminRestoreToken:d.adminRestoreToken||null};
 write('PAD_UTEQ',next);
 write(`PAD_UTEQ_PROFILE_${uid}`,{profile:next.profile,answers:next.answers,programMeta:next.programMeta,planningByPeriod:next.planningByPeriod,submittedPeriod:next.submittedPeriod,finalizedAtMs:next.finalizedAtMs,profileResetToken:next.profileResetToken,profileDeletionToken:next.profileDeletionToken,currentProgramIndex:Number(next.currentProgramIndex||0),localUpdatedAt:next.localUpdatedAt,cloudUpdatedAt:next.cloudUpdatedAt,syncPending:false,dataRevision:next.dataRevision,adminRestoreToken:next.adminRestoreToken,savedAt:Date.now()});
 if(d.adminRestoreToken)localStorage.setItem(RESTORE_TOKEN_KEY,String(d.adminRestoreToken));
 lastRev=v.revision;lastUpdated=v.updatedAt
}
function apply(uid){
 clearTimeout(timer);
 timer=setTimeout(()=>{
  if(!pending)return;
  const forced=restoreTokenChanged(pending);
  if(activeEditor()&&!forced){notice('Hay cambios nuevos de otro dispositivo. Se aplicarán al terminar de editar este campo.');apply(uid);return}
  const d=pending;pending=null;if(!newer(d)){hide();return}
  notice(forced?'Administración restauró una versión respaldada. Actualizando perfil…':'Cambios recibidos de otro dispositivo. Actualizando…');
  merge(d,uid);setTimeout(()=>location.reload(),500)
 },500)
}
function listen(user){
 if(unsub){unsub();unsub=null}if(!user)return;
 const a=app();if(!a)return;const db=getFirestore(a),ref=doc(db,'profiles',user.uid);
 unsub=onSnapshot(ref,s=>{
  if(!s.exists())return;const d=s.data()||{};if(d.deletedByAdmin===true)return;
  const v=version(d);
  if(!restoreTokenChanged(d)&&v.revision&&v.revision<=lastRev&&v.updatedAt<=lastUpdated)return;
  if(!newer(d))return;
  pending=d;apply(user.uid)
 },e=>console.warn('Sincronización multidispositivo temporalmente no disponible',e))
}
function boot(){
 const a=app();if(!a)return;const auth=getAuth(a);
 onAuthStateChanged(auth,u=>{pending=null;hide();listen(u)});
 document.addEventListener('focusout',()=>{const u=auth.currentUser;if(pending&&u)apply(u.uid)});
 document.addEventListener('visibilitychange',()=>{const u=auth.currentUser;if(!document.hidden&&pending&&u)apply(u.uid)})
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
