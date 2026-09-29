/*
 Perfil Académico Docente DIN
 V76 · Flujo estricto + eliminación de respaldos
 2026-09-29

 Objetivos:
 1) Mientras un profesor está editando, las pestañas superiores 1/2/3 son solo indicadores.
 2) El avance válido se hace únicamente con los botones inferiores.
 3) Al pasar de Paso 1 a Paso 2, siempre se entra en Programa 1.
 4) El módulo visual "Respaldo y restauración" se elimina si alguna caché antigua intentara insertarlo.
 5) No se toca profile, answers, programMeta, planningByPeriod ni Firestore.
*/

(function(){
  'use strict';

  const ADMIN_EMAIL='ivan.gutierrez@uteq.edu.mx';
  const WORK_KEY='PAD_UTEQ';
  const PROFILE_PREFIX='PAD_UTEQ_PROFILE_';

  let forceProgramOne=false;
  let repairTimer=null;

  function readJson(key){
    try{
      const raw=localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }catch(_){ return null; }
  }

  function writeJson(key,value){
    try{
      localStorage.setItem(key,JSON.stringify(value));
      return true;
    }catch(_){ return false; }
  }

  function visibleAdminTab(){
    const tab=document.getElementById('adminTab');
    return !!tab && !tab.classList.contains('hidden');
  }

  function currentEmail(){
    const text=String(document.getElementById('authStatus')?.textContent||'')
      .trim().toLowerCase();
    const match=text.match(/[a-z0-9._%+-]+@uteq\.edu\.mx/i);
    return match ? match[0].toLowerCase() : '';
  }

  function isAdmin(){
    return visibleAdminTab() || currentEmail()===ADMIN_EMAIL;
  }

  function teacherIsEditing(){
    if(isAdmin()) return false;
    // app.js coloca esta clase cuando el profesor está en modo solo lectura.
    return !document.body.classList.contains('profile-edit-locked');
  }

  function scrubSavedProgramPosition(){
    try{
      const work=readJson(WORK_KEY);
      if(work && typeof work==='object'){
        work.currentProgramIndex=0;
        writeJson(WORK_KEY,work);
      }

      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);
        if(!key || !key.startsWith(PROFILE_PREFIX)) continue;
        const profile=readJson(key);
        if(!profile || typeof profile!=='object') continue;
        profile.currentProgramIndex=0;
        writeJson(key,profile);
      }
    }catch(e){
      console.warn('V76: no fue posible normalizar currentProgramIndex.',e);
    }
  }

  function removeBackupUI(){
    const card=document.getElementById('backupRestoreCard');
    if(card) card.remove();

    const modal=document.getElementById('restoreModal');
    if(modal) modal.remove();

    // Falla segura para una versión antigua del módulo.
    document.querySelectorAll('#admin .admin-core-card').forEach(card=>{
      const title=String(card.querySelector('h2')?.textContent||'').trim().toLowerCase();
      if(title==='respaldo y restauración') card.remove();
    });
  }

  function topStepButton(target){
    const btn=target.closest?.('.main-nav button[data-view]');
    if(!btn) return null;
    return ['perfil','captura','revision'].includes(btn.dataset.view) ? btn : null;
  }

  function applyIndicatorAppearance(){
    document.querySelectorAll(
      '.main-nav button[data-view="perfil"],'+
      '.main-nav button[data-view="captura"],'+
      '.main-nav button[data-view="revision"]'
    ).forEach(btn=>{
      const locked=teacherIsEditing();
      btn.classList.toggle('v76-indicator-only',locked);
      if(locked){
        btn.setAttribute('aria-disabled','true');
        btn.title='Durante la edición, avance únicamente con los botones inferiores.';
      }else{
        btn.removeAttribute('aria-disabled');
        if(btn.title==='Durante la edición, avance únicamente con los botones inferiores.'){
          btn.removeAttribute('title');
        }
      }
    });
  }

  function captureIsActive(){
    return !!document.getElementById('captura')?.classList.contains('active');
  }

  function programPosition(){
    const text=String(document.getElementById('programStep')?.textContent||'')
      .replace(/\s+/g,' ')
      .trim();
    const m=text.match(/Programa\s+(\d+)\s+de\s+(\d+)/i);
    return m ? {current:Number(m[1]),total:Number(m[2])} : null;
  }

  function forceInternalProgramOne(){
    if(!forceProgramOne || !captureIsActive()) return;

    clearTimeout(repairTimer);
    repairTimer=setTimeout(()=>{
      const pos=programPosition();
      if(!pos) return;

      if(pos.current===1){
        scrubSavedProgramPosition();
        forceProgramOne=false;
        return;
      }

      // Esta función pertenece a app.js y cambia el índice interno real.
      if(typeof window.goToCaptureIssue==='function'){
        try{
          window.goToCaptureIssue(0,0,0,'competence');
          scrubSavedProgramPosition();

          setTimeout(()=>{
            const after=programPosition();
            if(after?.current===1){
              forceProgramOne=false;
            }
          },100);
        }catch(e){
          console.warn('V76: no fue posible mover el programa interno a 1.',e);
        }
      }
    },70);
  }

  // Antes de que app.js termine de recuperar estado.
  scrubSavedProgramPosition();

  // Las pestañas superiores no navegan durante edición.
  document.addEventListener('click',event=>{
    const top=topStepButton(event.target);

    if(top && teacherIsEditing()){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if(typeof window.toast==='function'){
        window.toast('Para conservar el orden de captura, avance con los botones inferiores.');
      }
      return;
    }

    // Botón válido del final de Paso 1.
    const continueBtn=event.target.closest?.('#continueProfileBtn');
    if(continueBtn && !continueBtn.disabled && teacherIsEditing()){
      scrubSavedProgramPosition();
      forceProgramOne=true;
    }
  },true);

  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter' && event.key!==' ') return;
    const top=topStepButton(event.target);
    if(top && teacherIsEditing()){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  },true);

  function maintenance(){
    removeBackupUI();
    applyIndicatorAppearance();
    forceInternalProgramOne();
  }

  function boot(){
    const style=document.createElement('style');
    style.id='v76FlowStyle';
    style.textContent=`
      #backupRestoreCard,#restoreModal{display:none!important}
      .main-nav button.v76-indicator-only{
        cursor:default!important;
      }
      .main-nav button.v76-indicator-only:hover{
        transform:none!important;
      }
      .main-nav button.v76-indicator-only:not(.active){
        opacity:.68;
      }
    `;
    document.head.appendChild(style);

    maintenance();

    // backup.js antiguo, app.js y Firebase pueden renderizar después:
    // observar continuamente para mantener la regla.
    const observer=new MutationObserver(maintenance);
    observer.observe(document.documentElement,{
      subtree:true,
      childList:true,
      attributes:true,
      attributeFilter:['class','disabled']
    });

    [250,700,1400,2500,4500].forEach(ms=>{
      setTimeout(()=>{
        scrubSavedProgramPosition();
        maintenance();
      },ms);
    });

    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden) maintenance();
    });
    window.addEventListener('focus',maintenance);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',boot,{once:true});
  }else{
    boot();
  }
})();
