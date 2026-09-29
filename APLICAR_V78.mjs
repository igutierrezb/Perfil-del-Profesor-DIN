#!/usr/bin/env node
/**
 * Perfil Académico Docente DIN · V78
 * Corrección consolidada del flujo secuencial.
 *
 * MODIFICA ÚNICAMENTE:
 *   - app.js
 *   - index.html
 *
 * NO MODIFICA:
 *   - datos de Firestore
 *   - catalog.js
 *   - firebase-config.js
 *   - firestore.rules
 *   - styles.css
 *   - mobile.css
 *   - build-cloudflare.sh
 *   - wrangler.jsonc
 *   - .github/workflows/deploy-pages.yml
 *
 * Protecciones:
 *   1) verifica que app.js/index.html sean exactamente la versión de producción analizada;
 *   2) crea una copia local antes de escribir;
 *   3) aplica sustituciones exactas;
 *   4) comprueba sintaxis JavaScript;
 *   5) verifica invariantes del flujo;
 *   6) escribe archivos solo si todas las pruebas pasan.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, "app.js");
const INDEX_PATH = path.join(ROOT, "index.html");

const EXPECTED_APP_BLOB = "29baf4d0ef1e9ccf328421e04fb7ab293f303bfc";
const EXPECTED_INDEX_BLOB = "de093ff4422b05e7fbb9f0e55eabc96abbcb6661";

function die(message) {
  console.error("\n❌ V78 NO se aplicó.");
  console.error(message);
  process.exit(1);
}

function normalizeLf(text) {
  return text.replace(/\r\n/g, "\n");
}

function gitBlobSha(text) {
  const body = Buffer.from(text, "utf8");
  const header = Buffer.from(`blob ${body.length}\0`, "utf8");
  return crypto.createHash("sha1").update(Buffer.concat([header, body])).digest("hex");
}

function countOf(text, needle) {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function replaceOnce(text, oldText, newText, label) {
  const n = countOf(text, oldText);
  if (n !== 1) {
    throw new Error(`${label}: se esperaba 1 coincidencia exacta y se encontraron ${n}.`);
  }
  return text.replace(oldText, newText);
}

function replaceAllChecked(text, oldText, newText, minimum, label) {
  const n = countOf(text, oldText);
  if (n < minimum) {
    throw new Error(`${label}: se esperaban al menos ${minimum} coincidencias y se encontraron ${n}.`);
  }
  return text.split(oldText).join(newText);
}

if (!fs.existsSync(APP_PATH) || !fs.existsSync(INDEX_PATH)) {
  die("Ejecute este archivo dentro de la carpeta del repositorio, donde existan app.js e index.html.");
}

const originalAppRaw = fs.readFileSync(APP_PATH, "utf8");
const originalIndexRaw = fs.readFileSync(INDEX_PATH, "utf8");
let app = normalizeLf(originalAppRaw);
let index = normalizeLf(originalIndexRaw);

const appBlob = gitBlobSha(app);
const indexBlob = gitBlobSha(index);

console.log("Perfil DIN · V78");
console.log("===============");
console.log(`app.js    ${appBlob}`);
console.log(`index.html ${indexBlob}`);

if (appBlob !== EXPECTED_APP_BLOB) {
  die(
    "app.js no corresponde exactamente a la versión de producción analizada.\n" +
    `Esperado: ${EXPECTED_APP_BLOB}\nEncontrado: ${appBlob}\n` +
    "No se hará ningún cambio para evitar dañar una versión distinta."
  );
}

if (indexBlob !== EXPECTED_INDEX_BLOB) {
  die(
    "index.html no corresponde exactamente a la versión de producción analizada.\n" +
    `Esperado: ${EXPECTED_INDEX_BLOB}\nEncontrado: ${indexBlob}\n` +
    "No se hará ningún cambio para evitar dañar una versión distinta."
  );
}

// -----------------------------------------------------------------------------
// 1. La posición visual deja de ser información persistente del profesor.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
  "let currentProgramIndex=Number.isInteger(store.currentProgramIndex)?store.currentProgramIndex:0;",
  `let currentProgramIndex=0;
const workflowState={
  profileConfirmed:false,
  expectedProgramIndex:0,
  reviewUnlocked:false
};`,
  "Estado secuencial"
);

// -----------------------------------------------------------------------------
// 2. Estado de navegación separado del estado académico.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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
`,
  "Ayudantes del flujo"
);

// -----------------------------------------------------------------------------
// 3. Las copias locales siguen guardando TODOS los datos, pero no la posición.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
  "    currentProgramIndex:Number.isInteger(currentProgramIndex)?currentProgramIndex:0,",
  "    currentProgramIndex:0,",
  "Respaldo local por UID"
);

app = replaceOnce(
  app,
  "  store.currentProgramIndex=currentProgramIndex;",
  "  store.currentProgramIndex=0;",
  "Persistencia del cursor"
);

app = replaceAllChecked(
  app,
  "currentProgramIndex=Number.isInteger(backup.currentProgramIndex)?backup.currentProgramIndex:currentProgramIndex;",
  "currentProgramIndex=0;",
  1,
  "Recuperación local tipo A"
);

app = replaceAllChecked(
  app,
  "currentProgramIndex=Number.isInteger(backup.currentProgramIndex)?backup.currentProgramIndex:0;",
  "currentProgramIndex=0;",
  1,
  "Recuperación local tipo B"
);

app = replaceAllChecked(
  app,
  "transversalRules,currentProgramIndex,lastSavedAt",
  "transversalRules,currentProgramIndex:0,lastSavedAt",
  1,
  "Instantáneas completas"
);

// -----------------------------------------------------------------------------
// 4. Navegación superior: durante edición es indicador, no atajo.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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

  // Paso 2 exige confirmar explícitamente Paso 1 en la sesión de edición actual.
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

  // Paso 3 solo se abre al terminar secuencialmente todos los programas.
  if(id==='revision'&&sequential){
    const v=validateAll();
    if(!workflowState.reviewUnlocked||!v.ok){
      if(!v.ok)showCaptureErrors(v.errors);
      else toast('Concluya el recorrido de todos los programas antes de pasar a Revisión.');
      updateNavState();
      return false;
    }
  }

  // En consulta/administración se conserva la navegación flexible existente.
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

  // Regresar a Paso 1 durante edición obliga a confirmar de nuevo.
  if(id==='perfil'&&sequential){
    workflowState.profileConfirmed=false;
    workflowState.expectedProgramIndex=0;
    workflowState.reviewUnlocked=false;
    currentProgramIndex=0;
  }else if(id==='captura'&&sequential){
    // Volver desde Revisión a captura vuelve a cerrar Paso 3.
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
`,
  "Navegación principal"
);

app = replaceOnce(
  app,
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
    btn.title=sequential
      ?'Indicador de avance. Durante la edición use los botones inferiores.'
      :'';
  });
}
`,
  "Estado visual de navegación"
);

// -----------------------------------------------------------------------------
// 5. Confirmar Datos del profesor siempre abre Programa 1.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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

  // La captura académica se conserva. Solo se reinicia la navegación.
  workflowState.profileConfirmed=true;
  workflowState.expectedProgramIndex=0;
  workflowState.reviewUnlocked=false;
  currentProgramIndex=0;
  store.currentProgramIndex=0;
  persist({touch:false,schedule:false});
  renderCurrentProgram();

  // Cambio de vista directo y seguro para móviles.
`,
  "Paso 1 a Paso 2"
);

// -----------------------------------------------------------------------------
// 6. Protección adicional: índice inválido nunca puede llevar al último programa.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
`function renderCurrentProgram(){
  const p=currentProgram();if(!p)return;`,
`function renderCurrentProgram(){
  if(currentProgramIndex<0||currentProgramIndex>=programs().length){
    currentProgramIndex=0;
  }
  const p=currentProgram();if(!p)return;`,
  "Protección del programa actual"
);

// -----------------------------------------------------------------------------
// 7. Anterior deja de ser circular.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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
}`,
  "Botón Anterior"
);

// -----------------------------------------------------------------------------
// 8. Guardar y seguir impone el orden y valida todo antes de Revisión.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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
}`,
  "Guardar y seguir"
);

// -----------------------------------------------------------------------------
// 9. Si una validación lleva a una materia pendiente, Revisión vuelve a cerrarse.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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
}`,
  "Ir a pendiente"
);

// -----------------------------------------------------------------------------
// 10. Una entrega anterior NO desbloquea Revisión cuando la edición fue reabierta.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
`function reviewAvailable(){
  // Si Administración cerró la edición (o venció la fecha), el profesor puede
  // seguir consultando y generar/imprimir el estado actual de su perfil.
  return validateAll().ok || cfg.editingLocked || deadlinePassed() || submissionLockedForCurrentPeriod();
}`,
`function reviewAvailable(){
  const complete=validateAll().ok;

  // En edición, la secuencia actual manda sobre cualquier envío anterior.
  if(sequentialProfessorMode()){
    return workflowState.reviewUnlocked && complete;
  }

  // En solo lectura se conserva la consulta/reimpresión histórica.
  return complete || cfg.editingLocked || deadlinePassed() || submissionLockedForCurrentPeriod();
}`,
  "Disponibilidad de Revisión"
);

// -----------------------------------------------------------------------------
// 11. Solo el último programa puede abrir Revisión durante edición.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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
}`,
  "Validación para Revisión"
);

app = replaceOnce(
  app,
  "function lockRevisionNav(){$('navRevision').classList.toggle('locked',!reviewAvailable())}",
`function lockRevisionNav(){
  const btn=$('navRevision');
  if(!btn)return;

  const locked=sequentialProfessorMode()
    ?!workflowState.reviewUnlocked
    :!reviewAvailable();

  btn.classList.toggle('locked',locked);
}`,
  "Candado visual de Revisión"
);

// -----------------------------------------------------------------------------
// 12. Reabrir edición conserva datos y reinicia únicamente el recorrido.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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
      toast(store.individualEditDisabled`,
  "Reapertura de edición"
);

app = replaceOnce(
  app,
`    ?\`¿Habilitar la edición para \${who}?\\n\\nSe conservará íntegramente la última información guardada. El profesor continuará exactamente desde su captura anterior. Sólo los botones de eliminación pueden borrar información.\``,
`    ?\`¿Habilitar la edición para \${who}?\\n\\nSe conservará íntegramente toda la información guardada. El profesor volverá a confirmar Datos del profesor y revisará los programas desde el Programa 1. Sólo los botones de eliminación pueden borrar información.\``,
  "Mensaje administrativo"
);

// -----------------------------------------------------------------------------
// 13. Candado independiente en la FINALIZACIÓN.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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

  persist();`,
  "Candado final"
);

// -----------------------------------------------------------------------------
// 14. Imprimir/finalizar tampoco puede convertirse en una ruta de escape.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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

  if(!reviewAvailable()){`,
  "Protección de impresión/finalización"
);

// -----------------------------------------------------------------------------
// 15. Cada carga inicia navegación en Paso 1 / Programa 1.
// -----------------------------------------------------------------------------
app = replaceOnce(
  app,
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
  renderCurrentProgram();`,
  "Inicio de aplicación"
);

// -----------------------------------------------------------------------------
// INDEX.HTML
// Se elimina únicamente el módulo MANUAL de respaldo/restauración.
// El respaldo interno por UID de app.js permanece intacto.
// -----------------------------------------------------------------------------
const backupMatches = index.match(/<script\s+type=["']module["']\s+src=["']backup\.js[^"']*["']\s*><\/script>/gi) || [];

if (backupMatches.length !== 1) {
  throw new Error(`index.html: se esperaba exactamente 1 carga de backup.js y se encontraron ${backupMatches.length}.`);
}

index = index.replace(
  /\s*<script\s+type=["']module["']\s+src=["']backup\.js[^"']*["']\s*><\/script>/gi,
  ""
);

const appScriptRegex = /<script\s+type=["']module["']\s+src=["']app\.js[^"']*["']\s*><\/script>/i;
const appScriptMatches = index.match(new RegExp(appScriptRegex.source, "gi")) || [];

if (appScriptMatches.length !== 1) {
  throw new Error(`index.html: se esperaba exactamente 1 carga de app.js y se encontraron ${appScriptMatches.length}.`);
}

index = index.replace(
  appScriptRegex,
  '<script type="module" src="app.js?v=20260929-78"></script>'
);

// -----------------------------------------------------------------------------
// PRUEBAS ESTÁTICAS
// -----------------------------------------------------------------------------
const invariants = [
  ["posición inicial desacoplada", !app.includes("let currentProgramIndex=Number.isInteger(store.currentProgramIndex)")],
  ["sin navegación circular 1→8", !app.includes("(currentProgramIndex-1+programs().length)%programs().length")],
  ["estado secuencial presente", app.includes("const workflowState={")],
  ["confirmación de Paso 1", app.includes("workflowState.profileConfirmed=true")],
  ["programa esperado", app.includes("workflowState.expectedProgramIndex")],
  ["final de secuencia", app.includes("workflowState.expectedProgramIndex===programs().length")],
  ["revisión bloqueada durante edición", app.includes("return workflowState.reviewUnlocked && complete;")],
  ["candado final", app.includes("No se puede finalizar sin concluir el recorrido secuencial.")],
  ["backup manual eliminado", !/backup\.js/i.test(index)],
  ["cache de app actualizada", index.includes("app.js?v=20260929-78")]
];

for (const [name, ok] of invariants) {
  if (!ok) throw new Error(`Prueba V78 fallida: ${name}`);
}

// Comprobación sintáctica real con Node, sin ejecutar la aplicación.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "perfil-din-v78-"));
const tempModule = path.join(tempDir, "app-check.mjs");
fs.writeFileSync(tempModule, app, "utf8");

const check = spawnSync(process.execPath, ["--check", tempModule], {
  encoding: "utf8"
});

fs.rmSync(tempDir, { recursive: true, force: true });

if (check.status !== 0) {
  throw new Error(
    "La comprobación sintáctica de app.js falló.\n" +
    (check.stderr || check.stdout || "Error sin detalle")
  );
}

// -----------------------------------------------------------------------------
// TODAS LAS PRUEBAS PASARON. AHORA SÍ se crean respaldos y se escriben archivos.
// -----------------------------------------------------------------------------
const backupDir = path.join(ROOT, "_respaldo_antes_v78");
fs.mkdirSync(backupDir, { recursive: true });

fs.writeFileSync(path.join(backupDir, "app.js"), originalAppRaw, "utf8");
fs.writeFileSync(path.join(backupDir, "index.html"), originalIndexRaw, "utf8");

fs.writeFileSync(APP_PATH, app, "utf8");
fs.writeFileSync(INDEX_PATH, index, "utf8");

const report = [
  "Perfil DIN V78 aplicado correctamente",
  `Fecha: ${new Date().toISOString()}`,
  "",
  "Archivos modificados:",
  "  app.js",
  "  index.html",
  "",
  "Archivos NO modificados:",
  "  catalog.js",
  "  firebase-config.js",
  "  firestore.rules",
  "  styles.css",
  "  mobile.css",
  "  build-cloudflare.sh",
  "  wrangler.jsonc",
  "  .github/workflows/deploy-pages.yml",
  "",
  "Respaldo local previo:",
  "  _respaldo_antes_v78/app.js",
  "  _respaldo_antes_v78/index.html",
  "",
  "Pruebas:",
  ...invariants.map(([name, ok]) => `  ${ok ? "OK" : "ERROR"} · ${name}`),
  "  OK · sintaxis JavaScript",
  "",
  "Datos académicos:",
  "  NO se eliminaron ni migraron datos de Firestore.",
  "  NO se modificó la estructura profile/answers/programMeta/planningByPeriod.",
  "  La copia local por UID permanece activa.",
  ""
].join("\n");

fs.writeFileSync(path.join(ROOT, "V78_APLICADO.txt"), report, "utf8");

console.log("\n✅ V78 aplicada correctamente.");
console.log("Solo se modificaron app.js e index.html.");
console.log("Se creó _respaldo_antes_v78/ para revertir localmente si fuera necesario.");
console.log("\nPruebas superadas:");
for (const [name] of invariants) console.log(`  ✓ ${name}`);
console.log("  ✓ sintaxis JavaScript");
console.log("\nIMPORTANTE: deploy-pages.yml NO debe actualizarse.");
