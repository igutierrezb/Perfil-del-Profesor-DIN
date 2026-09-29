#!/usr/bin/env node
/**
 * Perfil Académico Docente DIN · V79
 * Corrección consolidada del flujo secuencial.
 *
 * Base analizada:
 *   app.js    GitHub blob: 29baf4d0ef1e9ccf328421e04fb7ab293f303bfc
 *   index.html GitHub blob: de093ff4422b05e7fbb9f0e55eabc96abbcb6661
 *
 * MODIFICA ÚNICAMENTE:
 *   - app.js
 *   - index.html
 *
 * CONSERVA:
 *   - Firestore y sus documentos
 *   - profile
 *   - answers
 *   - programMeta
 *   - planningByPeriod
 *   - submittedPeriod/finalizedAtMs
 *   - copia local PAD_UTEQ_PROFILE_<UID>
 *   - estilos escritorio/móvil
 *   - catálogo
 *   - reglas de Firestore
 *
 * IMPORTANTE:
 *   currentProgramIndex deja de ser "avance académico".
 *   Es solo posición de pantalla y se reinicia a Programa 1 al iniciar/reabrir edición.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, "app.js");
const INDEX_PATH = path.join(ROOT, "index.html");

function fail(message) {
  console.error("\n❌ V79 NO se aplicó.");
  console.error(message);
  process.exit(1);
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function replaceOnce(text, oldText, newText, label) {
  const n = count(text, oldText);
  if (n !== 1) {
    throw new Error(`${label}: se esperaba 1 coincidencia exacta y se encontraron ${n}.`);
  }
  return text.replace(oldText, newText);
}

function replaceAllChecked(text, oldText, newText, min, label) {
  const n = count(text, oldText);
  if (n < min) {
    throw new Error(`${label}: se esperaban al menos ${min} coincidencias y se encontraron ${n}.`);
  }
  return text.split(oldText).join(newText);
}

if (!fs.existsSync(APP_PATH) || !fs.existsSync(INDEX_PATH)) {
  fail(
    "Coloque APLICAR_V79.mjs dentro de la carpeta del repositorio, " +
    "en el mismo nivel que app.js e index.html."
  );
}

const originalApp = fs.readFileSync(APP_PATH, "utf8");
const originalIndex = fs.readFileSync(INDEX_PATH, "utf8");

if (originalApp.includes("const workflowState={") || originalIndex.includes("app.js?v=20260929-79")) {
  fail("Parece que V79 ya fue aplicada. No se volverá a ejecutar sobre la misma versión.");
}

let app = originalApp.replace(/\r\n/g, "\n");
let index = originalIndex.replace(/\r\n/g, "\n");

const applied = [];

function appOnce(label, oldText, newText) {
  app = replaceOnce(app, oldText, newText, label);
  applied.push(label);
}

function appAll(label, oldText, newText, min = 1) {
  app = replaceAllChecked(app, oldText, newText, min, label);
  applied.push(label);
}

// ============================================================================
// 1. ESTADO DEL FLUJO: separado de los datos académicos.
// ============================================================================
appOnce(
  "Estado secuencial",
  "let currentProgramIndex=Number.isInteger(store.currentProgramIndex)?store.currentProgramIndex:0;",
`let currentProgramIndex=0;
const workflowState={
  profileConfirmed:false,
  expectedProgramIndex:0,
  reviewUnlocked:false
};`
);

// ============================================================================
// 2. HELPERS DE NAVEGACIÓN.
// ============================================================================
appOnce(
  "Helpers del flujo",
`function editingAllowed(){
  // El administrador siempre conserva acceso.
  // Un permiso individual puede reabrir SOLO ese perfil.
  // Un bloqueo individual impide editar aunque la captura general esté abierta.
  if(isAdmin())return true;
  if(deadlinePassed())return false;
  if(individualEditBlocked())return false;
  return individualEditOverride() || (!cfg.editingLocked && !submissionLockedForCurrentPeriod());
}
`,
`function editingAllowed(){
  // El administrador siempre conserva acceso.
  // Un permiso individual puede reabrir SOLO ese perfil.
  // Un bloqueo individual impide editar aunque la captura general esté abierta.
  if(isAdmin())return true;
  if(deadlinePassed())return false;
  if(individualEditBlocked())return false;
  return individualEditOverride() || (!cfg.editingLocked && !submissionLockedForCurrentPeriod());
}
function sequentialProfessorMode(){
  return !isAdmin() && editingAllowed();
}
function resetWorkflowState(){
  workflowState.profileConfirmed=false;
  workflowState.expectedProgramIndex=0;
  workflowState.reviewUnlocked=false;
  currentProgramIndex=0;
  store.currentProgramIndex=0;
}
function activateViewDirect(id){
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  const target=$(id);
  if(target)target.classList.add('active');
  document.querySelectorAll('.main-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  scrollTo(0,0);
}
`
);

// ============================================================================
// 3. VALIDAR YA NO DEBE GUARDAR NI CREAR REVISIONES ARTIFICIALES.
// ============================================================================
appOnce(
  "Lectura y guardado del perfil",
`function collectProfile(){let extra={};document.querySelectorAll('[data-g]').forEach(x=>extra[x.dataset.g]=x.value.trim());store.profile={apPat:$('apPat').value.trim(),apMat:$('apMat').value.trim(),nombres:$('nombres').value.trim(),categoria:$('categoria').value,gradoAcademico:$('gradoAcademico')?.value||'',extra};persist();return store.profile}`,
`function profileFromInputs(){
  const extra={};
  document.querySelectorAll('[data-g]').forEach(x=>extra[x.dataset.g]=x.value.trim());
  return {
    apPat:$('apPat')?.value.trim()||'',
    apMat:$('apMat')?.value.trim()||'',
    nombres:$('nombres')?.value.trim()||'',
    categoria:$('categoria')?.value||'',
    gradoAcademico:$('gradoAcademico')?.value||'',
    extra
  };
}
function collectProfile(){
  store.profile=profileFromInputs();
  persist();
  return store.profile;
}`
);

appOnce(
  "Validación pura del perfil",
`function validateProfile(opts={}){
  const p=collectProfile(),e=p.extra||{},checks=requiredProfileChecks(p,e);
  const errors=checks.filter(x=>x.missing).map(x=>x.msg);
  if(opts.visual)highlightRequired(checks,!!opts.focusFirst);
  return{ok:!errors.length,errors,checks}
}`,
`function validateProfile(opts={}){
  const p=profileFromInputs(),e=p.extra||{},checks=requiredProfileChecks(p,e);
  const errors=checks.filter(x=>x.missing).map(x=>x.msg);
  if(opts.visual)highlightRequired(checks,!!opts.focusFirst);
  return{ok:!errors.length,errors,checks}
}`
);

// ============================================================================
// 4. LA POSICIÓN DE PANTALLA DEJA DE PERSISTIRSE COMO AVANCE.
// ============================================================================
appOnce(
  "Cursor en respaldo local",
  "    currentProgramIndex:Number.isInteger(currentProgramIndex)?currentProgramIndex:0,",
  "    currentProgramIndex:0,"
);

appOnce(
  "Cursor en persistencia",
  "  store.currentProgramIndex=currentProgramIndex;",
  "  store.currentProgramIndex=0;"
);

appAll(
  "Recuperación de cursor tipo A",
  "currentProgramIndex=Number.isInteger(backup.currentProgramIndex)?backup.currentProgramIndex:currentProgramIndex;",
  "currentProgramIndex=0;",
  1
);

appAll(
  "Recuperación de cursor tipo B",
  "currentProgramIndex=Number.isInteger(backup.currentProgramIndex)?backup.currentProgramIndex:0;",
  "currentProgramIndex=0;",
  1
);

appAll(
  "Instantáneas con cursor cero",
  "transversalRules,currentProgramIndex,lastSavedAt",
  "transversalRules,currentProgramIndex:0,lastSavedAt",
  1
);

// ============================================================================
// 5. SI LA CONFIGURACIÓN GENERAL REABRE CAPTURA, REGRESAR A PASO 1.
// ============================================================================
appOnce(
  "Configuración global: estado previo",
`function applyGlobalSettings(data){
  if(!data)return;
  if(data.cfg)Object.assign(cfg,data.cfg);
  globalSettingsKnown=true;`,
`function applyGlobalSettings(data){
  if(!data)return;
  const wasSequential=sequentialProfessorMode();
  if(data.cfg)Object.assign(cfg,data.cfg);
  globalSettingsKnown=true;`
);

appOnce(
  "Configuración global: reapertura",
`  localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt}));
  updatePeriodBadges();renderCurrentProgram();renderAdmin();updateCountdownUI();updatePlanningAvailability();renderPlanning();applyEditState();updateNavState();
}`,
`  localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt}));

  const nowSequential=sequentialProfessorMode();
  if(!wasSequential&&nowSequential){
    resetWorkflowState();
    loadProfileValuesOnly();
    renderCurrentProgram();
    activateViewDirect('perfil');
  }

  updatePeriodBadges();renderCurrentProgram();renderAdmin();updateCountdownUI();updatePlanningAvailability();renderPlanning();applyEditState();updateNavState();
}`
);

// ============================================================================
// 6. NAVEGACIÓN SUPERIOR: INDICADOR DURANTE EDICIÓN, NO ATAJO.
// ============================================================================
appOnce(
  "Navegación principal",
`window.go=function(id,force=false){
  if(id==='admin'&&!isAdmin()){toast('Administración disponible únicamente para ivan.gutierrez@uteq.edu.mx');return}
  if(id==='captura'&&!force){const p=validateProfile({visual:true,focusFirst:true});if(!p.ok){$('profileErrors').innerHTML=statusBox(p.errors,'Complete los datos obligatorios antes de continuar.');return}}
  if(id==='revision'&&!force){
    const v=validateAll();
    if(!reviewAvailable()){showCaptureErrors(v.errors);return}
  }
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$(id).classList.add('active');
  document.querySelectorAll('.main-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  if(id==='revision')buildPrint();
  if(id==='admin')renderAdmin();
  scrollTo(0,0);
  if(id==='captura')requestAnimationFrame(showCaptureOrientationIfNeeded);
}
document.querySelectorAll('.main-nav button').forEach(b=>b.onclick=()=>window.go(b.dataset.view));
`,
`window.go=function(id,force=false){
  if(id==='admin'&&!isAdmin()){
    toast('Administración disponible únicamente para ivan.gutierrez@uteq.edu.mx');
    return false;
  }

  const sequential=sequentialProfessorMode();

  if(id==='captura'&&sequential&&!workflowState.profileConfirmed){
    activateViewDirect('perfil');
    const v=validateProfile({visual:true,focusFirst:false});
    if($('profileErrors')&&!v.ok){
      $('profileErrors').innerHTML=statusBox(v.errors,'Confirme primero los datos del profesor.');
    }
    toast('Confirme primero Datos del profesor con el botón inferior.');
    updateNavState();
    return false;
  }

  if(id==='revision'&&sequential){
    const v=validateAll();
    if(!workflowState.reviewUnlocked||!v.ok){
      if(!v.ok)showCaptureErrors(v.errors);
      else toast('Concluya el recorrido de todos los programas antes de pasar a Revisión.');
      updateNavState();
      return false;
    }
  }

  if(id==='captura'&&!force&&!sequential){
    const p=validateProfile({visual:true,focusFirst:true});
    if(!p.ok){
      $('profileErrors').innerHTML=statusBox(p.errors,'Complete los datos obligatorios antes de continuar.');
      return false;
    }
  }

  if(id==='revision'&&!force&&!sequential){
    const v=validateAll();
    if(!reviewAvailable()){
      showCaptureErrors(v.errors);
      return false;
    }
  }

  if(id==='perfil'&&sequential){
    workflowState.profileConfirmed=false;
    workflowState.expectedProgramIndex=0;
    workflowState.reviewUnlocked=false;
    currentProgramIndex=0;
  }else if(id==='captura'&&sequential){
    workflowState.expectedProgramIndex=currentProgramIndex;
    workflowState.reviewUnlocked=false;
  }

  activateViewDirect(id);
  if(id==='revision')buildPrint();
  if(id==='admin')renderAdmin();
  if(id==='captura')requestAnimationFrame(showCaptureOrientationIfNeeded);
  updateNavState();
  return true;
};

document.querySelectorAll('.main-nav button').forEach(b=>b.onclick=()=>{
  const id=b.dataset.view;
  if(sequentialProfessorMode()&&['perfil','captura','revision'].includes(id)){
    toast('Durante la edición avance con los botones inferiores para conservar la secuencia.');
    return;
  }
  window.go(id);
});
`
);

appOnce(
  "Estado visual de la navegación",
`function updateNavState(){
  const pBtn=document.querySelector('.main-nav button[data-view="perfil"]');
  const cBtn=document.querySelector('.main-nav button[data-view="captura"]');
  const rBtn=document.querySelector('.main-nav button[data-view="revision"]');
  if(pBtn)pBtn.classList.toggle('complete',profileLooksComplete());
  if(cBtn)cBtn.classList.toggle('complete',validateCapture().ok);
  if(rBtn){
    rBtn.classList.toggle('complete',validateAll().ok);
    rBtn.classList.toggle('readable',reviewAvailable()&&!validateAll().ok);
  }
}
`,
`function updateNavState(){
  const pBtn=document.querySelector('.main-nav button[data-view="perfil"]');
  const cBtn=document.querySelector('.main-nav button[data-view="captura"]');
  const rBtn=document.querySelector('.main-nav button[data-view="revision"]');

  if(pBtn)pBtn.classList.toggle('complete',profileLooksComplete());
  if(cBtn)cBtn.classList.toggle('complete',validateCapture().ok);
  if(rBtn){
    rBtn.classList.toggle('complete',validateAll().ok);
    rBtn.classList.toggle('readable',reviewAvailable()&&!validateAll().ok);
  }

  const sequential=sequentialProfessorMode();
  [pBtn,cBtn,rBtn].forEach(btn=>{
    if(!btn)return;
    btn.classList.toggle('locked',sequential);
    btn.setAttribute('aria-disabled',sequential?'true':'false');
    btn.tabIndex=sequential?-1:0;
    btn.title=sequential
      ?'Indicador de avance. Durante la edición use los botones inferiores.'
      :'';
  });
}
`
);

// ============================================================================
// 7. PASO 1 -> SIEMPRE PROGRAMA 1.
// ============================================================================
appOnce(
  "Paso 1 a Programa 1",
`  // Guardar antes de cambiar de vista.
  collectProfile();
  persist();
  if(cloudAvailable&&currentUser){
    try{await saveProfileToCloud(false)}catch(e){console.warn('Guardado previo al avance',e)}
  }

  renderCurrentProgram();

  // Cambio de vista directo y seguro para móviles.
`,
`  // Guardar antes de cambiar de vista.
  collectProfile();
  persist();
  if(cloudAvailable&&currentUser){
    try{await saveProfileToCloud(false)}catch(e){console.warn('Guardado previo al avance',e)}
  }

  // Los datos académicos permanecen. Solo reiniciamos el recorrido visual.
  workflowState.profileConfirmed=true;
  workflowState.expectedProgramIndex=0;
  workflowState.reviewUnlocked=false;
  currentProgramIndex=0;
  store.currentProgramIndex=0;
  persist({touch:false,schedule:false});
  renderCurrentProgram();

  // Cambio de vista directo y seguro para móviles.
`
);

// ============================================================================
// 8. PROTEGER ÍNDICES Y QUITAR NAVEGACIÓN CIRCULAR.
// ============================================================================
appOnce(
  "Protección de índice",
`function renderCurrentProgram(){
  const p=currentProgram();if(!p)return;`,
`function renderCurrentProgram(){
  const totalPrograms=programs().length;
  if(!totalPrograms)return;

  if(currentProgramIndex<0||currentProgramIndex>=totalPrograms){
    currentProgramIndex=0;
  }

  if(workflowState.expectedProgramIndex<0||workflowState.expectedProgramIndex>totalPrograms){
    workflowState.expectedProgramIndex=currentProgramIndex;
    workflowState.reviewUnlocked=false;
  }

  const p=currentProgram();if(!p)return;`
);

appOnce(
  "Anterior no circular",
`window.prevProgram=function(){
  if(!canLeaveCurrentProgram())return;
  currentProgramIndex=(currentProgramIndex-1+programs().length)%programs().length;
  persist();renderCurrentProgram();
  scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'})
}`,
`window.prevProgram=function(){
  if(currentProgramIndex<=0){
    workflowState.profileConfirmed=false;
    workflowState.expectedProgramIndex=0;
    workflowState.reviewUnlocked=false;
    currentProgramIndex=0;
    window.go('perfil',true);
    return;
  }

  currentProgramIndex--;
  workflowState.expectedProgramIndex=currentProgramIndex;
  workflowState.reviewUnlocked=false;
  persist({touch:false});
  renderCurrentProgram();
  scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'});
}`
);

// ============================================================================
// 9. GUARDAR Y SEGUIR: ORDEN ESTRICTO.
// ============================================================================
appOnce(
  "Guardar y seguir secuencial",
`window.saveAndNextProgram=function(){
  if(!canLeaveCurrentProgram())return;
  persist();toast('Programa guardado.');
  if(currentProgramIndex>=programs().length-1){validateAndReview();return}
  currentProgramIndex++;
  persist();renderCurrentProgram();
  scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'})
}`,
`window.saveAndNextProgram=function(){
  if(sequentialProfessorMode()){
    if(!workflowState.profileConfirmed){
      window.go('perfil',true);
      toast('Confirme primero Datos del profesor.');
      return;
    }

    if(currentProgramIndex!==workflowState.expectedProgramIndex){
      currentProgramIndex=Math.max(0,Math.min(workflowState.expectedProgramIndex,programs().length-1));
      renderCurrentProgram();
      toast('La revisión debe continuar en el programa que corresponde al orden de captura.');
      return;
    }
  }

  if(!canLeaveCurrentProgram())return;

  // Guardar realmente el programa antes de cambiar de pantalla.
  persist();
  toast('Programa guardado.');

  if(currentProgramIndex>=programs().length-1){
    const v=validateAll();

    if(!v.ok){
      workflowState.reviewUnlocked=false;
      showCaptureErrors(v.errors);
      toast('Todavía existen datos o materias pendientes.');
      return;
    }

    workflowState.expectedProgramIndex=programs().length;
    workflowState.reviewUnlocked=true;
    validateAndReview(true);
    return;
  }

  currentProgramIndex++;
  workflowState.expectedProgramIndex=currentProgramIndex;
  workflowState.reviewUnlocked=false;
  persist({touch:false});
  renderCurrentProgram();
  scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'});
}`
);

// ============================================================================
// 10. SI HAY PENDIENTES, VOLVER A ELLOS SIN ABRIR REVISIÓN.
// ============================================================================
appOnce(
  "Ir a pendiente",
`window.goToCaptureIssue=function(pi,s,c,type='competence'){
  currentProgramIndex=pi;
  persist();
  renderCurrentProgram();
  requestAnimationFrame(()=>focusExactCaptureIssue({pi,s,c,type}));
}`,
`window.goToCaptureIssue=function(pi,s,c,type='competence'){
  currentProgramIndex=pi;
  workflowState.expectedProgramIndex=pi;
  workflowState.reviewUnlocked=false;
  persist({touch:false});
  renderCurrentProgram();
  requestAnimationFrame(()=>focusExactCaptureIssue({pi,s,c,type}));
}`
);

appOnce(
  "Mostrar pendientes",
`function showCaptureErrors(errs){
  captureErrorModeActive=true;
  const profileCheck=validateProfile();
  const issues=captureIssues();

  if(!profileCheck.ok){
    document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
    $('perfil')?.classList.add('active');
    document.querySelectorAll('.main-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view==='perfil'));
    const v=validateProfile({visual:true,focusFirst:true});
    if($('profileErrors'))$('profileErrors').innerHTML=statusBox(v.errors,'Complete el dato obligatorio señalado.');
    toast('Señalamos exactamente el dato que falta completar.');
    return;
  }

  if(issues.length){
    currentProgramIndex=issues[0].pi;
    persist();
    renderCurrentProgram();
    $('captureErrors').innerHTML=captureIssuePanel(issues);
    requestAnimationFrame(()=>focusExactCaptureIssue(issues[0]));
  }else{
    $('captureErrors').innerHTML=statusBox(errs,'No puede pasar a revisión todavía.');
  }
}`,
`function showCaptureErrors(errs){
  captureErrorModeActive=true;
  const profileCheck=validateProfile();
  const issues=captureIssues();

  if(!profileCheck.ok){
    workflowState.profileConfirmed=false;
    workflowState.expectedProgramIndex=0;
    workflowState.reviewUnlocked=false;
    currentProgramIndex=0;
    activateViewDirect('perfil');
    const v=validateProfile({visual:true,focusFirst:true});
    if($('profileErrors'))$('profileErrors').innerHTML=statusBox(v.errors,'Complete el dato obligatorio señalado.');
    updateNavState();
    toast('Señalamos exactamente el dato que falta completar.');
    return;
  }

  if(issues.length){
    currentProgramIndex=issues[0].pi;
    workflowState.expectedProgramIndex=currentProgramIndex;
    workflowState.reviewUnlocked=false;
    persist({touch:false});
    activateViewDirect('captura');
    renderCurrentProgram();
    $('captureErrors').innerHTML=captureIssuePanel(issues);
    updateNavState();
    requestAnimationFrame(()=>focusExactCaptureIssue(issues[0]));
  }else{
    $('captureErrors').innerHTML=statusBox(errs,'No puede pasar a revisión todavía.');
  }
}`
);

// ============================================================================
// 11. REVISIÓN: COMPLETITUD + SECUENCIA.
// ============================================================================
appOnce(
  "Disponibilidad de Revisión",
`function reviewAvailable(){
  // Si Administración cerró la edición (o venció la fecha), el profesor puede
  // seguir consultando y generar/imprimir el estado actual de su perfil.
  return validateAll().ok || cfg.editingLocked || deadlinePassed() || submissionLockedForCurrentPeriod();
}`,
`function reviewAvailable(){
  const complete=validateAll().ok;

  // En edición activa, una entrega anterior NO puede servir de atajo.
  if(sequentialProfessorMode()){
    return workflowState.reviewUnlocked && complete;
  }

  // En solo lectura se conserva la consulta/reimpresión.
  return complete || cfg.editingLocked || deadlinePassed() || submissionLockedForCurrentPeriod();
}`
);

appOnce(
  "Validar y abrir Revisión",
`window.validateAndReview=function(){
  if(editingAllowed()) collectProfile();
  persist();
  const v=validateAll();
  if(!reviewAvailable()){showCaptureErrors(v.errors);toast('Complete las materias pendientes.');return}
  $('captureErrors').innerHTML='';
  $('validation').innerHTML=v.ok
    ?\`<div class="status-box ok"><b>Perfil completo.</b><br>La información puede formalizarse e imprimirse.</div>\`
    :\`<div class="status-box info"><b>Consulta en modo solo lectura.</b><br>La edición está cerrada, pero puede revisar e imprimir el perfil capturado.</div>\`;
  buildPrint();
  window.go('revision',true)
}`,
`window.validateAndReview=function(fromSequentialFlow=false){
  if(editingAllowed())collectProfile();
  persist();

  const v=validateAll();

  if(sequentialProfessorMode()){
    const sequenceFinished=
      fromSequentialFlow===true &&
      workflowState.profileConfirmed &&
      workflowState.expectedProgramIndex===programs().length;

    if(!sequenceFinished||!v.ok){
      workflowState.reviewUnlocked=false;
      if(!v.ok)showCaptureErrors(v.errors);
      else toast('Concluya primero todos los programas en orden.');
      return false;
    }

    workflowState.reviewUnlocked=true;
  }else if(!reviewAvailable()){
    showCaptureErrors(v.errors);
    toast('Complete las materias pendientes.');
    return false;
  }

  $('captureErrors').innerHTML='';
  $('validation').innerHTML=v.ok
    ?\`<div class="status-box ok"><b>Perfil completo.</b><br>La información puede formalizarse e imprimirse.</div>\`
    :\`<div class="status-box info"><b>Consulta en modo solo lectura.</b><br>La edición está cerrada, pero puede revisar e imprimir el perfil capturado.</div>\`;

  buildPrint();
  return window.go('revision',true);
}`
);

appOnce(
  "Candado visual de Revisión",
  "function lockRevisionNav(){$('navRevision').classList.toggle('locked',!reviewAvailable())}",
`function lockRevisionNav(){
  const btn=$('navRevision');
  if(!btn)return;

  const locked=sequentialProfessorMode()
    ?!workflowState.reviewUnlocked
    :!reviewAvailable();

  btn.classList.toggle('locked',locked);
}`
);

// ============================================================================
// 12. REAPERTURA ADMINISTRATIVA: CONSERVAR DATOS, REINICIAR RECORRIDO.
// ============================================================================
appOnce(
  "Reapertura individual",
`    if(priorPeriod!==store.submittedPeriod || priorOverride!==store.individualEditEnabled || priorDisabled!==store.individualEditDisabled){
      localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt}));
      applyEditState();updateNavState();
      toast(store.individualEditDisabled`,
`    if(priorPeriod!==store.submittedPeriod || priorOverride!==store.individualEditEnabled || priorDisabled!==store.individualEditDisabled){
      const reopenedNow=!priorOverride&&store.individualEditEnabled&&!isAdmin();

      if(reopenedNow){
        resetWorkflowState();
        localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt}));
        loadProfileValuesOnly();
        renderCurrentProgram();
        activateViewDirect('perfil');
      }else{
        localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt}));
      }

      applyEditState();updateNavState();
      toast(store.individualEditDisabled`
);

appOnce(
  "Mensaje de reapertura",
`    ?\`¿Habilitar la edición para \${who}?\\n\\nSe conservará íntegramente la última información guardada. El profesor continuará exactamente desde su captura anterior. Sólo los botones de eliminación pueden borrar información.\``,
`    ?\`¿Habilitar la edición para \${who}?\\n\\nSe conservará íntegramente toda la información guardada. El profesor volverá a confirmar Datos del profesor y revisará los programas desde el Programa 1. Sólo los botones de eliminación pueden borrar información.\``
);

// ============================================================================
// 13. CANDADO FINAL, INDEPENDIENTE DE LA INTERFAZ.
// ============================================================================
appOnce(
  "Finalización segura",
`async function finalizeCurrentProfile(){
  collectProfile();
  persist();`,
`async function finalizeCurrentProfile(){
  collectProfile();

  const finalCheck=validateAll();

  if(!finalCheck.ok){
    throw new Error('No se puede finalizar un perfil con información pendiente.');
  }

  if(sequentialProfessorMode()&&!workflowState.reviewUnlocked){
    throw new Error('No se puede finalizar sin concluir el recorrido secuencial.');
  }

  persist();`
);

appOnce(
  "Impresión/finalización segura",
`window.printProfile=async function(){
  const v=validateAll();
  if(!reviewAvailable()){`,
`window.printProfile=async function(){
  const v=validateAll();

  if(sequentialProfessorMode()&&(!workflowState.reviewUnlocked||!v.ok)){
    toast('Concluya primero Datos del profesor y todos los programas en orden.');
    if(!v.ok)showCaptureErrors(v.errors);
    return;
  }

  if(!reviewAvailable()){`
);

// ============================================================================
// 14. ARRANQUE.
// ============================================================================
appOnce(
  "Inicio limpio",
`function init(){
  loadProfile();
  updatePeriodBadges();
  initAuth();
  renderCurrentProgram();`,
`function init(){
  loadProfile();
  updatePeriodBadges();
  initAuth();
  resetWorkflowState();
  renderCurrentProgram();`
);

// ============================================================================
// 15. INDEX.HTML: quitar únicamente el módulo manual de respaldo.
// ============================================================================
const backupScripts =
  index.match(/<script\s+type=["']module["']\s+src=["']backup\.js[^"']*["']\s*><\/script>/gi) || [];

if (backupScripts.length !== 1) {
  throw new Error(
    `index.html: se esperaba exactamente 1 referencia activa a backup.js y se encontraron ${backupScripts.length}.`
  );
}

index = index.replace(
  /\s*<script\s+type=["']module["']\s+src=["']backup\.js[^"']*["']\s*><\/script>/gi,
  ""
);

const appScriptRegex =
  /<script\s+type=["']module["']\s+src=["']app\.js[^"']*["']\s*><\/script>/i;

const appScripts = index.match(new RegExp(appScriptRegex.source, "gi")) || [];

if (appScripts.length !== 1) {
  throw new Error(
    `index.html: se esperaba exactamente 1 referencia activa a app.js y se encontraron ${appScripts.length}.`
  );
}

index = index.replace(
  appScriptRegex,
  '<script type="module" src="app.js?v=20260929-79"></script>'
);

// ============================================================================
// 16. PRUEBAS ANTES DE ESCRIBIR.
// ============================================================================
const checks = [
  ["cursor antiguo no controla el arranque", !app.includes("let currentProgramIndex=Number.isInteger(store.currentProgramIndex)")],
  ["sin navegación circular Programa 1 → último", !app.includes("(currentProgramIndex-1+programs().length)%programs().length")],
  ["validación de perfil sin escritura", app.includes("const p=profileFromInputs(),e=p.extra||{},checks=requiredProfileChecks(p,e);")],
  ["estado de flujo explícito", app.includes("const workflowState={")],
  ["confirmación del Paso 1", app.includes("workflowState.profileConfirmed=true")],
  ["programa esperado", app.includes("workflowState.expectedProgramIndex")],
  ["fin secuencial", app.includes("workflowState.expectedProgramIndex===programs().length")],
  ["Revisión bloqueada durante edición", app.includes("return workflowState.reviewUnlocked && complete;")],
  ["candado final independiente", app.includes("No se puede finalizar sin concluir el recorrido secuencial.")],
  ["backup.js manual eliminado", !/backup\.js/i.test(index)],
  ["cache app.js V79", index.includes("app.js?v=20260929-79")]
];

for (const [label, ok] of checks) {
  if (!ok) throw new Error(`Prueba de seguridad fallida: ${label}`);
}

// Node analiza el archivo completo como ES module sin ejecutarlo.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "perfil-din-v79-"));
const tempApp = path.join(tempDir, "app-check.mjs");
fs.writeFileSync(tempApp, app, "utf8");

const syntax = spawnSync(process.execPath, ["--check", tempApp], {
  encoding: "utf8"
});

fs.rmSync(tempDir, { recursive: true, force: true });

if (syntax.status !== 0) {
  throw new Error(
    "La comprobación sintáctica de app.js falló:\n" +
    (syntax.stderr || syntax.stdout || "sin detalle")
  );
}

// ============================================================================
// 17. SOLO AHORA HACER RESPALDO Y ESCRIBIR.
// ============================================================================
const backupDir = path.join(ROOT, "_respaldo_antes_v79");
fs.mkdirSync(backupDir, { recursive: true });

fs.writeFileSync(path.join(backupDir, "app.js"), originalApp, "utf8");
fs.writeFileSync(path.join(backupDir, "index.html"), originalIndex, "utf8");

fs.writeFileSync(APP_PATH, app, "utf8");
fs.writeFileSync(INDEX_PATH, index, "utf8");

const report = [
  "PERFIL DIN · V79 APLICADA",
  "========================",
  `Fecha: ${new Date().toISOString()}`,
  "",
  "Archivos modificados:",
  "  app.js",
  "  index.html",
  "",
  "Respaldo previo:",
  "  _respaldo_antes_v79/app.js",
  "  _respaldo_antes_v79/index.html",
  "",
  "Datos NO eliminados ni migrados:",
  "  profile",
  "  answers",
  "  programMeta",
  "  planningByPeriod",
  "  submittedPeriod",
  "  finalizedAtMs",
  "  Firestore profiles/<UID>",
  "",
  "Pruebas:",
  ...checks.map(([label]) => `  OK · ${label}`),
  "  OK · sintaxis JavaScript",
  "",
  "Cambios exactos aplicados:",
  ...applied.map(x => `  - ${x}`),
  "",
  "deploy-pages.yml: NO se actualiza."
].join("\n");

fs.writeFileSync(path.join(ROOT, "V79_APLICADA.txt"), report, "utf8");

console.log("\n✅ V79 aplicada correctamente.");
console.log(`Se aplicaron ${applied.length} bloques de corrección.`);
console.log("Se conservaron los datos académicos y la persistencia existente.");
console.log("Respaldo local creado en _respaldo_antes_v79/");
console.log("\nDespués sustituya/suba a GitHub solamente:");
console.log("  app.js");
console.log("  index.html");
console.log("\ndeploy-pages.yml NO se actualiza.");
