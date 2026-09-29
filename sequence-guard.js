/*
 Perfil Académico Docente DIN
 V75 · Guardia definitiva de navegación secuencial
 2026-09-29

 Objetivo:
 - Las pestañas superiores 1/2/3 son INDICADORES mientras el profesor está editando.
 - El avance válido se realiza exclusivamente con los botones inferiores.
 - Al iniciar o retomar una edición, Perfil por programa siempre parte de Programa 1.
 - No se elimina ni modifica información académica.
*/

(function(){
  'use strict';

  const WORK_KEY='PAD_UTEQ';
  const PROFILE_PREFIX='PAD_UTEQ_PROFILE_';
  const SESSION_PREFIXES=['PAD_DIN_FLOW_','PAD_DIN_SEQ_','PAD_DIN_PROGRAM_'];

  let forceProgramOneOnNextCapture=false;
  let lastEditingState=null;
  let observer=null;
  let navObserver=null;
  let repairTimer=null;

  function readJson(key){
    try{
      const raw=localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }catch(_){
      return null;
    }
  }

  function writeJson(key,value){
    try{
      localStorage.setItem(key,JSON.stringify(value));
      return true;
    }catch(_){
      return false;
    }
  }

  // La posición del programa NO es información académica.
  // Se fuerza a 0 sin tocar profile/answers/programMeta/planningByPeriod.
  function scrubSavedProgramPosition(){
    try{
      const work=readJson(WORK_KEY);
      if(work && typeof work==='object'){
        work.currentProgramIndex=0;
        writeJson(WORK_KEY,work);
      }

      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);
        if(!key || !key.startsWith(PROFILE_PREFIX))continue;
        const profile=readJson(key);
        if(!profile || typeof profile!=='object')continue;
        profile.currentProgramIndex=0;
        writeJson(key,profile);
      }
    }catch(e){
      console.warn('V75: no fue posible normalizar la posición local.',e);
    }
  }

  function clearOldFlowSessions(){
    try{
      const keys=[];
      for(let i=0;i<sessionStorage.length;i++){
        const key=sessionStorage.key(i);
        if(key && SESSION_PREFIXES.some(prefix=>key.startsWith(prefix))){
          keys.push(key);
        }
      }
      keys.forEach(key=>sessionStorage.removeItem(key));
    }catch(_){}
  }

  // Se ejecuta ANTES de app.js.
  scrubSavedProgramPosition();
  clearOldFlowSessions();

  function profileInputs(){
    return [...document.querySelectorAll(
      '#perfil input, #perfil select, #perfil textarea'
    )];
  }

  function captureInputs(){
    return [...document.querySelectorAll(
      '#captura input, #captura select, #captura textarea, #captura button'
    )].filter(el=>!el.closest('.main-nav'));
  }

  function editingIsActive(){
    const profile=profileInputs();
    const capture=captureInputs();

    // Si al menos un campo académico editable está habilitado, la sesión
    // se considera de edición.
    const enabledProfile=profile.some(el=>!el.disabled && !el.readOnly);
    const enabledCapture=capture.some(el=>{
      if(el.tagName==='BUTTON'){
        // Ignorar botones meramente informativos si existieran.
        return !el.disabled && !el.classList.contains('hidden');
      }
      return !el.disabled && !el.readOnly;
    });

    return enabledProfile || enabledCapture;
  }

  function navButtons(){
    return [...document.querySelectorAll(
      '.main-nav button[data-view="perfil"],'+
      '.main-nav button[data-view="captura"],'+
      '.main-nav button[data-view="revision"]'
    )];
  }

  function setIndicatorMode(){
    const editing=editingIsActive();

    navButtons().forEach(btn=>{
      if(editing){
        btn.classList.add('sequence-indicator-only');
        btn.setAttribute('aria-disabled','true');
        btn.setAttribute(
          'title',
          'Durante la edición, avance únicamente con los botones inferiores.'
        );
      }else{
        btn.classList.remove('sequence-indicator-only');
        btn.removeAttribute('aria-disabled');
        if(btn.getAttribute('title')==='Durante la edición, avance únicamente con los botones inferiores.'){
          btn.removeAttribute('title');
        }
      }
    });

    if(lastEditingState!==editing){
      // Si Administración acaba de reabrir edición en una sesión ya abierta,
      // preparar Programa 1 y volver al Paso 1 sin borrar información.
      if(lastEditingState===false && editing===true){
        scrubSavedProgramPosition();
        forceProgramOneOnNextCapture=true;

        const perfil=document.getElementById('perfil');
        if(perfil && window.go){
          try{ window.go('perfil',true); }catch(_){}
        }
      }
      lastEditingState=editing;
    }
  }

  function isTopSequentialTab(target){
    const btn=target.closest?.('.main-nav button[data-view]');
    if(!btn)return null;
    const view=btn.dataset.view;
    return ['perfil','captura','revision'].includes(view) ? btn : null;
  }

  // Bloqueo en fase CAPTURE:
  // se ejecuta antes del onclick que app.js asigna a las pestañas.
  document.addEventListener('click',event=>{
    const topBtn=isTopSequentialTab(event.target);
    if(topBtn && editingIsActive()){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if(typeof window.toast==='function'){
        window.toast('Durante la edición, avance únicamente con los botones inferiores.');
      }
      return;
    }

    // Botón válido de Paso 1 -> Paso 2.
    const continueBtn=event.target.closest?.('#continueProfileBtn');
    if(continueBtn && !continueBtn.disabled){
      // La posición almacenada vuelve a 0 justo antes de entrar a captura.
      scrubSavedProgramPosition();
      forceProgramOneOnNextCapture=true;
    }
  },true);

  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter' && event.key!==' ')return;
    const topBtn=isTopSequentialTab(event.target);
    if(topBtn && editingIsActive()){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  },true);

  function programPosition(){
    const badge=document.getElementById('programStep');
    const text=String(badge?.textContent||'').trim();
    const m=text.match(/Programa\s+(\d+)\s+de\s+(\d+)/i);
    if(!m)return null;
    return {current:Number(m[1]),total:Number(m[2])};
  }

  function captureIsActive(){
    return !!document.getElementById('captura')?.classList.contains('active');
  }

  function forceInternalProgramOne(){
    if(!captureIsActive())return false;

    const pos=programPosition();
    if(!pos)return false;

    if(pos.current===1){
      forceProgramOneOnNextCapture=false;
      scrubSavedProgramPosition();
      return true;
    }

    // app.js expone esta función y ella sí modifica el currentProgramIndex
    // INTERNO del módulo. Es la corrección que los parches anteriores no podían
    // garantizar solo modificando localStorage.
    if(typeof window.goToCaptureIssue==='function'){
      try{
        window.goToCaptureIssue(0,0,0,'competence');
        scrubSavedProgramPosition();

        setTimeout(()=>{
          const after=programPosition();
          if(after?.current===1){
            forceProgramOneOnNextCapture=false;
          }
        },80);

        return true;
      }catch(e){
        console.warn('V75: no fue posible mover el índice interno a Programa 1.',e);
      }
    }

    return false;
  }

  function verifyCaptureEntry(){
    if(!forceProgramOneOnNextCapture || !captureIsActive())return;
    clearTimeout(repairTimer);

    repairTimer=setTimeout(()=>{
      forceInternalProgramOne();
    },60);
  }

  function installObservers(){
    setIndicatorMode();

    observer=new MutationObserver(()=>{
      setIndicatorMode();
      verifyCaptureEntry();
    });

    observer.observe(document.documentElement,{
      subtree:true,
      childList:true,
      attributes:true,
      attributeFilter:['class','disabled','readonly']
    });

    const nav=document.querySelector('.main-nav');
    if(nav){
      navObserver=new MutationObserver(setIndicatorMode);
      navObserver.observe(nav,{
        subtree:true,
        childList:true,
        attributes:true,
        attributeFilter:['class','disabled','aria-disabled']
      });
    }

    // Seguridad adicional al volver a la pestaña.
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden){
        setIndicatorMode();
        verifyCaptureEntry();
      }
    });

    window.addEventListener('focus',()=>{
      setIndicatorMode();
      verifyCaptureEntry();
    });
  }

  function injectStyle(){
    if(document.getElementById('sequenceGuardV75Style'))return;

    const style=document.createElement('style');
    style.id='sequenceGuardV75Style';
    style.textContent=`
      .main-nav button.sequence-indicator-only{
        cursor:default !important;
        pointer-events:auto !important;
      }
      .main-nav button.sequence-indicator-only:hover{
        transform:none !important;
      }
      .main-nav button.sequence-indicator-only:not(.active){
        opacity:.72;
      }
    `;
    document.head.appendChild(style);
  }

  function boot(){
    injectStyle();
    installObservers();

    // app.js puede terminar de restaurar la copia por UID después del primer render.
    // Volvemos a normalizar la POSICIÓN, nunca los datos.
    [250,700,1500,3000].forEach(ms=>{
      setTimeout(()=>{
        scrubSavedProgramPosition();
        setIndicatorMode();
        verifyCaptureEntry();
      },ms);
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',boot,{once:true});
  }else{
    boot();
  }
})();
