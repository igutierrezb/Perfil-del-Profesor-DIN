/*
 Perfil Académico Docente DIN
 Arranque protegido de persistencia V73
 2026-09-29

 Objetivo:
 - Firestore es la fuente persistente principal del perfil.
 - La copia local por UID es una capa de recuperación, nunca una razón para borrar nube.
 - Antes de iniciar app.js se compara la versión local con la remota.
 - Si Firestore tiene una revisión más reciente, se hidrata localStorage con esa versión.
 - Si la copia local es más reciente, se conserva para que app.js la sincronice.
 - Una nube vacía accidental nunca sustituye una copia local válida.
*/

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const PROFILE_PREFIX='PAD_UTEQ_PROFILE_';

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
  try{
    localStorage.setItem(key,JSON.stringify(value));
    return true;
  }catch(e){
    console.warn('Persistencia local no disponible',e);
    return false;
  }
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
function remoteShouldHydrate(remote,local){
  if(!remote||remote.deletedByAdmin===true)return false;

  const remoteHas=hasTeacherData(remote);
  const localHas=hasTeacherData(local);
  if(!remoteHas)return false;
  if(!localHas)return true;

  const rv=remoteVersion(remote),lv=localVersion(local);

  if(rv.revision>0&&lv.revision>0){
    if(rv.revision!==lv.revision)return rv.revision>lv.revision;
    return rv.updatedAt>lv.updatedAt+250;
  }
  return rv.updatedAt>lv.updatedAt+250;
}
function hydrateFromRemote(uid,d){
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
    currentProgramIndex:Number.isInteger(prior.currentProgramIndex)?prior.currentProgramIndex:0,
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
async function waitForUser(auth,timeout=1600){
  if(auth.currentUser)return auth.currentUser;
  return await new Promise(resolve=>{
    let done=false;
    const finish=user=>{
      if(done)return;
      done=true;
      try{unsub()}catch(_){}
      resolve(user||null);
    };
    const unsub=onAuthStateChanged(auth,finish,()=>finish(null));
    setTimeout(()=>finish(auth.currentUser||null),timeout);
  });
}
async function preflight(){
  const app=firebaseApp();
  if(!app)return;

  const auth=getAuth(app);
  const user=await waitForUser(auth);
  if(!user)return;

  try{
    const db=getFirestore(app);
    const snap=await getDoc(doc(db,'profiles',user.uid));
    if(!snap.exists())return;

    const remote=snap.data()||{};
    const local=readJson(PROFILE_PREFIX+user.uid);

    if(remoteShouldHydrate(remote,local)){
      hydrateFromRemote(user.uid,remote);
    }
  }catch(e){
    // Sin conexión: app.js continuará con la copia local por UID que ya conserva.
    console.warn('Verificación remota inicial no disponible; se conserva el estado local.',e);
  }
}

await preflight();
await import('./app.js?v=20260929-73');
await import('./persistence-live.js?v=20260929-73');
