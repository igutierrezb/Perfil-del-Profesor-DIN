/*
 Perfil Académico Docente DIN
 Flujo secuencial estricto V72
 2026-09-29

 Objetivo:
 - Si un profesor inicia/retoma edición, incluso si ya había finalizado antes,
   debe volver a confirmar Paso 1.
 - Paso 2 siempre comienza en Programa 1, conservando toda la información precargada.
 - Debe recorrer los programas 1,2,3... en orden.
 - Paso 3 solo se habilita si el flujo llegó al final mediante "Guardar y seguir".
 - No borra ni reinicia respuestas; solo reinicia el ÍNDICE de navegación.
*/

const FLOW_KEY='PAD_DIN_FLOW_V72';
const REPAIR_KEY='PAD_DIN_PROGRAM_REPAIR_V72';
let installed=false;
let wrapping=false;

function readStore(){
  try{return JSON.parse(localStorage.getItem('PAD_UTEQ')||'{}')}catch(_){return {}}
}
function writeStore(store){
  try{localStorage.setItem('PAD_UTEQ',JSON.stringify(store));return true}catch(_){return false}
}
function readFlow(){
  try{
    const raw=sessionStorage.getItem(FLOW_KEY);
    return raw?JSON.parse(raw):{
      step1:false,
      step2:false,
      expectedProgram:1,
      totalPrograms:0
    };
  }catch(_){
    return {step1:false,step2:false,expectedProgram:1,totalPrograms:0};
  }
}
function writeFlow(flow){
  try{sessionStorage.setItem(FLOW_KEY,JSON.stringify(flow))}catch(_){}
}
function currentPeriod(store){
  return String(store?.cfg?.periodo||'').trim();
}
function isFinalizedReadOnly(store){
  const period=currentPeriod(store);
  return !!period &&
    String(store?.submittedPeriod||'').trim()===period &&
    !store?.individualEditEnabled;
}
function editingSequenceApplies(store=readStore()){
  if(isFinalizedReadOnly(store))return false;
  if(store?.individualEditDisabled)return false;
  if(store?.cfg?.editingLocked && !store?.individualEditEnabled)return false;
  return true;
}
function activeViewId(){
  return document.querySelector('.view.active')?.id||'';
}
function navButton(view){
  return document.querySelector(`.main-nav button[data-view="${view}"]`);
}
function parseProgramPosition(){
  const root=document.getElementById('captura');
  if(!root)return null;
  const text=(root.innerText||root.textContent||'').replace(/\s+/g,' ');
  const matches=[...text.matchAll(/Programa\s+(\d+)\s+de\s+(\d+)/gi)];
  if(!matches.length)return null;
  // Preferir la última coincidencia visible/renderizada.
  const m=matches[matches.length-1];
  return {current:Number(m[1]),total:Number(m[2])};
}
function message(text){
  if(typeof window.toast==='function'){
    window.toast(text);
    return;
  }
  let box=document.getElementById('flowSequenceNotice');
  if(!box){
    box=document.createElement('div');
    box.id='flowSequenceNotice';
    box.style.cssText='position:fixed;right:16px;bottom:16px;z-index:99999;max-width:390px;padding:10px 13px;border-radius:11px;background:#174f6e;color:white;font:500 12px/1.35 system-ui,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.18)';
    document.body.appendChild(box);
  }
  box.textContent=text;
  clearTimeout(message.timer);
  message.timer=setTimeout(()=>box.remove(),2800);
}
function ensureStyles(){
  if(document.getElementById('flowSequenceStyles'))return;
  const style=document.createElement('style');
  style.id='flowSequenceStyles';
  style.textContent=`
    .main-nav button.flow-locked{
      opacity:.48!important;
      filter:saturate(.45);
      cursor:not-allowed!important;
      box-shadow:none!important;
      background:#f4f7f9!important;
      border-color:#d7e0e6!important;
      color:#647783!important;
    }
    .main-nav button.flow-locked:hover{
      transform:none!important;
      background:#f4f7f9!important;
    }
    .main-nav button.flow-locked::after{
      content:' 🔒';
      font-size:.72em;
      opacity:.8;
    }
    .main-nav button.flow-ready{opacity:1}
  `;
  document.head.appendChild(style);
}
function updateNavLocks(){
  ensureStyles();
  const store=readStore();
  const flow=readFlow();
  const step2=navButton('captura');
  const step3=navButton('revision');
  const restricted=editingSequenceApplies(store);

  if(!restricted){
    [step2,step3].forEach(btn=>{
      if(!btn)return;
      btn.classList.remove('flow-locked');
      btn.classList.add('flow-ready');
      btn.removeAttribute('aria-disabled');
      btn.title='';
    });
    return;
  }

  if(step2){
    const locked=!flow.step1;
    step2.classList.toggle('flow-locked',locked);
    step2.classList.toggle('flow-ready',!locked);
    step2.setAttribute('aria-disabled',locked?'true':'false');
    step2.title=locked
      ?'Confirme primero los Datos del profesor.'
      :'Datos del profesor confirmados.';
  }

  if(step3){
    const locked=!flow.step2;
    step3.classList.toggle('flow-locked',locked);
    step3.classList.toggle('flow-ready',!locked);
    step3.setAttribute('aria-disabled',locked?'true':'false');
    step3.title=locked
      ?'Recorra y confirme todos los programas en orden.'
      :'Perfil por programa concluido.';
  }
}
function resetProgramNavigationOnly(){
  const store=readStore();
  store.currentProgramIndex=0;
  writeStore(store);

  // También corregimos cualquier copia por UID presente, SIN tocar respuestas.
  try{
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(!key||!key.startsWith('PAD_UTEQ_PROFILE_'))continue;
      const data=JSON.parse(localStorage.getItem(key)||'{}');
      data.currentProgramIndex=0;
      localStorage.setItem(key,JSON.stringify(data));
    }
  }catch(_){}
}
function resetEditableFlow(){
  resetProgramNavigationOnly();
  writeFlow({
    step1:false,
    step2:false,
    expectedProgram:1,
    totalPrograms:0
  });
}
function invalidateFromStep1(){
  if(!editingSequenceApplies())return;
  resetProgramNavigationOnly();
  const flow=readFlow();
  flow.step1=false;
  flow.step2=false;
  flow.expectedProgram=1;
  flow.totalPrograms=0;
  writeFlow(flow);
  updateNavLocks();
}
function invalidateFromStep2(){
  if(!editingSequenceApplies())return;
  const flow=readFlow();
  flow.step2=false;
  writeFlow(flow);
  updateNavLocks();
}
function repairIfCaptureDidNotStartAtOne(){
  if(!editingSequenceApplies()||activeViewId()!=='captura')return false;
  const pos=parseProgramPosition();
  if(!pos||pos.current===1)return false;

  const repaired=sessionStorage.getItem(REPAIR_KEY)==='1';
  resetProgramNavigationOnly();

  if(!repaired){
    sessionStorage.setItem(REPAIR_KEY,'1');
    message(`La captura debe iniciar en Programa 1. Corrigiendo el recorrido (estaba en Programa ${pos.current}).`);
    setTimeout(()=>location.reload(),350);
  }else{
    message('La captura debe iniciar en Programa 1. Regrese a Datos del profesor y confirme nuevamente.');
    try{
      if(typeof window.go==='function')window.go('perfil',true);
    }catch(_){}
  }
  return true;
}
function afterStep1Attempt(){
  requestAnimationFrame(()=>{
    if(activeViewId()!=='captura'){
      updateNavLocks();
      return;
    }

    // Confirmación real del Paso 1.
    const flow=readFlow();
    flow.step1=true;
    flow.step2=false;
    flow.expectedProgram=1;
    writeFlow(flow);

    // Debe entrar en Programa 1.
    setTimeout(()=>{
      const pos=parseProgramPosition();
      if(pos){
        flow.totalPrograms=pos.total;
        writeFlow(flow);
      }
      if(!repairIfCaptureDidNotStartAtOne()){
        sessionStorage.removeItem(REPAIR_KEY);
        updateNavLocks();
      }
    },80);
  });
}
function protectNavClick(event){
  const btn=event.target.closest?.('.main-nav button[data-view]');
  if(!btn)return;

  const view=btn.dataset.view;
  if(view!=='captura'&&view!=='revision')return;
  if(!editingSequenceApplies())return;

  const flow=readFlow();

  if(view==='captura'&&!flow.step1){
    event.preventDefault();
    event.stopImmediatePropagation();
    message('Primero concluya y confirme los Datos del profesor.');
    updateNavLocks();
    return;
  }

  if(view==='revision'&&!flow.step2){
    event.preventDefault();
    event.stopImmediatePropagation();
    message('Primero recorra todos los programas en orden y confirme el último.');
    updateNavLocks();
    return;
  }
}
function wrapContinueToCapture(){
  if(typeof window.continueToCapture!=='function'||window.continueToCapture.__flow72)return;
  const original=window.continueToCapture;

  const wrapped=async function(...args){
    if(editingSequenceApplies()){
      // Reiniciar SOLO navegación. La información capturada permanece precargada.
      resetProgramNavigationOnly();
      const flow=readFlow();
      flow.step1=false;
      flow.step2=false;
      flow.expectedProgram=1;
      flow.totalPrograms=0;
      writeFlow(flow);
    }

    const result=await original.apply(this,args);
    afterStep1Attempt();
    return result;
  };
  wrapped.__flow72=true;
  window.continueToCapture=wrapped;
}
function wrapSaveAndNext(){
  if(typeof window.saveAndNextProgram!=='function'||window.saveAndNextProgram.__flow72)return;
  const original=window.saveAndNextProgram;

  const wrapped=function(...args){
    if(!editingSequenceApplies())return original.apply(this,args);

    const flow=readFlow();
    if(!flow.step1){
      message('Primero confirme los Datos del profesor.');
      return;
    }

    const before=parseProgramPosition();
    if(before){
      if(!flow.totalPrograms)flow.totalPrograms=before.total;

      if(before.current!==flow.expectedProgram){
        message(
          `Debe continuar en orden. Corresponde confirmar el Programa ${flow.expectedProgram}, `+
          `no el Programa ${before.current}.`
        );
        resetProgramNavigationOnly();
        writeFlow({...flow,step2:false,expectedProgram:1});
        sessionStorage.removeItem(REPAIR_KEY);
        setTimeout(()=>location.reload(),300);
        return;
      }
    }

    const beforeView=activeViewId();
    const result=original.apply(this,args);

    // La propia app valida la información del programa.
    // Solo avanzamos el marcador si la app realmente cambió de programa/vista.
    setTimeout(()=>{
      const afterView=activeViewId();
      const after=parseProgramPosition();
      const f=readFlow();

      if(beforeView==='captura'&&afterView==='captura'&&before&&after){
        if(after.current===before.current+1){
          f.expectedProgram=after.current;
          f.totalPrograms=after.total;
          f.step2=false;
          writeFlow(f);
          updateNavLocks();
          return;
        }

        // Si no avanzó, la validación de app.js encontró algo pendiente.
        if(after.current===before.current){
          f.step2=false;
          writeFlow(f);
          updateNavLocks();
          return;
        }

        // Salto inesperado de programa: no aceptarlo.
        if(after.current!==before.current+1){
          message(`Se detectó un salto de programa. El recorrido volverá al Programa 1.`);
          resetProgramNavigationOnly();
          writeFlow({step1:true,step2:false,expectedProgram:1,totalPrograms:after.total});
          setTimeout(()=>location.reload(),300);
          return;
        }
      }

      // Solo aceptar Revisión si se llegó desde el último programa esperado.
      if(afterView==='revision'){
        const total=before?.total||f.totalPrograms||0;
        const validLastProgram=!!before && total>0 &&
          before.current===total &&
          f.expectedProgram===total;

        if(validLastProgram){
          f.step1=true;
          f.step2=true;
          writeFlow(f);
          updateNavLocks();
          return;
        }

        // La aplicación intentó entrar a revisión sin recorrido secuencial completo.
        f.step2=false;
        writeFlow(f);
        message('Revisión bloqueada: primero debe confirmar todos los programas desde el Programa 1.');
        try{
          if(typeof window.go==='function')window.go('captura',true);
        }catch(_){}
        setTimeout(()=>repairIfCaptureDidNotStartAtOne(),80);
      }
    },90);

    return result;
  };

  wrapped.__flow72=true;
  window.saveAndNextProgram=wrapped;
}
function wrapValidateAndReview(){
  if(typeof window.validateAndReview!=='function'||window.validateAndReview.__flow72)return;
  const original=window.validateAndReview;

  const wrapped=function(...args){
    if(editingSequenceApplies()){
      const flow=readFlow();
      if(!flow.step2){
        message('Revisión bloqueada: concluya primero todos los programas en orden.');
        updateNavLocks();
        return;
      }
    }
    return original.apply(this,args);
  };
  wrapped.__flow72=true;
  window.validateAndReview=wrapped;
}
function wrapGo(){
  if(typeof window.go!=='function'||window.go.__flow72)return;
  const original=window.go;

  const wrapped=function(id,force=false,...rest){
    if(editingSequenceApplies()){
      const flow=readFlow();

      if(id==='captura'&&!force&&!flow.step1){
        message('Primero concluya y confirme los Datos del profesor.');
        return;
      }
      if(id==='revision'&&!force&&!flow.step2){
        message('Primero recorra y confirme todos los programas en orden.');
        return;
      }
      // Incluso llamadas internas con force no pueden saltar a revisión
      // durante una edición si Paso 2 no se completó secuencialmente.
      if(id==='revision'&&force&&!flow.step2){
        message('Revisión bloqueada hasta concluir el Perfil por programa.');
        return;
      }
    }

    return original.call(this,id,force,...rest);
  };
  wrapped.__flow72=true;
  window.go=wrapped;
}
function wrapGlobalFunctions(){
  if(wrapping)return;
  wrapping=true;
  try{
    wrapContinueToCapture();
    wrapSaveAndNext();
    wrapValidateAndReview();
    wrapGo();
  }finally{
    wrapping=false;
  }
}
function initializeSessionFlow(){
  const store=readStore();

  if(isFinalizedReadOnly(store)){
    // Perfil enviado y sin edición reabierta: consulta normal.
    writeFlow({step1:true,step2:true,expectedProgram:1,totalPrograms:0});
    updateNavLocks();
    return;
  }

  if(editingSequenceApplies(store)){
    // Incluye el caso: ya había enviado, pero Administración reabrió edición.
    resetEditableFlow();

    setTimeout(()=>{
      try{
        if(activeViewId()!=='perfil'&&typeof window.go==='function'){
          window.go('perfil',true);
        }
      }catch(_){}
      updateNavLocks();
    },100);
  }
}
function boot(){
  if(installed)return;
  installed=true;

  ensureStyles();
  wrapGlobalFunctions();
  initializeSessionFlow();

  document.addEventListener('click',protectNavClick,true);

  document.addEventListener('input',event=>{
    if(event.target.closest?.('#perfil'))invalidateFromStep1();
    else if(event.target.closest?.('#captura'))invalidateFromStep2();
  },true);

  document.addEventListener('change',event=>{
    if(event.target.closest?.('#perfil'))invalidateFromStep1();
    else if(event.target.closest?.('#captura'))invalidateFromStep2();
  },true);

  // No permitir que botones académicos de captura mantengan Paso 3 como concluido.
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('#captura'))return;
    if(event.target.closest?.('.save-btn,#flowNextBtn'))return;
    if(event.target.closest?.('button,input,label,.toggle,.ideal-btn,.mini')){
      invalidateFromStep2();
    }
  },true);

  const nav=document.querySelector('.main-nav');
  if(nav){
    new MutationObserver(()=>updateNavLocks()).observe(
      nav,
      {childList:true,subtree:true,attributes:true}
    );
  }

  // Detectar si algún render externo intenta recolocar el programa en 8 u otro índice.
  const capture=document.getElementById('captura');
  if(capture){
    let debounce=null;
    new MutationObserver(()=>{
      clearTimeout(debounce);
      debounce=setTimeout(()=>{
        if(activeViewId()==='captura'&&editingSequenceApplies()){
          const flow=readFlow();
          const pos=parseProgramPosition();
          if(pos&&flow.step1&&pos.current!==flow.expectedProgram){
            // La excepción normal es durante una transición inmediata que todavía
            // no actualizó el marcador; el pequeño debounce evita falsos positivos.
            if(Math.abs(pos.current-flow.expectedProgram)>0){
              message(`El recorrido debe continuar en Programa ${flow.expectedProgram}.`);
            }
          }
        }
      },160);
    }).observe(capture,{childList:true,subtree:true,characterData:true});
  }

  // app.js publica funciones durante el arranque.
  [150,400,900,1600].forEach(ms=>{
    setTimeout(()=>{wrapGlobalFunctions();updateNavLocks()},ms);
  });

  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden){
      wrapGlobalFunctions();
      updateNavLocks();
    }
  });
  window.addEventListener('focus',()=>{
    wrapGlobalFunctions();
    updateNavLocks();
  });
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',boot,{once:true});
}else{
  boot();
}
