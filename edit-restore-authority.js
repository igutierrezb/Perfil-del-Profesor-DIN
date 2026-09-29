/*
 Perfil DIN · Autoridad de edición después de restauración V1
 2026-09-29

 Problema resuelto:
 Al habilitar nuevamente la edición, una sesión del profesor podía conservar
 una copia local antigua y volver a subirla.

 Solución:
 - reemplaza únicamente window.setTeacherEditAccess;
 - si el perfil tiene adminRestoreToken, al habilitar edición crea un token NUEVO;
 - incrementa dataRevision y clientUpdatedAt;
 - no toca profile, answers, programMeta ni planningByPeriod;
 - usa merge:true;
 - así Firestore queda inequívocamente como la versión más reciente.
*/

import { initializeApp,getApps,getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore,doc,getDoc,setDoc,serverTimestamp,addDoc,collection } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

function app(){
  const c=window.FIREBASE_CONFIG||{};
  if(!c.apiKey||!c.projectId||!c.appId)return null;
  return getApps().length?getApp():initializeApp(c);
}
function adminEmail(){
  return String(window.PAD_ADMIN_EMAIL||'ivan.gutierrez@uteq.edu.mx').trim().toLowerCase();
}
function install(){
  const a=app();
  if(!a||typeof window.setTeacherEditAccess!=='function')return false;

  const auth=getAuth(a);
  const db=getFirestore(a);

  window.setTeacherEditAccess=async function(uid,enable){
    const user=auth.currentUser;
    if(!user||String(user.email||'').trim().toLowerCase()!==adminEmail())return;

    try{
      const ref=doc(db,'profiles',uid);
      const snap=await getDoc(ref);
      if(!snap.exists()){
        alert('El perfil seleccionado ya no existe.');
        return;
      }

      const d=snap.data()||{};
      const name=[
        d.profile?.nombres,
        d.profile?.apPat,
        d.profile?.apMat
      ].filter(Boolean).join(' ') || d.displayName || d.email || 'este profesor';

      const question=enable
        ?`¿Habilitar la edición para ${name}?\n\nLa información restaurada permanecerá intacta y se marcará como la versión más reciente.`
        :`¿Deshabilitar la edición para ${name}?\n\nLa información capturada permanecerá intacta.`;

      if(!confirm(question))return;

      const patch={
        individualEditEnabled:!!enable,
        individualEditDisabled:!enable,
        reopenedAt:enable?serverTimestamp():null,
        reopenedBy:enable?(user.email||''):null,
        individualEditUpdatedAt:serverTimestamp()
      };

      // Si proviene de una restauración, al reabrir edición renovamos el token.
      // Esto fuerza a móvil/escritorio a considerar el documento remoto como autoritativo.
      if(enable && d.adminRestoreToken){
        patch.adminRestoreToken=`${String(d.adminRestoreToken).split('|')[0]}|REENABLE|${Date.now()}`;
        patch.dataRevision=Math.max(0,Number(d.dataRevision||0))+1;
        patch.clientUpdatedAt=Date.now();
        patch.updatedAt=serverTimestamp();
        patch.adminRestoreReenabledAt=serverTimestamp();
      }

      await setDoc(ref,patch,{merge:true});

      try{
        await addDoc(collection(db,'audit'),{
          action:`${enable?'Edición individual habilitada':'Edición individual deshabilitada'} para ${d.email||uid}`,
          email:user.email||'',
          uid:user.uid,
          at:serverTimestamp(),
          period:''
        });
      }catch(_){}

      if(typeof window.toast==='function'){
        window.toast(enable
          ?'Edición habilitada conservando la versión restaurada.'
          :'Edición deshabilitada. La información permanece intacta.');
      }

      if(typeof window.renderTeacherAdminList==='function'){
        await window.renderTeacherAdminList();
      }else{
        setTimeout(()=>location.reload(),350);
      }
    }catch(e){
      console.error('No fue posible cambiar la edición individual',e);
      alert(`No fue posible ${enable?'habilitar':'deshabilitar'} la edición individual.`);
    }
  };

  window.toggleTeacherEditOverride=function(uid,enable){
    return window.setTeacherEditAccess(uid,enable);
  };
  window.reopenTeacherProfile=function(uid){
    return window.setTeacherEditAccess(uid,true);
  };
  return true;
}

let attempts=0;
const timer=setInterval(()=>{
  attempts++;
  if(install()||attempts>30)clearInterval(timer);
},100);
