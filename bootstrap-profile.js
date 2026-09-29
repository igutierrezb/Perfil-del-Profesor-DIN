/*
 Perfil DIN · Arranque protegido V69
 Evita que una copia local antigua/vacía sobrescriba un perfil recién restaurado.
*/
import { initializeApp,getApps,getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth,onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore,doc,getDoc } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

function app(){
  const c=window.FIREBASE_CONFIG||{};
  if(!c.apiKey||!c.projectId||!c.appId)return null;
  return getApps().length?getApp():initializeApp(c);
}
function readJson(k){try{return JSON.parse(localStorage.getItem(k)||'{}')}catch(_){return {}}}
function writeJson(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(_){return false}}
function hasData(d){
  return !!d && (
    Object.keys(d.profile||{}).length>0 ||
    Object.keys(d.answers||{}).length>0 ||
    Object.keys(d.programMeta||{}).length>0 ||
    Object.keys(d.planningByPeriod||{}).length>0
  );
}
function shouldRemoteWin(uid,d){
  if(!d||d.deletedByAdmin===true)return false;
  const rt=String(d.adminRestoreToken||'');
  if(!rt)return false;
  const local=readJson(`PAD_UTEQ_PROFILE_${uid}`);
  return hasData(d) && (
    String(local.adminRestoreToken||'')!==rt ||
    Number(d.dataRevision||0)>Number(local.dataRevision||0) ||
    !hasData(local)
  );
}
function hydrate(uid,d){
  const cur=readJson('PAD_UTEQ');
  const now=Number(d.clientUpdatedAt||0)||Date.now();
  const next={...cur,
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
    dataRevision:Number(d.dataRevision||0),
    localUpdatedAt:now,cloudUpdatedAt:now,lastSavedAt:now,syncPending:false
  };
  writeJson('PAD_UTEQ',next);
  writeJson(`PAD_UTEQ_PROFILE_${uid}`,{
    profile:next.profile,answers:next.answers,programMeta:next.programMeta,
    planningByPeriod:next.planningByPeriod,submittedPeriod:next.submittedPeriod,
    finalizedAtMs:next.finalizedAtMs,profileResetToken:next.profileResetToken,
    profileDeletionToken:next.profileDeletionToken,adminRestoreToken:next.adminRestoreToken,
    currentProgramIndex:Number(next.currentProgramIndex||0),localUpdatedAt:now,
    cloudUpdatedAt:now,syncPending:false,dataRevision:next.dataRevision,savedAt:Date.now()
  });
  localStorage.setItem('PAD_LAST_ADMIN_RESTORE_TOKEN',String(d.adminRestoreToken||''));
}
async function preflight(){
  const a=app();if(!a)return;
  const auth=getAuth(a);
  const user=await new Promise(resolve=>{
    let done=false;
    const finish=v=>{if(done)return;done=true;resolve(v)};
    const unsub=onAuthStateChanged(auth,u=>{try{unsub()}catch(_){};finish(u)},()=>finish(null));
    setTimeout(()=>{try{unsub()}catch(_){};finish(auth.currentUser||null)},1200);
  });
  if(!user)return;
  try{
    const snap=await getDoc(doc(getFirestore(a),'profiles',user.uid));
    if(snap.exists()){
      const d=snap.data()||{};
      if(shouldRemoteWin(user.uid,d))hydrate(user.uid,d);
    }
  }catch(e){console.warn('Preflight de restauración no disponible.',e)}
}
await preflight();
await import('./app.js?v=20260929-69');
await import('./edit-restore-authority.js?v=20260929-1');
await import('./realtime-sync.js?v=20260929-5');
await import('./backup.js?v=20260929-9');
