/*
 Perfil Académico Docente DIN
 Flujo secuencial estricto V71
 2026-09-29

 Reglas:
 1. Mientras el profesor está en captura/edición y todavía NO finaliza:
    Paso 2 permanece bloqueado hasta confirmar correctamente Paso 1.
 2. Paso 3 permanece bloqueado hasta concluir correctamente Paso 2.
 3. Si se modifica Paso 1 después de haberlo confirmado, se vuelven a bloquear
    Paso 2 y Paso 3 hasta confirmar nuevamente.
 4. Si se modifica Paso 2 después de haberlo concluido, Paso 3 vuelve a bloquearse.
 5. Un perfil ya finalizado conserva acceso de consulta/reimpresión.
 6. No modifica profile, answers, programMeta ni Firestore. Solo gobierna navegación.
*/

const FLOW_KEY='PAD_DIN_FLOW_V71';
let installed=false;
let wrapping=false;

function readStore(){
  try{return JSON.parse(localStorage.getItem('PAD_UTEQ')||'{}')}catch(_){return {}}
}
function readFlow(){
  try{
    const raw=sessionStorage.getItem(FLOW_KEY);
    return raw?JSON.parse(raw):{step1:false,step2:false};
  }catch(_){
    return {step1:false,step2:false};
  }
}
function writeFlow(flow){
  try{sessionStorage.setItem(FLOW_KEY,JSON.stringify(flow))}catch(_){}
}
function currentPeriod(store){
  return String(store?.cfg?.periodo||'').trim();
}
function isFinalized(store){
  const period=currentPeriod(store);
  return !!period &&
    String(store?.submittedPeriod||'').trim()===period &&
    !store?.individualEditEnabled;
}
function editingSequenceApplies(store=readStore()){
  if(isFinalized(store))return false;
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
function message(text){
  if(typeof window.toast==='function'){
    window.toast(text);
    return;
  }
  let box=document.getElementById('flowSequenceNotice');
  if(!box){
    box=document.createElement('div');
    box.id='flowSequenceNotice';
    box.style.cssText='position:fixed;right:16px;bottom:16px;z-index:99999;max-width:360px;padding:10px 13px;border-radius:11px;background:#174f6e;color:white;font:500 12px/1.35 system-ui,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.18)';
    document.body.appendChild(box);
  }
  box.textContent=text;
  clearTimeout(message.timer);
  message.timer=setTimeout(()=>box.remove(),2600);
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
    .main-nav button.flow-ready{
      opacity:1;
    }
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
      ?'Concluya y confirme primero los Datos del profesor.'
      :'Paso 1 confirmado. Puede continuar al Perfil por programa.';
  }

  if(step3){
    const locked=!flow.step2;
    step3.classList.toggle('flow-locked',locked);
    step3.classList.toggle('flow-ready',!locked);
    step3.setAttribute('aria-disabled',locked?'true':'false');
    step3.title=locked
      ?'Concluya primero todos los programas del Perfil por programa.'
      :'Paso 2 concluido. Puede continuar a Revisión e impresión.';
  }
}
function invalidateFromStep1(){
  if(!editingSequenceApplies())return;
  const flow=readFlow();
  if(!flow.step1&&!flow.step2)return;
  flow.step1=false;
  flow.step2=false;
  writeFlow(flow);
  updateNavLocks();
}
function invalidateFromStep2(){
  if(!editingSequenceApplies())return;
  const flow=readFlow();
  if(!flow.step2)return;
  flow.step2=false;
  writeFlow(flow);
  updateNavLocks();
}
function afterNavigationAttempt(target, beforeView){
  requestAnimationFrame(()=>{
    const after=activeViewId();
    const flow=readFlow();

    // La propia aplicación ya valida Paso 1. Solo se confirma si realmente
    // consiguió entrar en captura.
    if(target==='captura' && after==='captura'){
      flow.step1=true;
      flow.step2=false;
      writeFlow(flow);
    }

    // La propia aplicación valida toda la captura. Solo se confirma Paso 2
    // si realmente consiguió entrar a revisión.
    if(target==='revision' && after==='revision'){
      flow.step1=true;
      flow.step2=true;
      writeFlow(flow);
    }

    updateNavLocks();
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
    message('Primero concluya todos los programas y utilice “Guardar y continuar a revisión”.');
    updateNavLocks();
  }
}
function wrapGlobalFunctions(){
  if(wrapping)return;
  wrapping=true;

  if(typeof window.continueToCapture==='function'&&!window.continueToCapture.__flow71){
    const original=window.continueToCapture;
    const wrapped=async function(...args){
      const before=activeViewId();
      const result=await original.apply(this,args);
      afterNavigationAttempt('captura',before);
      return result;
    };
    wrapped.__flow71=true;
    window.continueToCapture=wrapped;
  }

  if(typeof window.validateAndReview==='function'&&!window.validateAndReview.__flow71){
    const original=window.validateAndReview;
    const wrapped=function(...args){
      const flow=readFlow();
      if(editingSequenceApplies()&&!flow.step1){
        message('Primero confirme los Datos del profesor.');
        updateNavLocks();
        return;
      }
      const before=activeViewId();
      const result=original.apply(this,args);
      afterNavigationAttempt('revision',before);
      return result;
    };
    wrapped.__flow71=true;
    window.validateAndReview=wrapped;
  }

  // Si el último programa llama directamente a saveAndNextProgram,
  // la aplicación decidirá si la captura está completa. Después verificamos
  // si realmente llegó a Revisión.
  if(typeof window.saveAndNextProgram==='function'&&!window.saveAndNextProgram.__flow71){
    const original=window.saveAndNextProgram;
    const wrapped=function(...args){
      const flow=readFlow();
      if(editingSequenceApplies()&&!flow.step1){
        message('Primero confirme los Datos del profesor.');
        updateNavLocks();
        return;
      }
      const before=activeViewId();
      const result=original.apply(this,args);
      requestAnimationFrame(()=>{
        if(activeViewId()==='revision'){
          const f=readFlow();
          f.step1=true;
          f.step2=true;
          writeFlow(f);
        }
        updateNavLocks();
      });
      return result;
    };
    wrapped.__flow71=true;
    window.saveAndNextProgram=wrapped;
  }

  wrapping=false;
}
function initializeSessionFlow(){
  const store=readStore();

  // Un perfil finalizado es de consulta: no se restringe.
  if(isFinalized(store)){
    writeFlow({step1:true,step2:true});
    updateNavLocks();
    return;
  }

  // Cada nueva sesión de edición empieza ordenadamente en Paso 1.
  // La captura ya guardada NO se borra; solo se exige volver a confirmar
  // la información del profesor antes de continuar.
  if(editingSequenceApplies(store)){
    writeFlow({step1:false,step2:false});

    setTimeout(()=>{
      // Utilizamos el mecanismo normal de navegación de app.js para mostrar
      // Paso 1 sin tocar los datos existentes.
      try{
        if(activeViewId()!=='perfil'&&typeof window.go==='function'){
          window.go('perfil',true);
        }
      }catch(_){}
      updateNavLocks();
    },120);
  }
}
function boot(){
  if(installed)return;
  installed=true;

  ensureStyles();
  wrapGlobalFunctions();
  initializeSessionFlow();

  // Captura: impedir selección directa de pasos bloqueados.
  document.addEventListener('click',protectNavClick,true);

  // Si el usuario cambia cualquier dato del Paso 1, debe confirmar otra vez.
  document.addEventListener('input',event=>{
    if(event.target.closest?.('#perfil'))invalidateFromStep1();
    else if(event.target.closest?.('#captura'))invalidateFromStep2();
  },true);
  document.addEventListener('change',event=>{
    if(event.target.closest?.('#perfil'))invalidateFromStep1();
    else if(event.target.closest?.('#captura'))invalidateFromStep2();
  },true);

  // Algunos controles de captura son botones; un clic académico invalida
  // la confirmación previa de Paso 2.
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('#captura'))return;
    if(event.target.closest?.('.save-btn,#flowNextBtn'))return;
    if(event.target.closest?.('button,input,label,.toggle,.ideal-btn,.mini')){
      invalidateFromStep2();
    }
  },true);

  // app.js puede volver a renderizar la barra; reaplicar candados.
  const nav=document.querySelector('.main-nav');
  if(nav){
    new MutationObserver(()=>updateNavLocks()).observe(nav,{childList:true,subtree:true,attributes:true});
  }

  // app.js expone sus funciones durante el arranque. Dar una segunda oportunidad
  // de envolverlas después de que termine el primer render.
  setTimeout(()=>{wrapGlobalFunctions();updateNavLocks()},250);
  setTimeout(()=>{wrapGlobalFunctions();updateNavLocks()},900);

  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)updateNavLocks();
  });
  window.addEventListener('focus',updateNavLocks);
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',boot,{once:true});
}else{
  boot();
}
