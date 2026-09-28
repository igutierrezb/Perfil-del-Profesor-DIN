
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, onSnapshot, serverTimestamp, addDoc } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const $=id=>document.getElementById(id);
const store=JSON.parse(localStorage.getItem('PAD_UTEQ')||'{}');
const cfg=Object.assign({jefe:'Iván Gutiérrez Bautista',codigo:'EA-F-86',revision:'Rev.01',fechaRevision:'21-sep-2018',periodo:'SEP 2026 - AGO 2027',editingLocked:false,captureDeadline:null},store.cfg||{});
const DEFAULT_COMMON_RULES=[
  {id:'TC_IND',name:'Tronco común Industrial',programIds:['ind_plasticos','ind_procesos'],semesters:[0,1,2]},
  {id:'TC_MEC',name:'Tronco común Mecánica',programIds:['mec_ind','mec_moldes','mec_auto'],semesters:[0,1,2]}
];
let answers=store.answers||{},programMeta=store.programMeta||{},customPrograms=store.customPrograms||[],programOverrides=store.programOverrides||{},disabledPrograms=store.disabledPrograms||[],programAcronyms=store.programAcronyms||{},commonRules=Array.isArray(store.commonRules)?store.commonRules:JSON.parse(JSON.stringify(DEFAULT_COMMON_RULES));
let currentProgramIndex=Number.isInteger(store.currentProgramIndex)?store.currentProgramIndex:0;
let newSemesterCount=5,programEditorSemesters=[],auth=null,currentUser=null,authReady=false,db=null,cloudSettingsUnsub=null,cloudProfileMetaUnsub=null,remoteProfileLoaded=false,cloudAvailable=false,cloudSaveTimer=null,countdownTimer=null,lastSavedAt=store.lastSavedAt||null,editingCommonRuleId=null,editingProgramId=null,teacherAdminCache={};
const allowedDomain=(window.PAD_ALLOWED_DOMAIN||'uteq.edu.mx').toLowerCase();
const adminEmail=(window.PAD_ADMIN_EMAIL||'ivan.gutierrez@uteq.edu.mx').toLowerCase();

function allPrograms(){
  const base=PROGRAMS.map(p=>{
    const ov=programOverrides[p.id];
    if(!ov)return {...p,hours:(typeof PROGRAM_HOURS!=='undefined'&&PROGRAM_HOURS[p.id])?JSON.parse(JSON.stringify(PROGRAM_HOURS[p.id])):p.hours};
    return {
      ...p,
      name:ov.name??p.name,
      exit:ov.exit??p.exit,
      semesters:Array.isArray(ov.semesters)?JSON.parse(JSON.stringify(ov.semesters)):JSON.parse(JSON.stringify(p.semesters)),
      hours:Array.isArray(ov.hours)?JSON.parse(JSON.stringify(ov.hours)):((typeof PROGRAM_HOURS!=='undefined'&&PROGRAM_HOURS[p.id])?JSON.parse(JSON.stringify(PROGRAM_HOURS[p.id])):p.hours)
    };
  });
  return [...base,...customPrograms];
}
function programs(){return allPrograms().filter(p=>!disabledPrograms.includes(p.id))}
function key(pid,s,c){return `${pid}|${s}|${c}`}
function fullName(){return [$('apPat').value.trim(),$('apMat').value.trim(),$('nombres').value.trim()].filter(Boolean).join(' ')}
function isEnglish(name){return /^INGLÉS\b/i.test(name.trim())}
function subjectCase(text){
  if(!text)return '';
  let s=String(text).trim().toLocaleLowerCase('es-MX');
  s=s.charAt(0).toLocaleUpperCase('es-MX')+s.slice(1);
  // Acrónimos y números romanos de uso frecuente
  s=s.replace(/\bcad\b/gi,'CAD').replace(/\bcam\b/gi,'CAM');
  s=s.replace(/\b(i|ii|iii|iv|v)\b/gi,m=>m.toUpperCase());
  return s;
}
function programAcronym(pr){
  if(programAcronyms[pr.id])return programAcronyms[pr.id];
  const map={
    auto_diseno:'IMA-DMA',
    mec_ind:'IM-MI',
    mec_moldes:'IM-MT',
    mec_auto:'IM-MA',
    ind_plasticos:'II-MP',
    ind_procesos:'II-PP',
    nano:'IN-N',
    mantenimiento:'IMI-MI'
  };
  return map[pr.id]||pr.id.replace(/^custom_/,'PE-').slice(0,12).toUpperCase();
}


function subjectHours(pid,s,c){
  const pr=allPrograms().find(x=>x.id===pid);
  const edited=Number(pr?.hours?.[s]?.[c])||0;
  if(edited)return edited;
  const rows=(typeof PROGRAM_HOURS!=='undefined'&&PROGRAM_HOURS[pid])||[];
  return Number(rows?.[s]?.[c])||0;
}
function weeklyHours(pid,s,c){
  const total=subjectHours(pid,s,c);
  if(!total)return '';
  const weekly=total/15;
  return Number.isInteger(weekly)?weekly:Number(weekly.toFixed(1));
}
function deadlinePassed(){
  return !!cfg.captureDeadline && Date.now()>=Number(cfg.captureDeadline);
}
function submissionLockedForCurrentPeriod(){
  return !!store.submittedPeriod && store.submittedPeriod===cfg.periodo;
}
function individualEditOverride(){
  return !!store.individualEditEnabled;
}
function editingAllowed(){
  // El administrador siempre conserva acceso.
  // Un permiso individual puede reabrir SOLO ese perfil incluso si la edición global está cerrada.
  // Sin permiso individual se respetan el bloqueo global, la fecha límite y el cierre por finalización.
  return isAdmin() || (!deadlinePassed() && (
    individualEditOverride() ||
    (!cfg.editingLocked && !submissionLockedForCurrentPeriod())
  ));
}
function formatDateTime(ts){
  if(!ts)return 'Sin fecha límite';
  return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(Number(ts)));
}
function remainingParts(ms){
  const total=Math.max(0,Math.floor(ms/1000));
  const d=Math.floor(total/86400),h=Math.floor((total%86400)/3600),m=Math.floor((total%3600)/60),s=total%60;
  return {d,h,m,s};
}
function deadlineText(){
  if(!cfg.captureDeadline)return {text:'Captura sin fecha límite definida',level:'neutral'};
  const ms=Number(cfg.captureDeadline)-Date.now();
  if(ms<=0)return {text:`CAPTURA FUERA DE TIEMPO · cerró ${formatDateTime(cfg.captureDeadline)}`,level:'expired'};
  const x=remainingParts(ms);
  const text=`Tiempo restante: ${x.d?x.d+' d · ':''}${String(x.h).padStart(2,'0')} h · ${String(x.m).padStart(2,'0')} min · ${String(x.s).padStart(2,'0')} s`;
  return {text,level:ms<=3*3600000?'urgent':ms<=24*3600000?'warning':'open'};
}
function updateCountdownUI(){
  const info=deadlineText();
  ['deadlineGate','deadlineHeader','deadlineCapture'].forEach(id=>{
    const el=$(id);if(!el)return;
    el.textContent=info.text;
    el.className=`deadline-card ${id==='deadlineHeader'?'header-deadline ':id==='deadlineCapture'?'capture-deadline ':'compact '}${info.level}`;
  });
  const st=$('deadlineAdminStatus'),prev=$('deadlineAdminPreview');
  if(st){st.textContent=cfg.captureDeadline?(deadlinePassed()?'Fuera de tiempo':'Captura abierta'):'Sin fecha límite';st.className=`deadline-admin-status ${deadlinePassed()?'expired':cfg.captureDeadline?'open':'neutral'}`}
  if(prev)prev.innerHTML=cfg.captureDeadline?`<b>${formatDateTime(cfg.captureDeadline)}</b><span>${info.text}</span>`:'<b>Sin fecha límite</b><span>La edición dependerá únicamente del interruptor general.</span>';
  applyEditState();
}
function startCountdown(){
  clearInterval(countdownTimer);updateCountdownUI();countdownTimer=setInterval(updateCountdownUI,1000);
}
function requireEditing(){
  if(editingAllowed())return true;
  if(submissionLockedForCurrentPeriod()) toast('Este perfil ya fue finalizado. Si requiere corregirlo, solicite al JUCA habilitar su edición.');
  else if(deadlinePassed()) toast('La fecha límite de captura ya concluyó.');
  else toast('La edición de perfiles está temporalmente desactivada.');
  return false;
}
function applyEditState(){
  const locked=!editingAllowed();
  document.body.classList.toggle('profile-edit-locked',locked);
  ['perfil','captura'].forEach(id=>{
    const root=$(id); if(!root)return;
    root.querySelectorAll('input,select,textarea,button').forEach(el=>{
      // En solo lectura se permite navegar por todos los programas y llegar a Revisión.
      if(el.closest('.flow-buttons')) return;
      if(id==='captura' && el.textContent.includes('Continuar a revisión')) return;
      el.disabled=locked;
    });
  });
  const banner=$('editingLockedBanner');
  if(banner){
    banner.classList.toggle('hidden',!locked);
    if(locked){
      banner.textContent=submissionLockedForCurrentPeriod()
        ?'🔒 Perfil finalizado. Puede consultarlo e imprimirlo nuevamente, pero la edición quedó bloqueada. Si requiere corregir algo, consúltelo con el JUCA.'
        :deadlinePassed()
          ?'⏱ Captura fuera de tiempo. Puede consultar e imprimir, pero la edición está cerrada.'
          :'🔒 Edición desactivada por Administración. Puede consultar todo su perfil e imprimirlo normalmente.';
    }
  }
}
window.toggleEditingLock=async function(){
  if(!isAdmin()){toast('Solo el administrador puede cambiar este estado.');return}
  const previous=!!cfg.editingLocked;
  cfg.editingLocked=!previous;
  try{
    persist();
    await saveGlobalSettings(cfg.editingLocked?'Edición global desactivada':'Edición global activada');
    renderAdmin();
    applyEditState();
    toast(cfg.editingLocked
      ?'Edición general desactivada. Solo podrán editar los perfiles con habilitación individual.'
      :'Edición general activada para perfiles que no estén finalizados.');
  }catch(e){
    cfg.editingLocked=previous;
    persist();renderAdmin();applyEditState();
    console.error(e);
    alert('No fue posible cambiar el estado general de edición. Revise la conexión con Firestore.');
  }
}


function normalizeSubjectName(name){
  return subjectCase(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function commonRuleFor(pid,s){
  return commonRules.find(r=>
    Array.isArray(r.programIds)&&r.programIds.includes(pid)&&
    Array.isArray(r.semesters)&&r.semesters.includes(s)
  )||null;
}
function commonRuleForProgram(pid){
  return commonRules.find(r=>Array.isArray(r.programIds)&&r.programIds.includes(pid))||null;
}
function logicalCourseKey(pid,s,c,name){
  const rule=commonRuleFor(pid,s);
  return rule?`${rule.id}|${s}|${normalizeSubjectName(name)}`:`${pid}|${s}|${c}`;
}
function commonDescription(pid){
  const rule=commonRuleForProgram(pid);
  if(!rule)return '';
  const sems=(rule.semesters||[]).map(x=>x+1).sort((a,b)=>a-b).join(', ');
  const names=(rule.programIds||[]).map(id=>{
    const p=allPrograms().find(x=>x.id===id);
    return p?programAcronym(p):id;
  }).join(' · ');
  return `${rule.name}: cuatrimestre${rule.semesters?.length===1?'':'s'} ${sems} · ${names}`;
}

function getAns(pid,s,c,name){
  const k=key(pid,s,c);
  if(isEnglish(name)){answers[k]={status:'na',origins:[],ideal:false};return answers[k]}
  if(!answers[k])answers[k]={status:'pending',origins:[],ideal:false};
  return answers[k]
}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2400)}
function persist(){
  cfg.periodo=cfg.periodo||'SEP 2026 - AGO 2027';
  store.cfg=cfg;store.answers=answers;store.programMeta=programMeta;store.customPrograms=customPrograms;store.programOverrides=programOverrides;store.disabledPrograms=disabledPrograms;store.programAcronyms=programAcronyms;store.commonRules=commonRules;store.currentProgramIndex=currentProgramIndex;store.lastSavedAt=Date.now();
  lastSavedAt=store.lastSavedAt;
  localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
  updateLastSavedUI();
  scheduleCloudProfileSave();
}
function statusBox(errors,title){return `<div class="status-box bad"><b>${title}</b><ul>${errors.map(x=>`<li>${x}</li>`).join('')}</ul></div>`}
function updatePeriodBadges(){ $('periodBadgeGate').textContent=`Periodo de vigencia · ${cfg.periodo}`; $('periodBadgeInline').textContent=`Periodo de vigencia · ${cfg.periodo}`; }
function authConfigured(){return !!(window.FIREBASE_CONFIG&&window.FIREBASE_CONFIG.apiKey&&window.FIREBASE_CONFIG.authDomain&&window.FIREBASE_CONFIG.projectId&&window.FIREBASE_CONFIG.appId)}

function updateCloudStatus(text,kind='neutral'){
  const el=$('cloudStatus');if(!el)return;el.textContent=text;el.className=`cloud-status ${kind}`;
}
function updateLastSavedUI(){
  const el=$('lastSaved');if(!el)return;
  if(!lastSavedAt){el.textContent='Sin cambios guardados';return}
  el.textContent=`Último guardado: ${new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit'}).format(new Date(lastSavedAt))}`;
}
function globalSettingsPayload(){
  return {
    cfg:{...cfg},
    disabledPrograms:[...disabledPrograms],
    customPrograms:JSON.parse(JSON.stringify(customPrograms)),
    programOverrides:JSON.parse(JSON.stringify(programOverrides)),
    programAcronyms:{...programAcronyms},
    commonRules:JSON.parse(JSON.stringify(commonRules))
  };
}
function applyGlobalSettings(data){
  if(!data)return;
  if(data.cfg)Object.assign(cfg,data.cfg);
  if(Array.isArray(data.disabledPrograms))disabledPrograms=data.disabledPrograms;
  if(Array.isArray(data.customPrograms))customPrograms=data.customPrograms;
  if(data.programOverrides&&typeof data.programOverrides==='object')programOverrides=data.programOverrides;
  if(data.programAcronyms&&typeof data.programAcronyms==='object')programAcronyms=data.programAcronyms;
  if(Array.isArray(data.commonRules))commonRules=data.commonRules;
  currentProgramIndex=Math.min(currentProgramIndex,Math.max(0,programs().length-1));
  localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,currentProgramIndex,lastSavedAt}));
  updatePeriodBadges();renderCurrentProgram();renderAdmin();updateCountdownUI();applyEditState();updateNavState();
}
async function saveGlobalSettings(action='Configuración global actualizada'){
  if(!db||!isAdmin())return;
  try{
    await setDoc(doc(db,'settings','app'),{...globalSettingsPayload(),updatedAt:serverTimestamp(),updatedBy:currentUser.email},{merge:true});
    updateCloudStatus('Configuración global sincronizada','ok');
    await writeAudit(action);
  }catch(e){
    console.warn('No se pudo guardar configuración global',e);
    updateCloudStatus('Configuración global solo local','warn');
  }
}
async function writeAudit(action){
  if(!db||!currentUser)return;
  try{
    await addDoc(collection(db,'audit'),{action,email:currentUser.email||'',uid:currentUser.uid,at:serverTimestamp(),period:cfg.periodo});
  }catch(e){console.warn('Auditoría no disponible',e)}
}
function resetLocalTeacherData({keepProfile=false}={}){
  const previousProfile=store.profile||{};
  store.profile=keepProfile?JSON.parse(JSON.stringify(previousProfile)):{};
  answers={};
  programMeta={};
  store.answers=answers;
  store.programMeta=programMeta;
  store.submittedPeriod=null;
  store.finalizedAtMs=null;
  store.individualEditEnabled=false;
  store.profileResetToken=null;
  currentProgramIndex=0;
  lastSavedAt=null;

  localStorage.setItem('PAD_UTEQ',JSON.stringify({
    ...store,cfg,answers,programMeta,customPrograms,programOverrides,
    disabledPrograms,programAcronyms,commonRules,currentProgramIndex,lastSavedAt
  }));

  buildProfileRows();
  loadProfileValuesOnly();
  renderCurrentProgram();
  updateProgress();
  applyEditState();
  updateNavState();
}
function profileCloudPayload(){
  return {
    uid:currentUser?.uid||'',
    email:currentUser?.email||'',
    displayName:currentUser?.displayName||'',
    profile:store.profile||{},
    answers:JSON.parse(JSON.stringify(answers)),
    programMeta:JSON.parse(JSON.stringify(programMeta)),
    period:cfg.periodo,
    submittedPeriod:store.submittedPeriod||null,
    finalizedAtMs:store.finalizedAtMs||null,
    individualEditEnabled:!!store.individualEditEnabled,
    profileResetToken:store.profileResetToken||null,
    updatedAt:serverTimestamp()
  };
}
function scheduleCloudProfileSave(){
  if(!db||!currentUser||!remoteProfileLoaded)return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(async()=>{
    try{
      await setDoc(doc(db,'profiles',currentUser.uid),profileCloudPayload(),{merge:true});
      updateCloudStatus('Sincronizado','ok');
    }catch(e){
      console.warn('Guardado en nube no disponible',e);
      updateCloudStatus('Guardado local · nube pendiente','warn');
    }
  },700);
}
async function loadRemoteProfile(){
  if(!db||!currentUser)return;
  try{
    const snap=await getDoc(doc(db,'profiles',currentUser.uid));
    if(snap.exists()){
      const d=snap.data();
      if(d.profile)store.profile=d.profile;
      if(d.answers)answers=d.answers;
      if(d.programMeta)programMeta=d.programMeta;
      if('submittedPeriod' in d)store.submittedPeriod=d.submittedPeriod||null;
      if('finalizedAtMs' in d)store.finalizedAtMs=Number(d.finalizedAtMs)||null;
      if('individualEditEnabled' in d)store.individualEditEnabled=!!d.individualEditEnabled;
      if('profileResetToken' in d)store.profileResetToken=d.profileResetToken||null;
      store.answers=answers;store.programMeta=programMeta;
      localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,currentProgramIndex,lastSavedAt}));
      loadProfileValuesOnly();
      renderCurrentProgram();
      updateProgress();
    }
    if(!snap.exists()){
      resetLocalTeacherData({keepProfile:false});
    }
    remoteProfileLoaded=true;
    updateCloudStatus('Sincronización activa','ok');
  }catch(e){
    remoteProfileLoaded=true;
    console.warn('Perfil remoto no disponible',e);
    updateCloudStatus('Modo local','warn');
  }
}
async function initCloud(){
  if(!db||!currentUser)return;
  cloudAvailable=true;
  try{
    const ref=doc(db,'settings','app');
    const first=await getDoc(ref);
    if(first.exists())applyGlobalSettings(first.data());
    else if(isAdmin())await setDoc(ref,{...globalSettingsPayload(),updatedAt:serverTimestamp(),updatedBy:currentUser.email},{merge:true});
    if(cloudSettingsUnsub)cloudSettingsUnsub();
    cloudSettingsUnsub=onSnapshot(ref,s=>{if(s.exists())applyGlobalSettings(s.data())},e=>{console.warn(e);updateCloudStatus('Configuración global no disponible','warn')});
  }catch(e){
    console.warn('Firestore settings no disponible',e);
    updateCloudStatus('Firestore pendiente de configurar','warn');
  }
  await loadRemoteProfile();
  if(cloudProfileMetaUnsub)cloudProfileMetaUnsub();
  cloudProfileMetaUnsub=onSnapshot(doc(db,'profiles',currentUser.uid),s=>{
    if(!s.exists()){
      if(remoteProfileLoaded&&!isAdmin()){
        resetLocalTeacherData({keepProfile:false});
        toast('Administración eliminó este perfil. La captura iniciará desde cero.');
      }
      return;
    }
    const d=s.data()||{};
    const priorPeriod=store.submittedPeriod||null;
    const priorOverride=!!store.individualEditEnabled;
    const priorResetToken=store.profileResetToken||null;
    store.submittedPeriod=d.submittedPeriod||null;
    store.finalizedAtMs=Number(d.finalizedAtMs)||null;
    store.individualEditEnabled=!!d.individualEditEnabled;
    store.profileResetToken=d.profileResetToken||null;

    if(store.profileResetToken&&priorResetToken!==store.profileResetToken&&!isAdmin()){
      answers={};
      programMeta={};
      store.answers=answers;
      store.programMeta=programMeta;
      currentProgramIndex=0;
      if(d.profile)store.profile=d.profile;
      localStorage.setItem('PAD_UTEQ',JSON.stringify({
        ...store,cfg,answers,programMeta,customPrograms,programOverrides,
        disabledPrograms,programAcronyms,commonRules,currentProgramIndex,lastSavedAt
      }));
      loadProfileValuesOnly();
      renderCurrentProgram();
      updateProgress();
      applyEditState();
      updateNavState();
      toast('Administración reinició la captura por asignaturas. Puede editar nuevamente su perfil.');
      return;
    }

    if(priorPeriod!==store.submittedPeriod || priorOverride!==store.individualEditEnabled){
      localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,currentProgramIndex,lastSavedAt}));
      applyEditState();updateNavState();
      toast(store.individualEditEnabled
        ?'Administración habilitó la edición únicamente para su perfil.'
        :(store.submittedPeriod===cfg.periodo?'Perfil finalizado. Edición bloqueada.':'La habilitación individual de edición terminó.'));
    }
  },e=>console.warn('No fue posible escuchar el estado del perfil',e));
}
async function loadTeachersForExport(){
  if(!db||!isAdmin())return [{name:fullName()||'(Profesor sin nombre)',category:store.profile?.categoria||'',answers,programMeta,email:currentUser?.email||''}];
  try{
    const snap=await getDocs(collection(db,'profiles'));
    const rows=[];
    snap.forEach(ds=>{
      const d=ds.data(),p=d.profile||{};
      const name=[p.apPat,p.apMat,p.nombres].filter(Boolean).join(' ')||d.displayName||d.email||'(Sin nombre)';
      rows.push({name,category:p.categoria||'',answers:d.answers||{},programMeta:d.programMeta||{},email:d.email||'',uid:ds.id,submittedPeriod:d.submittedPeriod||null,finalizedAtMs:Number(d.finalizedAtMs)||null});
    });
    return rows.length?rows:[{name:fullName()||'(Profesor sin nombre)',category:store.profile?.categoria||'',answers,programMeta,email:currentUser?.email||''}];
  }catch(e){
    console.warn('No fue posible leer todos los perfiles',e);
    return [{name:fullName()||'(Profesor sin nombre)',category:store.profile?.categoria||'',answers,programMeta,email:currentUser?.email||''}];
  }
}
function teacherAnswer(t,pid,s,c,name){
  if(isEnglish(name))return {status:'na',origins:[],ideal:false};
  return (t.answers||{})[key(pid,s,c)]||{status:'pending',origins:[],ideal:false};
}
function teacherCoordinator(t,pid,s,c){
  return !!(((t.programMeta||{})[pid]||{}).coordinators||[]).includes(`${s}|${c}`);
}

function isInstitutional(email){return !!email&&email.toLowerCase().endsWith('@'+allowedDomain)}
function isAdmin(){return !!currentUser&&currentUser.email&&currentUser.email.toLowerCase()===adminEmail}

function showApp(visible){document.querySelector('header').style.display=visible?'block':'none';document.querySelector('.main-nav').style.display=visible?'flex':'none';document.querySelector('main').style.display=visible?'block':'none';document.querySelector('.site-footer').style.display=visible?'block':'none';$('loginGate').classList.toggle('hidden',visible)}
function institutionalAccessMessage(extra=''){
  const base =
    `Acceso institucional UTEQ\n\n`+
    `Debes ingresar con una cuenta @${allowedDomain}.\n\n`+
    `Esta plataforma NO solicita ni almacena tu contraseña. `+
    `Únicamente solicita seleccionar tu cuenta institucional mediante Google. `+
    `Si Google necesita verificar tu identidad, cualquier contraseña o segundo factor `+
    `se captura únicamente en la pantalla de Google y nunca en esta página.`;
  return extra?`${base}\n\n${extra}`:base;
}
function showInstitutionalAccessMessage(extra=''){
  alert(institutionalAccessMessage(extra));
}
function updateAuthUI(){
  const gateStatus=$('authStatusGate'),topStatus=$('authStatus');
  if(authConfigured()){
    gateStatus.textContent=currentUser?`${currentUser.email}${isAdmin()?' · administrador':''}`:`Sin sesión · use una cuenta @${allowedDomain}`;
    topStatus.textContent=currentUser?`${currentUser.email}${isAdmin()?' · administrador':''}`:`Sin sesión · use una cuenta @${allowedDomain}`;
    $('btnLogin').classList.toggle('hidden',!!currentUser);
    $('btnLogout').classList.toggle('hidden',!currentUser);
    $('btnLoginGate').classList.toggle('hidden',!!currentUser);
  }else{
    gateStatus.textContent='Configuración de Firebase incompleta.';
    topStatus.textContent='Configuración de Firebase incompleta.';
    $('btnLogin').classList.remove('hidden');
    $('btnLogout').classList.add('hidden');
    $('btnLoginGate').classList.remove('hidden');
  }
  $('adminTab').classList.toggle('hidden',!isAdmin());
  showApp(!!currentUser);
}
function isIOSAuthClient(){
  const ua=navigator.userAgent||'';
  return /iPad|iPhone|iPod/i.test(ua)
    || (navigator.platform==='MacIntel' && Number(navigator.maxTouchPoints)>1);
}
function shouldUseRedirectAuth(){
  const ua=navigator.userAgent||'';
  const mobileUA=/Android|Mobile|IEMobile|Opera Mini/i.test(ua);
  const narrow=window.matchMedia?window.matchMedia('(max-width: 780px)').matches:false;
  return isIOSAuthClient() || mobileUA || narrow;
}
async function redirectInstitutionalSignIn(provider){
  try{
    const gate=$('authStatusGate');
    if(gate)gate.textContent='Abriendo acceso seguro de Google…';
    await signInWithRedirect(auth,provider);
    return true;
  }catch(e){
    console.error('Redirect auth error',e);
    showInstitutionalAccessMessage(
      'No fue posible abrir el acceso seguro de Google. Verifica que Safari/tu navegador permita navegar a Google y vuelve a intentarlo.'
    );
    return false;
  }
}
window.signIn=async function(){
  if(!authConfigured()){
    alert('Firebase no está configurado correctamente. Revisa firebase-config.js y confirma apiKey, authDomain, projectId y appId.');
    return;
  }

  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({hd:allowedDomain,prompt:'select_account'});

  try{
    // En iPhone/iPad y móviles se evita la ventana emergente.
    // Safari antiguo puede bloquearla aun cuando el usuario toca el botón.
    if(shouldUseRedirectAuth()){
      await redirectInstitutionalSignIn(provider);
      return;
    }

    // En escritorio el popup sigue siendo la experiencia principal.
    // Importante: no hay ningún await antes de abrirlo, para conservar
    // la activación del clic del usuario y evitar auth/popup-blocked.
    const res=await signInWithPopup(auth,provider);
    const email=(res.user.email||'').toLowerCase();

    if(!isInstitutional(email)){
      await signOut(auth);
      showInstitutionalAccessMessage(
        `La cuenta seleccionada no pertenece al dominio autorizado. Selecciona una cuenta @${allowedDomain}.`
      );
      return;
    }
  }catch(e){
    const code=e&&e.code?e.code:'';

    if(code==='auth/api-key-not-valid.-please-pass-a-valid-api-key.' || code==='auth/invalid-api-key'){
      alert('La configuración de Firebase no es válida. Revisa los GitHub Actions Secrets y vuelve a desplegar.');
      return;
    }

    // Si un navegador de escritorio bloquea el popup, cambia
    // automáticamente a redirect. No muestra una confirmación intermedia.
    if(
      code==='auth/popup-blocked'
      || code==='auth/operation-not-supported-in-this-environment'
      || code==='auth/web-storage-unsupported'
    ){
      await redirectInstitutionalSignIn(provider);
      return;
    }

    if(code==='auth/popup-closed-by-user' || code==='auth/cancelled-popup-request'){
      showInstitutionalAccessMessage(
        'El proceso de Google se cerró antes de seleccionar la cuenta institucional.'
      );
      return;
    }

    console.error(e);
    showInstitutionalAccessMessage(
      'No fue posible completar el inicio de sesión. Vuelve a intentarlo seleccionando tu cuenta @uteq.edu.mx.'
    );
  }
}
window.signOutApp=async function(){
  try{
    if(db&&currentUser&&remoteProfileLoaded){
      try{
        await setDoc(doc(db,'profiles',currentUser.uid),profileCloudPayload(),{merge:true});
      }catch(e){
        console.warn('No fue posible hacer el guardado final antes de cerrar sesión',e);
      }
    }
    if(auth)await signOut(auth);
  }finally{
    localStorage.removeItem('PAD_UTEQ');
    sessionStorage.clear();
    try{
      if('caches' in window){
        const keys=await caches.keys();
        await Promise.all(keys.map(k=>caches.delete(k)));
      }
    }catch(e){
      console.warn('No fue posible limpiar Cache Storage',e);
    }
    location.reload();
  }
}

function initAuth(){
  if(!authConfigured()){updateAuthUI();return}
  const fbApp=initializeApp(window.FIREBASE_CONFIG);
  auth=getAuth(fbApp);
  db=getFirestore(fbApp);

  // Se configura al iniciar la aplicación. Así el clic de acceso queda
  // libre para abrir Google inmediatamente, algo importante en Safari/iOS.
  setPersistence(auth,browserLocalPersistence).catch(e=>{
    console.warn('No fue posible establecer persistencia local de Auth',e);
  });

  onAuthStateChanged(auth,async user=>{
    currentUser=user;
    remoteProfileLoaded=false;
    if(user&&!isInstitutional(user.email||'')){
      signOut(auth);
      currentUser=null;
      showInstitutionalAccessMessage(`La cuenta seleccionada no pertenece al dominio autorizado @${allowedDomain}.`);
    }
    updateAuthUI();
    if(currentUser)await initCloud();
  });
}

window.go=function(id,force=false){
  if(id==='admin'&&!isAdmin()){toast('Administración disponible únicamente para ivan.gutierrez@uteq.edu.mx');return}
  if(id==='captura'&&!force){const p=validateProfile({visual:true,focusFirst:true});if(!p.ok){$('profileErrors').innerHTML=statusBox(p.errors,'Complete los datos obligatorios antes de continuar.');return}}
  if(id==='revision'&&!force){
    const v=validateAll();
    if(!reviewAvailable()){showCaptureErrors(v.errors);return}
  }
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$(id).classList.add('active');
  document.querySelectorAll('.main-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  if(id==='revision')buildPrint();if(id==='admin')renderAdmin();scrollTo(0,0);
}
document.querySelectorAll('.main-nav button').forEach(b=>b.onclick=()=>window.go(b.dataset.view));


function profileLooksComplete(){
  const p=store.profile||{},e=p.extra||{};
  return !!(p.apPat&&p.apMat&&p.nombres&&p.categoria&&e.f1a&&e.f1b&&e.d1a&&e.d1c&&e.l1a&&e.l1b&&e.l1c);
}
function updateNavState(){
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

function buildProfileRows(){
  const f=['Licenciatura o TSU','Posgrado 1','Posgrado 2','Posgrado 3','Posgrado 4','Posgrado 5','Posgrado 6'];
  $('formacion').innerHTML=f.map((lab,i)=>`<div class="form-row two"><div class="row-label">${lab}${i===0?' *':''}</div><input placeholder="${i===0?'Ej. Licenciatura en Ingeniería Industrial':'Ej. Maestría en Educación'}" data-g="f${i+1}a"><input placeholder="Ej. Universidad Tecnológica de Querétaro" data-g="f${i+1}b"></div>`).join('');
  $('docencia').innerHTML=Array.from({length:4},(_,i)=>`<div class="form-row two"><div class="row-label">Institución ${i+1}${i===0?' *':''}</div><input placeholder="Ej. UTEQ" data-g="d${i+1}a"><input placeholder="Ej. sep 2023 - ago 2025" data-g="d${i+1}c"></div>`).join('');
  $('laboral').innerHTML=Array.from({length:5},(_,i)=>`<div class="form-row"><div class="row-label">Organización ${i+1}${i===0?' *':''}</div><input placeholder="Ej. Empresa / institución" data-g="l${i+1}a"><input placeholder="Ej. Jefe de área" data-g="l${i+1}b"><input placeholder="Ej. ene 2020 - dic 2023" data-g="l${i+1}c"></div>`).join('');
}
function loadProfileValuesOnly(){
  const p=store.profile||{};
  ['apPat','apMat','nombres','categoria'].forEach(x=>{if($(x))$(x).value=p[x]||''});
  document.querySelectorAll('[data-g]').forEach(x=>x.value=(p.extra||{})[x.dataset.g]||'');
}
function loadProfile(){
  if(!$('categoria').options.length)CATEGORIES.forEach(c=>$('categoria').add(new Option(c,c)));
  buildProfileRows();
  loadProfileValuesOnly();
}
function collectProfile(){let extra={};document.querySelectorAll('[data-g]').forEach(x=>extra[x.dataset.g]=x.value.trim());store.profile={apPat:$('apPat').value.trim(),apMat:$('apMat').value.trim(),nombres:$('nombres').value.trim(),categoria:$('categoria').value,extra};persist();return store.profile}
function requiredProfileChecks(p,e){
  return [
    {el:$('apPat'),missing:!p.apPat,msg:'Capture el apellido paterno.'},
    {el:$('apMat'),missing:!p.apMat,msg:'Capture el apellido materno.'},
    {el:$('nombres'),missing:!p.nombres,msg:'Capture los nombres.'},
    {el:$('categoria'),missing:!p.categoria,msg:'Seleccione la categoría.'},
    {el:document.querySelector('[data-g="f1a"]'),missing:!e.f1a,msg:'Capture el grado / estudio de la primera línea de Formación profesional.'},
    {el:document.querySelector('[data-g="f1b"]'),missing:!e.f1b,msg:'Capture la institución de la primera línea de Formación profesional.'},
    {el:document.querySelector('[data-g="d1a"]'),missing:!e.d1a,msg:'Capture la institución de la primera línea de Experiencia docente.'},
    {el:document.querySelector('[data-g="d1c"]'),missing:!e.d1c,msg:'Capture el periodo de la primera línea de Experiencia docente.'},
    {el:document.querySelector('[data-g="l1a"]'),missing:!e.l1a,msg:'Capture la organización de la primera línea de Experiencia laboral.'},
    {el:document.querySelector('[data-g="l1b"]'),missing:!e.l1b,msg:'Capture el cargo de la primera línea de Experiencia laboral.'},
    {el:document.querySelector('[data-g="l1c"]'),missing:!e.l1c,msg:'Capture el periodo de la primera línea de Experiencia laboral.'}
  ];
}
function clearRequiredHighlights(){
  document.querySelectorAll('#perfil .required-field-error').forEach(el=>el.classList.remove('required-field-error'));
  document.querySelectorAll('#perfil .required-wrap-error').forEach(el=>el.classList.remove('required-wrap-error'));
}
function highlightRequired(checks,focusFirst=false){
  clearRequiredHighlights();
  const missing=checks.filter(x=>x.missing&&x.el);
  missing.forEach(x=>{
    x.el.classList.add('required-field-error');
    const wrap=x.el.closest('label,.form-row');
    if(wrap)wrap.classList.add('required-wrap-error');
  });
  if(focusFirst&&missing.length){
    const el=missing[0].el;
    el.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>{try{el.focus({preventScroll:true})}catch(_){el.focus()}},320);
  }
}
function validateProfile(opts={}){
  const p=collectProfile(),e=p.extra||{},checks=requiredProfileChecks(p,e);
  const errors=checks.filter(x=>x.missing).map(x=>x.msg);
  if(opts.visual)highlightRequired(checks,!!opts.focusFirst);
  return{ok:!errors.length,errors,checks}
}
window.saveSection=function(){if(!requireEditing())return;collectProfile();writeAudit('Sección de perfil guardada');toast('Avances guardados.')}
window.continueToCapture=async function(){
  if(!requireEditing())return false;

  // Cierra teclado móvil antes de validar/cambiar de vista.
  try{document.activeElement?.blur()}catch(_){}

  const v=validateProfile({visual:true,focusFirst:false});
  const errorBox=$('profileErrors');
  if(errorBox)errorBox.innerHTML=v.ok?'':statusBox(v.errors,'Complete los datos obligatorios antes de continuar.');

  if(!v.ok){
    const missing=v.checks.filter(x=>x.missing&&x.el);
    const first=missing[0]?.el;

    if(first){
      // En móvil: llevar de forma inequívoca al dato faltante.
      const mobile=window.matchMedia('(max-width: 780px)').matches;
      if(mobile){
        document.querySelectorAll('#perfil .mobile-required-focus').forEach(el=>el.classList.remove('mobile-required-focus'));
        first.classList.add('mobile-required-focus');
        const wrap=first.closest('label,.form-row,.section-card')||first;
        requestAnimationFrame(()=>{
          wrap.scrollIntoView({behavior:'smooth',block:'center'});
          setTimeout(()=>{
            try{first.focus({preventScroll:true})}catch(_){try{first.focus()}catch(__){}}
          },420);
        });
      }else{
        first.scrollIntoView({behavior:'smooth',block:'center'});
        setTimeout(()=>{try{first.focus({preventScroll:true})}catch(_){first.focus()}},320);
      }
    }
    return false;
  }

  clearRequiredHighlights();
  document.querySelectorAll('#perfil .mobile-required-focus').forEach(el=>el.classList.remove('mobile-required-focus'));

  // Guardar antes de cambiar de vista.
  collectProfile();
  persist();
  if(cloudAvailable&&currentUser){
    try{await saveProfileToCloud(false)}catch(e){console.warn('Guardado previo al avance',e)}
  }

  renderCurrentProgram();

  // Cambio de vista directo y seguro para móviles.
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  const capture=$('captura');
  if(capture)capture.classList.add('active');
  document.querySelectorAll('.main-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view==='captura'));

  requestAnimationFrame(()=>{
    const top=(capture?.offsetTop||0)-48;
    window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
  });

  updateNavState();
  return true;
}

function originCode(a){return(a.origins||[]).join('')}
function normalizeOrigins(code){return String(code).split('').map(Number)}
window.setEnabled=function(pid,s,c,name,on){if(!requireEditing())return;if(isEnglish(name))return;const r=getAns(pid,s,c,name);r.status=on?(r.status==='off'?'pending':r.status):'off';if(!on){r.origins=[];r.ideal=false}answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()}
window.setCompetence=function(pid,s,c,name,level){if(!requireEditing())return;const r=getAns(pid,s,c,name);if(['off','na'].includes(r.status))return;r.status=level;r.origins=[];answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()}
window.setOriginCode=function(pid,s,c,name,code){if(!requireEditing())return;const r=getAns(pid,s,c,name);if(!['X','XX'].includes(r.status))return;r.origins=normalizeOrigins(code);answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()}
window.toggleIdeal=function(pid,s,c,name){if(!requireEditing())return;const r=getAns(pid,s,c,name);if(!['X','XX'].includes(r.status)||(r.origins||[]).length===0){toast('Primero seleccione competencia y área de conocimiento.');return}r.ideal=!r.ideal;answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()}
function replicateCommon(pid,s,c,r){
  const source=allPrograms().find(x=>x.id===pid);
  const sourceName=source?.semesters?.[s]?.[c];
  const rule=commonRuleFor(pid,s);
  if(!source||!sourceName||!rule)return 0;
  const normalized=normalizeSubjectName(sourceName);
  let synced=0;
  (rule.programIds||[]).forEach(other=>{
    if(other===pid)return;
    const target=allPrograms().find(x=>x.id===other);
    const targetSem=target?.semesters?.[s]||[];
    const tc=targetSem.findIndex(n=>normalizeSubjectName(n)===normalized);
    if(tc<0)return;
    answers[key(other,s,tc)]={status:r.status,origins:[...(r.origins||[])],ideal:!!r.ideal};
    synced++;
  });
  return synced;
}

function programStats(p){let total=0,done=0,missing=0;p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{if(isEnglish(name))return;total++;const a=getAns(p.id,s,c,name);if(a.status!=='pending')done++;else missing++}));return{total,done,missing}}
function overallStats(){
  let total=0,done=0,invalid=0,pending=[];
  const pendingLogical=new Map();
  programs().forEach((p,pi)=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    if(isEnglish(name))return;
    total++;
    const a=getAns(p.id,s,c,name);
    if(a.status!=='pending')done++;
    else{
      const item={pi,pid:p.id,programName:p.name,exit:p.exit,s,c,name};
      pending.push(item);
      const logical=logicalCourseKey(p.id,s,c,name);
      if(!pendingLogical.has(logical))pendingLogical.set(logical,item);
    }
    if(['X','XX'].includes(a.status)&&!(a.origins||[]).length)invalid++;
  })));
  return{total,done,invalid,pending,pendingUnique:[...pendingLogical.values()],remainingUnique:pendingLogical.size}
}
function captureIssues(){
  const issues=[];
  programs().forEach((p,pi)=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    if(isEnglish(name))return;
    const a=getAns(p.id,s,c,name);
    if(a.status==='pending'){
      issues.push({
        type:'competence',
        pi,pid:p.id,programName:p.name,exit:p.exit,s,c,name,
        message:'Seleccione el nivel de competencia X o XX, o deshabilite la materia si no puede impartirla.'
      });
    }else if(['X','XX'].includes(a.status)&&!(a.origins||[]).length){
      issues.push({
        type:'area',
        pi,pid:p.id,programName:p.name,exit:p.exit,s,c,name,
        message:'Seleccione de dónde proviene el conocimiento: 1, 2, 3, 12, 13, 23 o 123.'
      });
    }
  })));
  return issues;
}
let captureErrorModeActive=false;

function captureIssuePanel(issues){
  const grouped=new Map();
  issues.forEach(issue=>{
    const key=`${issue.pi}|${issue.s}`;
    if(!grouped.has(key))grouped.set(key,{...issue,items:[]});
    grouped.get(key).items.push(issue);
  });
  const groups=[...grouped.values()];
  return `<div class="capture-error-panel">
    <div class="capture-error-title"><span class="capture-error-icon">!</span><div><b>No puede pasar a revisión todavía</b><span>Complete los campos señalados. La alerta desaparecerá automáticamente cuando quede corregido.</span></div></div>
    <div class="capture-error-groups">
      ${groups.map(g=>`<button type="button" class="capture-error-group" onclick="goToCaptureIssue(${g.pi},${g.s},${g.items[0].c})">
        <strong>${escapeHtml(g.programName)}</strong>
        <span>${g.s+1}.° cuatrimestre · ${g.items.length} pendiente${g.items.length===1?'':'s'}</span>
        <small>${g.items.slice(0,3).map(x=>escapeHtml(subjectCase(x.name))).join(' · ')}${g.items.length>3?' · …':''}</small>
      </button>`).join('')}
    </div>
  </div>`;
}
window.goToCaptureIssue=function(pi,s,c){
  currentProgramIndex=pi;
  persist();
  renderCurrentProgram();
  requestAnimationFrame(()=>{
    const row=document.querySelector(`[data-course-loc="${pi}|${s}|${c}"]`);
    if(row)row.scrollIntoView({behavior:'smooth',block:'center'});
  });
}
function refreshCaptureErrorState(){
  if(!captureErrorModeActive)return;
  const root=$('captureErrors');
  if(!root)return;
  const issues=captureIssues();
  const profileCheck=validateProfile();
  if(!issues.length&&profileCheck.ok){
    root.innerHTML='';
    captureErrorModeActive=false;
    toast('Captura corregida. Ya puede continuar a revisión.');
    return;
  }
  if(issues.length){
    root.innerHTML=captureIssuePanel(issues);
  }else{
    root.innerHTML=statusBox(profileCheck.errors,'Complete los datos del profesor.');
  }
}
function favoriteCount(){const u=new Set();programs().forEach(p=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{if(getAns(p.id,s,c,name).ideal)u.add(`${p.id}|${s}|${c}`)})));return u.size}
function updateProgress(){
  const x=overallStats(),pct=x.total?Math.round(x.done/x.total*100):0;
  $('progressText').textContent=`${x.done} de ${x.total} revisadas (${pct}%)${x.remainingUnique?` · ${x.remainingUnique} pendiente${x.remainingUnique===1?'':'s'}`:''}`;
  $('progressBar').style.width=pct+'%';
  $('idealCounter').textContent=`Materias favoritas: ${favoriteCount()} · opcionales`;
  const complete=programs().filter(p=>programStats(p).missing===0).length;
  if($('programCounter'))$('programCounter').textContent=`Programas completos: ${complete} de ${programs().length}`;
}
function currentProgram(){return programs()[currentProgramIndex]}
function eligibleCourses(p){const opts=[];p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{const a=getAns(p.id,s,c,name);if(['X','XX'].includes(a.status)&&(a.origins||[]).length)opts.push({id:`${s}|${c}`,text:`${s+1}.° · ${subjectCase(name)}`})}));return opts}
window.toggleCoordinatorMode=function(pid,on){
  if(!requireEditing())return;
  programMeta[pid]=programMeta[pid]||{};
  programMeta[pid].coordinatorEnabled=!!on;
  if(!on)programMeta[pid].coordinators=[];
  persist();renderCurrentProgram();
}
window.toggleCoordinator=function(pid,id,checked){
  if(!requireEditing())return;
  programMeta[pid]=programMeta[pid]||{};
  let arr=programMeta[pid].coordinators||[];
  arr=checked?[...new Set([...arr,id])]:arr.filter(x=>x!==id);
  programMeta[pid].coordinators=arr;persist();
}
function renderCoordinator(p){ return ''; }

function currentProgramIssues(){
  const p=currentProgram();
  if(!p)return [];
  const issues=[];
  p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    if(isEnglish(name))return;
    const a=getAns(p.id,s,c,name);
    if(a.status==='off')return;
    if(a.status==='pending'){
      issues.push({type:'competence',s,c,name,message:'Seleccione X o XX, o deshabilite la materia si no puede impartirla.'});
      return;
    }
    if(['X','XX'].includes(a.status)&&!(a.origins||[]).length){
      issues.push({type:'area',s,c,name,message:'Seleccione el área de conocimiento.'});
    }
  }));
  return issues;
}
function showCurrentProgramBlock(issues){
  if(!issues?.length)return;
  captureErrorModeActive=true;
  const p=currentProgram();
  const mapped=issues.map(x=>({
    ...x,
    pi:currentProgramIndex,
    pid:p.id,
    programName:p.name,
    exit:p.exit
  }));
  $('captureErrors').innerHTML=captureIssuePanel(mapped);
  renderCurrentProgram();
  requestAnimationFrame(()=>{
    const first=mapped[0];
    const row=document.querySelector(`[data-course-loc="${first.pi}|${first.s}|${first.c}"]`);
    if(row)row.scrollIntoView({behavior:'smooth',block:'center'});
  });
  toast('Complete primero las materias habilitadas de este programa.');
}
function canLeaveCurrentProgram(){
  const issues=currentProgramIssues();
  if(issues.length){
    showCurrentProgramBlock(issues);
    return false;
  }
  return true;
}


function rowCoordinatorChecked(pid,s,c){
  return !!(((programMeta[pid]||{}).coordinators||[]).includes(`${s}|${c}`));
}
function rowCoordinatorEnabled(pid,s,c,name){
  const a=getAns(pid,s,c,name);
  return !isEnglish(name) && !/no\s+aplica/i.test(name) && a.status!=='off' && ['X','XX'].includes(a.status);
}

const pastelTitles=['#eef4f9','#f7efe7','#edf6f0','#f2effa','#fff4ea','#ecf6f8','#f8eef1','#eef5e9'];
function captureGuideHtml(){
  return `<div class="instruction-band card capture-guide-band capture-guide-current">
    <div class="instruction-title">Cómo capturar cada asignatura</div>
    <div class="instruction-grid-five">
      <div class="capture-help-card">
        <b>1. Asignaturas habilitadas</b>
        <span><strong>Revise cada materia</strong> y márquela como <strong>apagada</strong> si usted no puede impartir esa asignatura. <strong>Al imprimir, la asignatura quedará vacía en el formato.</strong></span>
      </div>
      <div class="capture-help-card">
        <b>2. Competencia</b>
        <span>Seleccione el <strong>nivel que posee para impartir la asignatura</strong>.</span>
        <div class="competence-key-lines">
          <strong class="help-x">X = Competencia media</strong>
          <strong class="help-xx">XX = Competencia alta</strong>
        </div>
      </div>
      <div class="capture-help-card">
        <b>3. Área de conocimiento</b>
        <span>Seleccione una opción según corresponda al <strong>área de la cual proviene su conocimiento</strong>: <strong>1, 2 o 3</strong>, o una combinación de ellas.</span>
        <div class="knowledge-key knowledge-key-inline single-line-key"><b>1</b> Formación académica · <b>2</b> Experiencia docente · <b>3</b> Experiencia laboral</div>
      </div>
      <div class="capture-help-card reference-help-card">
        <b><span class="help-alert">!</span> 4. Coordinación</b>
        <span>Marque <strong class="help-check">✓</strong> solo si <strong>ha coordinado previamente esa asignatura</strong>. <strong>No aparece en la impresión</strong>; es una referencia para el coordinador.</span>
      </div>
      <div class="capture-help-card reference-help-card">
        <b><span class="help-alert">!</span> 5. Favorita</b>
        <span>De forma <strong>opcional</strong>, marque <strong class="help-star">★</strong> si considera que esa asignatura es <strong>ideal para impartir de acuerdo con su perfil profesional</strong>. <strong>No aparece en la impresión</strong>.</span>
      </div>
    </div>
  </div>`;
}

function renderCurrentProgram(){
  const p=currentProgram();if(!p)return;
  $('programStep').textContent=`Programa ${currentProgramIndex+1} de ${programs().length}`;
  $('programFlowName').innerHTML=`<strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.exit)}</span>`;
  const st=programStats(p);
  let bg = pastelTitles[currentProgramIndex % pastelTitles.length];

  const guideText='Guía rápida: activa la asignatura que puedes impartir · selecciona tu nivel de dominio (X = medio, XX = alto) · indica el origen del conocimiento (1 formación, 2 experiencia docente, 3 experiencia laboral o 12, 13, 23, 123) · marca ✓ si ya coordinaste esa materia · opcional: marca ★ Favorito si es una de tus asignaturas ideales para impartir.';

  let h=`<article class="program">
    ${captureGuideHtml()}
    <div class="capture-marquee" aria-label="${guideText}">
      <div class="capture-marquee-track"><span>${guideText}</span><span aria-hidden="true">${guideText}</span></div>
    </div>
    ${commonRuleForProgram(p.id)?`<div class="common-note"><b>↔ Tronco común · sincronizado</b><span>${commonDescription(p.id)}</span></div>`:''}
    ${renderCoordinator(p)}
    <div class="program-scroll-wrap">
      <div class="program-progress-strip"><span>${st.done}/${st.total} revisadas${st.missing?` · ${st.missing} pendientes`:''}</span></div>
      <div class="scroll-hint">↔ Si la pantalla es más angosta, desplácese horizontalmente para ver todas las columnas.</div>
      <div class="semesters-grid">`;

  p.semesters.forEach((sem,s)=>{
    h+=`<div class="semester-card">
      <h4>${s+1}.° cuatrimestre <span>${sem.length} asignaturas</span></h4>
      <div class="coord-fav-inline-note">
        <span class="coord-note-line">✓ Si ya la coordinaste</span>
        <span class="fav-note-line">★ Si es favorita</span>
      </div>
      <div class="course-columns">
        <span>Asignatura</span>
        <span>Habilitar</span>
        <span>Competencia</span>
        <span class="area-head">Área de conocimiento</span>
        <span class="coord-head">¿Coordinador?</span>
        <span class="fav-head">Favorita</span>
      </div>`;

    sem.forEach((name,c)=>{
      const a=getAns(p.id,s,c,name);
      const na=isEnglish(name);
      const enc=encodeURIComponent(name);
      const enabled=!['off','na'].includes(a.status);
      const pending=a.status==='pending';
      const reviewed=!pending&&!na;
      const needsCompetence=!na&&enabled&&pending;
      const needsArea=!na&&enabled&&['X','XX'].includes(a.status)&&!(a.origins||[]).length;
      const needsAttention=needsCompetence||needsArea;
      const loc=`${currentProgramIndex}|${s}|${c}`;

      h+=`<div class="course ${pending?'pending':''} ${a.status==='off'?'off':''} ${reviewed&&a.status!=='off'?'reviewed':''} ${na?'na na-clean':''} ${needsAttention?'needs-attention':''}" data-course-loc="${loc}">
        <div class="name">${subjectCase(name)}${subjectHours(p.id,s,c)?` <small class="course-hours">(${subjectHours(p.id,s,c)} h)</small>`:''}${na?' · NO APLICA':''}</div>`;

      if(na){
        h+=`<div class="control-placeholder"></div><div class="control-placeholder"></div><div class="control-placeholder"></div><div class="control-placeholder"></div><div class="control-placeholder"></div>`;
      }else{
        h+=`<label class="toggle">
          <input type="checkbox" ${enabled?'checked':''} onchange="setEnabled('${p.id}',${s},${c},decodeURIComponent('${enc}'),this.checked)">
          <span class="switch"></span><span>${enabled?'Sí':'No'}</span>
        </label>`;

        if(enabled){
          h+=`<div class="comp-buttons ${needsCompetence?'attention-target':''}">
            <button class="mini ${a.status==='X'?'on':''}" aria-label="Competencia media X" title="X = competencia media" onclick="setCompetence('${p.id}',${s},${c},decodeURIComponent('${enc}'),'X')">X</button>
            <button class="mini ${a.status==='XX'?'on':''}" aria-label="Competencia alta XX" title="XX = competencia alta" onclick="setCompetence('${p.id}',${s},${c},decodeURIComponent('${enc}'),'XX')">XX</button>
          </div>
          <div class="area-buttons ${needsArea?'attention-target':''}">
            ${['1','2','3','12','13','23','123'].map(code=>`<button class="mini area ${originCode(a)===code?'on':''}" aria-label="Área de conocimiento ${code}" title="${code.split('').join(' + ')}" ${!['X','XX'].includes(a.status)?'disabled':''} onclick="setOriginCode('${p.id}',${s},${c},decodeURIComponent('${enc}'),'${code}')">${code}</button>`).join('')}
          </div>
          <label class="coord-row-check ${rowCoordinatorChecked(p.id,s,c)?'on':''}" title="Marque únicamente si ya coordinó esta materia.">
            <input type="checkbox" aria-label="¿Has coordinado ${subjectCase(name)}?" ${rowCoordinatorChecked(p.id,s,c)?'checked':''} ${rowCoordinatorEnabled(p.id,s,c,name)?'':'disabled'} onchange="toggleCoordinator('${p.id}','${s}|${c}',this.checked)">
            <span>✓</span>
          </label>
          <button class="ideal-btn ${a.ideal?'on':''}" aria-label="${a.ideal?'Quitar de favoritas':'Marcar como favorita'}" title="${a.ideal?'Materia favorita':'Marcar como favorita'}" onclick="toggleIdeal('${p.id}',${s},${c},decodeURIComponent('${enc}'))">${a.ideal?'★':'☆'}</button>`;
        }else{
          h+=`<div class="control-placeholder"></div><div class="control-placeholder"></div><div class="control-placeholder"></div><div class="control-placeholder"></div>`;
        }
      }

      h+=`</div>`;
    });
    h+='</div>';
  });

  const lastProgram=currentProgramIndex===programs().length-1;
  h+=`</div></div>
    <div class="program-save">
      <small>${st.missing?'Las filas resaltadas indican información pendiente.':'Programa completo.'}</small>
      <button class="save-btn" onclick="saveAndNextProgram()">${lastProgram?'Continuar a revisión e impresión →':'Guardar y seguir →'}</button>
    </div>
  </article>`;

  $('programs').innerHTML=h;
  const flowBtn=$('flowNextBtn');
  if(flowBtn){
    flowBtn.textContent=lastProgram?'Continuar a revisión e impresión →':'Guardar y seguir →';
    flowBtn.onclick=()=>saveAndNextProgram();
  }
  updateProgress();lockRevisionNav();updateNavState();applyEditState();
  refreshCaptureErrorState();
}
window.prevProgram=function(){
  if(!canLeaveCurrentProgram())return;
  currentProgramIndex=(currentProgramIndex-1+programs().length)%programs().length;
  persist();renderCurrentProgram();
  scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'})
}
window.saveAndNextProgram=function(){
  if(!canLeaveCurrentProgram())return;
  persist();toast('Programa guardado.');
  if(currentProgramIndex>=programs().length-1){validateAndReview();return}
  currentProgramIndex++;
  persist();renderCurrentProgram();
  scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'})
}

function pendingCourseNames(limit=4){
  const seen=new Set(),names=[];
  programs().forEach(p=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    if(isEnglish(name))return;
    const a=getAns(p.id,s,c,name);
    if(a.status!=='pending')return;
    const logical=logicalCourseKey(p.id,s,c,name);
    if(seen.has(logical))return;
    seen.add(logical);names.push(subjectCase(name));
  })));
  return names.slice(0,limit);
}
function validateCapture(){
  const x=overallStats(),errs=[];
  if(x.remainingUnique){
    const names=pendingCourseNames(4);
    errs.push(`Falta${x.remainingUnique===1?'':'n'} ${x.remainingUnique} asignatura${x.remainingUnique===1?'':'s'} por revisar${names.length?`: ${names.join(', ')}${x.remainingUnique>names.length?'…':''}`:'.'}`);
  }
  if(x.invalid)errs.push(`${x.invalid} asignatura(s) tienen X/XX pero no tienen área de conocimiento.`);
  
  return{ok:!errs.length,errors:errs}
}
function validateAll(){const p=validateProfile(),c=validateCapture();return{ok:p.ok&&c.ok,errors:[...p.errors,...c.errors]}}
function reviewAvailable(){
  // Si Administración cerró la edición (o venció la fecha), el profesor puede
  // seguir consultando y generar/imprimir el estado actual de su perfil.
  return validateAll().ok || cfg.editingLocked || deadlinePassed() || submissionLockedForCurrentPeriod();
}
function showCaptureErrors(errs){
  captureErrorModeActive=true;
  const issues=captureIssues();
  if(issues.length){
    currentProgramIndex=issues[0].pi;
    persist();
    renderCurrentProgram();
    $('captureErrors').innerHTML=captureIssuePanel(issues);
    requestAnimationFrame(()=>{
      const first=issues[0];
      const row=document.querySelector(`[data-course-loc="${first.pi}|${first.s}|${first.c}"]`);
      if(row)row.scrollIntoView({behavior:'smooth',block:'center'});
    });
  }else{
    $('captureErrors').innerHTML=statusBox(errs,'No puede pasar a revisión todavía.');
  }
}
window.validateAndReview=function(){
  if(editingAllowed()) collectProfile();
  persist();
  const v=validateAll();
  if(!reviewAvailable()){showCaptureErrors(v.errors);toast('Complete las materias pendientes.');return}
  $('captureErrors').innerHTML='';
  $('validation').innerHTML=v.ok
    ?`<div class="status-box ok"><b>Perfil completo.</b><br>La información puede formalizarse e imprimirse.</div>`
    :`<div class="status-box info"><b>Consulta en modo solo lectura.</b><br>La edición está cerrada, pero puede revisar e imprimir el perfil capturado.</div>`;
  buildPrint();
  window.go('revision',true)
}
function lockRevisionNav(){$('navRevision').classList.toggle('locked',!reviewAvailable())}
window.saveAll=function(show=false){if(!requireEditing())return;collectProfile();persist();updateProgress();lockRevisionNav();writeAudit('Perfil guardado manualmente');if(show)toast('Perfil guardado.')}

function formatLocalProfileDateTime(ms){
  const n=Number(ms)||0;
  if(!n)return '';
  return new Intl.DateTimeFormat('es-MX',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date(n));
}
function printHeader(){
  const closedAt=formatLocalProfileDateTime(store.finalizedAtMs);
  return `<div class="sheetHead">
    <div class="brandPrint">
      <img src="logo-uteq-wordmark.svg" class="print-logo">
      <div class="printBrandText">UNIVERSIDAD TECNOLÓGICA<br>DE QUERÉTARO</div>
    </div>
    <div class="sheetTitle"><h2>PERFIL DEL PROFESOR</h2><b>DIVISIÓN: INDUSTRIAL</b><br><span>PERIODO DE VIGENCIA: ${cfg.periodo}</span></div>
    <div class="quality-plain"><span>${cfg.codigo}</span><span>${cfg.revision}</span><span>Fecha ${cfg.fechaRevision}</span>${closedAt?`<span class="quality-finalized">Cierre ${closedAt}</span>`:''}</div>
  </div>`;
}
function metaCentered(){return `<div class="meta center compactline"><span><b>Nombre:</b> ${fullName()}</span><span><b>Categoría:</b> ${store.profile?.categoria||''}</span><span><b>Competencia:</b> X = Medio · XX = Alto</span><span><b>Área de conocimiento:</b> 1 Formación · 2 Docencia · 3 Laboral</span></div>`}
function signatures(){return `<div class="sign"><div class="signature-line">${fullName()}<br>Firma del Profesor</div><div class="stamp-box">SELLO</div><div class="signature-line">${cfg.jefe}<br>Jefe de Unidad de Coordinación Académica</div></div>`}
function preambleSheet(){
  const p=store.profile||{},e=p.extra||{},f=['Licenciatura o TSU','Posgrado 1','Posgrado 2','Posgrado 3','Posgrado 4','Posgrado 5','Posgrado 6'];
  return `<div class="sheet profile-first-sheet">${printHeader()}<div class="meta center compactline first-profile-meta"><span class="first-meta-item"><b class="first-meta-label">Nombre:</b><strong class="first-meta-value">${fullName()}</strong></span><span class="first-meta-item"><b class="first-meta-label">Categoría:</b><strong class="first-meta-value">${store.profile?.categoria||''}</strong></span></div><table class="profileTable"><tr><th colspan="4">1. FORMACIÓN PROFESIONAL</th></tr>${f.map((lab,i)=>`<tr><td><b>${lab}</b></td><td>${e[`f${i+1}a`]||''}</td><td><b>Institución</b></td><td>${e[`f${i+1}b`]||''}</td></tr>`).join('')}<tr><th colspan="4">2. EXPERIENCIA DOCENTE</th></tr>${[1,2,3,4].map(i=>`<tr><td><b>Institución ${i}</b></td><td colspan="2">${e[`d${i}a`]||''}</td><td><b>Periodo:</b> ${e[`d${i}c`]||''}</td></tr>`).join('')}<tr><th colspan="4">3. EXPERIENCIA LABORAL</th></tr>${[1,2,3,4,5].map(i=>`<tr><td><b>Organización ${i}</b></td><td>${e[`l${i}a`]||''}</td><td><b>Cargo:</b> ${e[`l${i}b`]||''}</td><td><b>Periodo:</b> ${e[`l${i}c`]||''}</td></tr>`).join('')}</table>${signatures()}</div>`
}
function pastelColor(index){
  return ['#dcecf8','#f5e3d2','#dfeee2','#e8e1f2','#f8e7d7','#dceff0','#f2dde3','#e1ecd7'][index % 8]
}
function printProgram(pr, idx){
  const max=Math.max(...pr.semesters.map(s=>s.length));
  const pastel=pastelColor(idx);
  const nSem=Math.max(1,pr.semesters.length),levelW=1.55,areaW=2.05,subjectW=(100/nSem)-levelW-areaW;
  const colgroup=`<colgroup>${Array.from({length:nSem},()=>`<col class="subject" style="width:${subjectW}%"><col class="level" style="width:${levelW}%"><col class="area" style="width:${areaW}%">`).join('')}</colgroup>`;
  const th=pr.semesters.map((s,i)=>`<th colspan="3" style="background:${pastel}">${i+1}.° CUATRIMESTRE</th>`).join('');
  const sub=pr.semesters.map(()=>`<th style="background:${pastel}">Asignatura</th><th class="vhead" style="background:${pastel}">Nivel</th><th class="area-print-head" style="background:${pastel}"><span>Área</span><span>de</span><span>conoc.</span></th>`).join('');
  let rows='';
  for(let r=0;r<max;r++){
    rows+='<tr>'+pr.semesters.map((sem,s)=>{
      const name=sem[r]||'';
      if(!name)return '<td></td><td class="level"></td><td class="area"></td>';
      const a=getAns(pr.id,s,r,name),comp=['X','XX'].includes(a.status)?a.status:'',area=['X','XX'].includes(a.status)?originCode(a):'';
      return `<td class="subject">${subjectCase(name)}</td><td class="level">${comp}</td><td class="area">${area}</td>`
    }).join('')+'</tr>'
  }
  return `<div class="print-program" style="--program-pastel:${pastel}"><div class="print-program-title" style="background:${pastel}">${pr.name.toUpperCase()} · SALIDA LATERAL: ${pr.exit.toUpperCase()}</div><table class="currTable">${colgroup}<tr>${th}</tr><tr>${sub}</tr>${rows}</table></div>`
}
function buildPrint(){
  collectProfile();
  const ps=programs();
  let html=preambleSheet();
  for(let i=0;i<ps.length;i+=3){
    const remaining=Math.min(3,ps.length-i);
    const isLast=(i+3)>=ps.length;
    const sheetClass=`sheet program-trio${isLast&&remaining<3?' compact-last':''}`;
    html+=`<div class="${sheetClass}" data-program-count="${remaining}">${printHeader()}${metaCentered()}${printProgram(ps[i],i)}${ps[i+1]?printProgram(ps[i+1],i+1):''}${ps[i+2]?printProgram(ps[i+2],i+2):''}${signatures()}</div>`
  }
  $('printArea').innerHTML=html
}
async function finalizeCurrentProfile(){
  store.submittedPeriod=cfg.periodo;
  store.finalizedAtMs=Date.now();
  persist();
  if(db&&currentUser){
    try{
      await setDoc(doc(db,'profiles',currentUser.uid),profileCloudPayload(),{merge:true});
      updateCloudStatus('Perfil finalizado y sincronizado','ok');
    }catch(e){
      console.warn('No fue posible confirmar el cierre en la nube',e);
      updateCloudStatus('Cierre guardado local · nube pendiente','warn');
    }
  }
  await writeAudit('Perfil finalizado para impresión/guardado PDF');
  applyEditState();updateNavState();
}
function openProfilePrintDialog(){
  document.body.classList.add('printing-profile');
  const cleanup=()=>document.body.classList.remove('printing-profile');
  window.addEventListener('afterprint',cleanup,{once:true});
  requestAnimationFrame(()=>setTimeout(()=>window.print(),80));
}
window.printProfile=async function(){
  const v=validateAll();
  if(!reviewAvailable()){
    window.go('captura',true);
    showCaptureErrors(v.errors);
    return;
  }

  // Si ya estaba finalizado, únicamente reconstruye e imprime.
  if(submissionLockedForCurrentPeriod() || isAdmin()){
    buildPrint();
    openProfilePrintDialog();
    return;
  }

  if(!v.ok){
    const proceed=window.confirm(
      'El perfil no cumple todavía todas las validaciones. Puede imprimir el estado actual, pero NO se marcará como concluido.\n\n¿Desea continuar con la impresión?'
    );
    if(proceed){
      buildPrint();
      openProfilePrintDialog();
    }
    return;
  }

  const ok=window.confirm(
    'Al continuar, el perfil se marcará como CONCLUIDO y la edición de este profesor se bloqueará automáticamente.\n\nPodrá seguir consultando e imprimiendo su perfil. Si requiere corregir algo, deberá solicitar al JUCA que habilite nuevamente su edición.\n\n¿Desea finalizar e imprimir / guardar PDF?'
  );
  if(!ok){toast('La captura permanece abierta.');return}

  // La hora se registra exactamente al aceptar esta confirmación.
  await finalizeCurrentProfile();

  // El formato se construye DESPUÉS del cierre para que incluya
  // la fecha y hora recién registradas.
  buildPrint();

  toast('Perfil concluido. La edición quedó bloqueada.');
  openProfilePrintDialog();
}


function toLocalDateTimeValue(ts){
  if(!ts)return '';
  const d=new Date(Number(ts)),pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
window.saveDeadline=function(){
  if(!isAdmin())return;
  const v=$('captureDeadlineAdmin').value;
  if(!v){toast('Seleccione fecha y hora.');return}
  const ts=new Date(v).getTime();
  if(!Number.isFinite(ts)){toast('Fecha u hora no válida.');return}
  cfg.captureDeadline=ts;persist();updateCountdownUI();saveGlobalSettings('Fecha límite de captura actualizada');toast('Fecha límite guardada.');
}
window.closeCaptureNow=function(){
  if(!isAdmin())return;
  if(!confirm('¿Cerrar la captura para profesores en este momento?'))return;
  cfg.captureDeadline=Date.now();persist();updateCountdownUI();saveGlobalSettings('Captura cerrada manualmente');toast('Captura cerrada.');
}
window.clearDeadline=function(){
  if(!isAdmin())return;
  cfg.captureDeadline=null;persist();updateCountdownUI();saveGlobalSettings('Fecha límite eliminada');toast('Fecha límite eliminada.');
}

window.saveAdmin=function(){
  const previousPeriod=cfg.periodo;
  cfg.jefe=$('jefe').value.trim()||cfg.jefe;
  cfg.codigo=$('codigo').value.trim()||cfg.codigo;
  cfg.revision=$('revisionCal').value.trim()||cfg.revision;
  cfg.fechaRevision=$('fechaRevision').value.trim()||cfg.fechaRevision;
  cfg.periodo=$('periodoAdmin').value.trim()||cfg.periodo;
  // El periodo es solo metadato de vigencia: nunca limpia profile, answers ni programMeta.
  updatePeriodBadges();persist();
  saveGlobalSettings(previousPeriod===cfg.periodo?'Configuración institucional actualizada':`Periodo actualizado de ${previousPeriod} a ${cfg.periodo} sin borrar perfiles`);
  toast(previousPeriod===cfg.periodo?'Configuración guardada.':'Periodo actualizado. Los datos capturados se conservaron.');
}

function timestampToMs(value){
  if(!value)return 0;
  if(typeof value==='number')return value;
  if(value instanceof Date)return value.getTime();
  if(typeof value.toDate==='function')return value.toDate().getTime();
  if(Number.isFinite(value.seconds))return Number(value.seconds)*1000 + Math.floor((Number(value.nanoseconds)||0)/1e6);
  return 0;
}
function formatTeacherUpdatedAt(value){
  const ms=timestampToMs(value);
  if(!ms)return 'Sin fecha registrada';
  return new Intl.DateTimeFormat('es-MX',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date(ms));
}
function formatTeacherCompletion(d){
  if(d.submittedPeriod!==cfg.periodo)return 'Sin concluir';
  const ms=Number(d.finalizedAtMs)||0;
  if(!ms)return 'Fecha y hora de conclusión no registradas';
  return new Intl.DateTimeFormat('es-MX',{
    weekday:'short',
    day:'2-digit',
    month:'short',
    year:'numeric',
    hour:'2-digit',
    minute:'2-digit',
    hour12:true
  }).format(new Date(ms));
}
async function renderTeacherAdminList(){
  const root=$('teacherAdminList'),summary=$('teacherAdminSummary');
  if(!root||!summary||!isAdmin())return;
  if(!db){root.innerHTML='<div class="teacher-empty">Firestore no está disponible en esta sesión.</div>';summary.textContent='Sin conexión';return}
  root.innerHTML='<div class="teacher-empty">Cargando profesores…</div>';
  try{
    const snap=await getDocs(collection(db,'profiles'));
    const rows=[];
    teacherAdminCache={};
    snap.forEach(ds=>{
      const d=ds.data()||{},p=d.profile||{};
      const name=[p.apPat,p.apMat,p.nombres].filter(Boolean).join(' ')||d.displayName||d.email||'(Sin nombre)';
      const row={uid:ds.id,name,email:d.email||'',categoria:p.categoria||'',submittedPeriod:d.submittedPeriod||null,finalizedAtMs:Number(d.finalizedAtMs)||0,individualEditEnabled:!!d.individualEditEnabled,updatedAt:d.updatedAt,profileResetToken:d.profileResetToken||null};
      rows.push(row);teacherAdminCache[row.uid]=row;
    });
    rows.sort((a,b)=>a.name.localeCompare(b.name,'es',{sensitivity:'base'}));
    const done=rows.filter(x=>x.submittedPeriod===cfg.periodo).length;
    summary.innerHTML=`<b>${rows.length}</b> profesor${rows.length===1?'':'es'} con información · <b>${done}</b> concluido${done===1?'':'s'} en ${cfg.periodo}`;
    if(!rows.length){root.innerHTML='<div class="teacher-empty">Aún no hay perfiles de profesores guardados.</div>';return}
    root.innerHTML=rows.map(r=>{
      const doneNow=r.submittedPeriod===cfg.periodo;
      const override=!!r.individualEditEnabled;
      const statusTitle=override?'Edición individual habilitada':(doneNow?'Concluido':'En captura / sin concluir');
      const lastCompletion=doneNow?formatTeacherCompletion(r):'';
      const lastEdit=formatTeacherUpdatedAt(r.updatedAt);
      const statusText=override
        ?(doneNow
          ?`Última edición: ${lastEdit} · Última finalización: ${lastCompletion} · Edición individual habilitada`
          :`Última edición: ${lastEdit} · Edición individual habilitada`)
        :(doneNow
          ?`Última edición: ${lastEdit} · Finalizó y envió: ${lastCompletion}`
          :`Última edición: ${lastEdit}`);
      return `<div class="teacher-admin-row ${override?'individual-open':doneNow?'finished':'open'}">
        <div class="teacher-admin-main">
          <b>${escapeHtml(r.name)}</b>
          <span>${escapeHtml(r.email||'Sin correo registrado')}${r.categoria?` · ${escapeHtml(r.categoria)}`:''}</span>
        </div>
        <div class="teacher-admin-status ${override?'individual-open':doneNow?'finished':'open'}">
          <strong>${escapeHtml(statusTitle)}</strong>
          <span>${escapeHtml(statusText)}</span>
        </div>
        <div class="teacher-admin-actions">
          ${doneNow||override?`<button class="teacher-reopen-btn ${override?'active':''}" onclick="toggleTeacherEditOverride('${r.uid}',${override?'false':'true'})">${override?'Deshabilitar edición':'Habilitar edición'}</button>`:''}
          <button class="teacher-reset-program-btn" onclick="resetTeacherProgramProfile('${r.uid}')">Eliminar asignaturas capturadas</button>
          <button class="teacher-delete-btn" onclick="deleteTeacherProfile('${r.uid}')">Eliminar perfil completo</button>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    console.warn('No fue posible cargar profesores para Administración',e);
    root.innerHTML='<div class="teacher-empty">No fue posible cargar la lista de profesores. Revise las reglas de Firestore.</div>';
    summary.textContent='Lista no disponible';
  }
}
function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}
window.toggleTeacherEditOverride=async function(uid,enable){
  if(!isAdmin()||!db)return;
  const r=teacherAdminCache[uid]||{};
  const who=r.name||r.email||'este profesor';
  const question=enable
    ?`¿Habilitar la edición únicamente para ${who}?\n\nEste permiso individual funcionará incluso si la edición general está desactivada.`
    :`¿Deshabilitar nuevamente la edición de ${who}?\n\nEl perfil volverá a respetar su cierre por finalización y los controles generales.`;
  if(!confirm(question))return;
  try{
    await setDoc(doc(db,'profiles',uid),{
      individualEditEnabled:!!enable,
      reopenedAt:enable?serverTimestamp():null,
      reopenedBy:enable?(currentUser.email||''):null,
      individualEditUpdatedAt:serverTimestamp()
    },{merge:true});
    await writeAudit(`${enable?'Edición individual habilitada':'Edición individual deshabilitada'} para ${r.email||uid}`);
    toast(enable?'Edición habilitada únicamente para ese profesor.':'Edición individual deshabilitada.');
    await renderTeacherAdminList();
  }catch(e){
    console.error('Error de edición individual',e);
    alert(`No fue posible ${enable?'habilitar':'deshabilitar'} la edición individual.\n\nCódigo: ${e?.code||'sin código'}\n\nVerifique que firestore.rules V21 esté publicado.`);
  }
}
window.reopenTeacherProfile=function(uid){return window.toggleTeacherEditOverride(uid,true)}
window.resetTeacherProgramProfile=async function(uid){
  if(!isAdmin()||!db)return;
  const r=teacherAdminCache[uid]||{};
  const who=r.name||r.email||'este profesor';

  const ok=confirm(
    `¿CONFIRMAR eliminación de las asignaturas capturadas de ${who}?\n\n`+
    `Se borrarán respuestas por asignatura, niveles X/XX, áreas de conocimiento, coordinaciones, favoritas y el estado de finalización.\n\n`+
    `Se conservarán los datos del profesor, pero la edición quedará habilitada para corregirlos y comenzar desde cero el Perfil por programa.\n\n`+
    `Esta acción no se puede deshacer desde esta pantalla.`
  );
  if(!ok)return;

  try{
    const resetToken=`${Date.now()}-${uid}`;
    await setDoc(doc(db,'profiles',uid),{
      answers:{},
      programMeta:{},
      submittedPeriod:null,
      finalizedAtMs:null,
      individualEditEnabled:true,
      profileResetToken:resetToken,
      programProfileResetAt:serverTimestamp(),
      programProfileResetBy:currentUser?.email||'',
      updatedAt:serverTimestamp()
    },{merge:true});
    await writeAudit(`Asignaturas capturadas eliminadas por Administración: ${r.email||uid}`);
    toast('Asignaturas eliminadas. El profesor iniciará nuevamente el Perfil por programa.');
    await renderTeacherAdminList();
  }catch(e){
    console.error(e);
    alert('No fue posible eliminar las asignaturas capturadas. Verifique la conexión y las reglas de Firestore.');
  }
}

window.deleteTeacherProfile=async function(uid){
  if(!isAdmin()||!db)return;
  const r=teacherAdminCache[uid]||{};
  const who=r.name||r.email||'este profesor';

  const ok=confirm(
    `¿CONFIRMAR eliminación COMPLETA del perfil de ${who}?\n\n`+
    `Se eliminarán datos del profesor, formación, experiencia, respuestas por asignatura, niveles, áreas, coordinaciones, favoritas y el estado de finalización.\n\n`+
    `En su próximo ingreso comenzará desde cero. Esta acción NO elimina su cuenta institucional.\n\n`+
    `Esta acción no se puede deshacer desde esta pantalla.`
  );
  if(!ok)return;

  try{
    await deleteDoc(doc(db,'profiles',uid));
    await writeAudit(`Perfil completo eliminado por Administración: ${r.email||uid}`);
    toast('Perfil completo eliminado. En su próximo ingreso el profesor comenzará desde cero.');
    await renderTeacherAdminList();
  }catch(e){
    console.error(e);
    alert('No fue posible eliminar el perfil completo. Verifique las reglas de Firestore.');
  }
}

function renderAdmin(){
  $('jefe').value=cfg.jefe;$('codigo').value=cfg.codigo;$('revisionCal').value=cfg.revision;$('fechaRevision').value=cfg.fechaRevision;$('periodoAdmin').value=cfg.periodo;
  if($('captureDeadlineAdmin'))$('captureDeadlineAdmin').value=toLocalDateTimeValue(cfg.captureDeadline);updateCountdownUI();
  const st=$('editModeStatus'),btn=$('editModeBtn');
  if(st){st.textContent=cfg.editingLocked?'Edición desactivada':'Edición activa';st.className='edit-mode-status '+(cfg.editingLocked?'locked':'open')}
  if(btn){btn.textContent=cfg.editingLocked?'Activar edición de perfiles':'Desactivar edición de perfiles';btn.className='edit-mode-btn '+(cfg.editingLocked?'activate':'deactivate')}
  if(!editingProgramId && !$('newProgramSemesters')?.children?.length)renderSemesterEditors();
  renderProgramAdminList();renderCustomPrograms();renderRules();applyEditState();renderTeacherAdminList()
}
function normalizeEditorSemesterValues(values){
  if(!Array.isArray(values))return [];
  return values.map(sem=>{
    if(Array.isArray(sem)){
      return sem.map(item=>({
        name:String(item?.name||''),
        hours:item?.hours!==undefined&&item?.hours!==null?String(item.hours):''
      }));
    }
    if(typeof sem==='string'){
      return sem.split(/\n+/).map(parseCustomSubjectLine).filter(x=>x.name).map(x=>({name:x.name,hours:x.hours?String(x.hours):''}));
    }
    return [];
  });
}
function ensureProgramEditorSemesters(){
  while(programEditorSemesters.length<newSemesterCount)programEditorSemesters.push([{name:'',hours:''}]);
  if(programEditorSemesters.length>newSemesterCount)programEditorSemesters.length=newSemesterCount;
  programEditorSemesters=programEditorSemesters.map(sem=>Array.isArray(sem)&&sem.length?sem:[{name:'',hours:''}]);
}
function renderSemesterEditors(values=null){
  if(values!==null)programEditorSemesters=normalizeEditorSemesterValues(values);
  ensureProgramEditorSemesters();

  $('newProgramSemesters').innerHTML=programEditorSemesters.map((sem,s)=>`
    <section class="semester-subject-editor" data-semester="${s}">
      <div class="semester-editor-head">
        <div>
          <b>${s+1}.° cuatrimestre</b>
          <span>${sem.filter(x=>String(x.name||'').trim()).length} materia${sem.filter(x=>String(x.name||'').trim()).length===1?'':'s'}</span>
        </div>
        ${newSemesterCount>1?`<button type="button" class="semester-delete-btn" onclick="removeSemesterEditor(${s})">Borrar cuatrimestre</button>`:''}
      </div>

      <div class="subject-editor-labels">
        <span>Materia</span><span>Horas</span><span>Acciones</span>
      </div>

      <div class="subject-editor-list">
        ${sem.map((item,c)=>`
          <div class="subject-editor-row" data-subject-row="${s}-${c}">
            <input
              id="subjectName_${s}_${c}"
              class="subject-name-field"
              value="${escapeHtml(item.name||'')}"
              placeholder="Ej. Cálculo diferencial"
              oninput="updateProgramSubject(${s},${c},'name',this.value)">
            <input
              id="subjectHours_${s}_${c}"
              class="subject-hours-field"
              type="number"
              min="1"
              step="1"
              value="${escapeHtml(item.hours||'')}"
              placeholder="Ej. 90"
              oninput="updateProgramSubject(${s},${c},'hours',this.value)">
            <div class="subject-row-actions">
              <button type="button" class="subject-edit-btn" onclick="editProgramSubject(${s},${c})">Editar</button>
              <button type="button" class="subject-remove-btn" onclick="removeProgramSubject(${s},${c})">Eliminar</button>
            </div>
          </div>`).join('')}
      </div>

      <button type="button" class="add-subject-btn" onclick="addProgramSubject(${s})">＋ Agregar materia</button>
    </section>`).join('');
}
window.updateProgramSubject=function(s,c,field,value){
  ensureProgramEditorSemesters();
  if(!programEditorSemesters[s]?.[c])return;
  programEditorSemesters[s][c][field]=value;
}
window.addProgramSubject=function(s){
  ensureProgramEditorSemesters();
  programEditorSemesters[s].push({name:'',hours:''});
  const c=programEditorSemesters[s].length-1;
  renderSemesterEditors();
  setTimeout(()=>document.getElementById(`subjectName_${s}_${c}`)?.focus(),0);
}
window.removeProgramSubject=function(s,c){
  ensureProgramEditorSemesters();
  const row=programEditorSemesters[s]?.[c];
  if(!row)return;
  const hasData=String(row.name||'').trim()||String(row.hours||'').trim();
  if(hasData&&!confirm('¿Eliminar esta materia del cuatrimestre?'))return;
  programEditorSemesters[s].splice(c,1);
  if(!programEditorSemesters[s].length)programEditorSemesters[s].push({name:'',hours:''});
  renderSemesterEditors();
}
window.editProgramSubject=function(s,c){
  const el=document.getElementById(`subjectName_${s}_${c}`);
  if(el){
    el.focus();
    el.select();
  }
}
window.addSemesterEditor=function(){
  ensureProgramEditorSemesters();
  programEditorSemesters.push([{name:'',hours:''}]);
  newSemesterCount=programEditorSemesters.length;
  renderSemesterEditors();
  setTimeout(()=>document.getElementById(`subjectName_${newSemesterCount-1}_0`)?.focus(),0);
}
window.removeSemesterEditor=function(i){
  ensureProgramEditorSemesters();
  const sem=programEditorSemesters[i]||[];
  if(sem.some(x=>String(x.name||'').trim())&&!confirm(`¿Borrar el ${i+1}.° cuatrimestre y todas sus materias?`))return;
  programEditorSemesters.splice(i,1);
  newSemesterCount=Math.max(1,programEditorSemesters.length);
  if(!programEditorSemesters.length)programEditorSemesters=[[{name:'',hours:''}]];
  renderSemesterEditors();
}
function slug(s){return 'custom_'+s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_')+'_'+Date.now()}
function parseCustomSubjectLine(line){
  const clean=String(line||'').trim();
  const m=clean.match(/^(.*?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*(?:h|hrs?|horas?)?\s*$/i);
  if(!m)return {name:clean,hours:0};
  return {name:m[1].trim(),hours:Number(m[2].replace(',','.'))||0};
}
function formatProgramSemester(pr,s){
  const sem=pr.semesters?.[s]||[],hrs=pr.hours?.[s]||[];
  return sem.map((name,c)=>({
    name:subjectCase(name),
    hours:Number(hrs[c])||subjectHours(pr.id,s,c)||''
  }));
}
function resetProgramEditor(){
  editingProgramId=null;
  newSemesterCount=5;
  programEditorSemesters=Array.from({length:newSemesterCount},()=>[{name:'',hours:''}]);
  $('newProgramName').value='';
  $('newProgramExit').value='';
  $('programEditorTitle').textContent='Agregar programa educativo';
  $('programEditorHelp').textContent='Capture nombre y salida lateral. Agregue cada materia y sus horas dentro del cuatrimestre correspondiente.';
  $('programEditorMode').textContent='Nuevo';
  $('cancelProgramEditBtn').classList.add('hidden');
  $('saveProgramEditorBtn').textContent='Guardar nuevo programa educativo';
  renderSemesterEditors();
}
window.cancelProgramEdit=function(){
  resetProgramEditor();
  toast('Edición cancelada.');
}
function clearChangedCourseAnswers(pid,oldProgram,newProgram){
  const maxS=Math.max(oldProgram?.semesters?.length||0,newProgram?.semesters?.length||0);
  for(let s=0;s<maxS;s++){
    const oldSem=oldProgram?.semesters?.[s]||[];
    const newSem=newProgram?.semesters?.[s]||[];
    const maxC=Math.max(oldSem.length,newSem.length);
    for(let c=0;c<maxC;c++){
      const oldName=normalizeSubjectName(oldSem[c]||'');
      const newName=normalizeSubjectName(newSem[c]||'');
      if(oldName!==newName){
        delete answers[key(pid,s,c)];
        const meta=programMeta[pid];
        if(meta?.coordinators)meta.coordinators=meta.coordinators.filter(x=>x!==`${s}|${c}`);
      }
    }
  }
}
window.openProgramEditor=function(id){
  if(!isAdmin())return;
  const pr=allPrograms().find(p=>p.id===id);
  if(!pr)return;
  editingProgramId=id;
  $('newProgramName').value=pr.name||'';
  $('newProgramExit').value=pr.exit||'';
  newSemesterCount=Math.max(1,pr.semesters?.length||5);
  programEditorSemesters=Array.from({length:newSemesterCount},(_,s)=>formatProgramSemester(pr,s));
  renderSemesterEditors(programEditorSemesters);
  $('programEditorTitle').textContent='Editar programa educativo';
  $('programEditorHelp').textContent='Edite cada materia y sus horas directamente dentro de su cuatrimestre. También puede agregar o eliminar materias de forma independiente.';
  $('programEditorMode').textContent='Edición';
  $('cancelProgramEditBtn').classList.remove('hidden');
  $('saveProgramEditorBtn').textContent='Guardar cambios';
  $('programEditorCard').scrollIntoView({behavior:'smooth',block:'start'});
}
window.saveProgramEditor=function(){
  const name=$('newProgramName').value.trim(),exit=$('newProgramExit').value.trim();
  ensureProgramEditorSemesters();
  const parsed=programEditorSemesters.map(rows=>rows
    .map(x=>({name:String(x.name||'').trim(),hours:Number(x.hours)||0}))
    .filter(x=>x.name||x.hours));
  const semesters=parsed.map(rows=>rows.map(x=>x.name));
  const hours=parsed.map(rows=>rows.map(x=>x.hours));

  if(!name||!exit){toast('Complete el nombre del programa y la salida lateral.');return}
  if(parsed.some(rows=>!rows.length)){toast('Cada cuatrimestre debe contener al menos una materia.');return}
  if(parsed.some(rows=>rows.some(x=>!x.name||!x.hours))){
    toast('Revise cada materia: debe tener nombre y horas.');
    return;
  }

  if(editingProgramId){
    const oldProgram=allPrograms().find(p=>p.id===editingProgramId);
    const next={id:editingProgramId,name,exit,common:oldProgram?.common??null,semesters,hours};
    clearChangedCourseAnswers(editingProgramId,oldProgram,next);
    const customIndex=customPrograms.findIndex(p=>p.id===editingProgramId);
    if(customIndex>=0){
      customPrograms[customIndex]={...customPrograms[customIndex],name,exit,semesters,hours};
    }else{
      programOverrides[editingProgramId]={name,exit,semesters,hours};
    }
    persist();
    saveGlobalSettings('Programa educativo actualizado');
    renderAdmin();renderCurrentProgram();updateProgress();lockRevisionNav();
    toast('Programa educativo actualizado.');
    resetProgramEditor();
    return;
  }

  const id=slug(name);
  customPrograms.push({id,name,exit,common:null,semesters,hours});
  persist();
  saveGlobalSettings('Programa educativo agregado');
  renderAdmin();renderCurrentProgram();
  toast('Programa educativo agregado.');
  resetProgramEditor();
}
window.saveNewProgram=window.saveProgramEditor;


window.setProgramAcronym=function(id,value){
  if(!isAdmin())return;
  const clean=String(value||'').trim().toUpperCase();
  if(!clean){toast('El acrónimo no puede quedar vacío.');renderProgramAdminList();return}
  programAcronyms[id]=clean;persist();saveGlobalSettings('Acrónimo de programa actualizado');renderProgramAdminList();toast('Acrónimo actualizado.');
}


window.openCommonRuleEditor=function(pid){
  if(!isAdmin())return;
  const existing=commonRuleForProgram(pid);
  editingCommonRuleId=existing?.id||null;
  const base=existing?JSON.parse(JSON.stringify(existing)):{
    id:'TC_'+Date.now(),
    name:'Nuevo tronco común',
    programIds:[pid],
    semesters:[0,1,2]
  };
  const maxSem=Math.max(...allPrograms().map(p=>p.semesters.length),5);
  const root=$('commonRuleEditor');
  root.classList.remove('hidden');
  root.innerHTML=`<div class="common-editor-head">
      <div><b>Configurar tronco común</b><span>Seleccione qué programas comparten materias y en qué cuatrimestres.</span></div>
      <button onclick="closeCommonRuleEditor()">Cerrar</button>
    </div>
    <label class="common-rule-name">Nombre del tronco<input id="commonRuleName" value="${base.name.replace(/"/g,'&quot;')}"></label>
    <div class="common-editor-block"><b>Programas que lo comparten</b>
      <div class="common-program-checks">${allPrograms().map(p=>`<label><input type="checkbox" data-common-program="${p.id}" ${base.programIds.includes(p.id)?'checked':''}>${programAcronym(p)} · ${p.exit}</label>`).join('')}</div>
    </div>
    <div class="common-editor-block"><b>Cuatrimestres sincronizados</b>
      <div class="common-semester-checks">${Array.from({length:maxSem},(_,i)=>`<label><input type="checkbox" data-common-sem="${i}" ${base.semesters.includes(i)?'checked':''}>${i+1}.°</label>`).join('')}</div>
    </div>
    <div class="common-editor-warning">La sincronización se realiza por <b>nombre de asignatura</b>. Solo se copiará la respuesta entre materias con el mismo nombre en el mismo cuatrimestre.</div>
    <div class="admin-actions compact-actions">
      <button class="primary" onclick="saveCommonRule('${base.id}')">Guardar tronco común</button>
      ${existing?`<button class="danger-soft" onclick="deleteCommonRule('${existing.id}')">Quitar este tronco común</button>`:''}
    </div>`;
  root.scrollIntoView({behavior:'smooth',block:'center'});
}
window.closeCommonRuleEditor=function(){
  editingCommonRuleId=null;
  const root=$('commonRuleEditor');if(root){root.classList.add('hidden');root.innerHTML=''}
}
window.saveCommonRule=function(id){
  if(!isAdmin())return;
  const name=($('commonRuleName')?.value||'Tronco común').trim()||'Tronco común';
  const programIds=[...document.querySelectorAll('[data-common-program]:checked')].map(x=>x.dataset.commonProgram);
  const semesters=[...document.querySelectorAll('[data-common-sem]:checked')].map(x=>Number(x.dataset.commonSem)).sort((a,b)=>a-b);
  if(programIds.length<2){toast('Seleccione al menos dos programas educativos.');return}
  if(!semesters.length){toast('Seleccione al menos un cuatrimestre.');return}
  // Un programa solo puede pertenecer a un tronco común a la vez.
  commonRules=commonRules
    .filter(r=>r.id!==editingCommonRuleId&&r.id!==id)
    .map(r=>({...r,programIds:(r.programIds||[]).filter(pid=>!programIds.includes(pid))}))
    .filter(r=>(r.programIds||[]).length>=2);
  commonRules.push({id,name,programIds,semesters});
  persist();saveGlobalSettings('Tronco común actualizado');
  renderAdmin();renderCurrentProgram();updateProgress();lockRevisionNav();
  closeCommonRuleEditor();toast('Tronco común guardado.');
}
window.deleteCommonRule=function(id){
  if(!isAdmin())return;
  if(!confirm('¿Quitar esta configuración de tronco común? Los datos ya capturados no se eliminarán.'))return;
  commonRules=commonRules.filter(r=>r.id!==id);
  persist();saveGlobalSettings('Tronco común eliminado');
  renderAdmin();renderCurrentProgram();updateProgress();lockRevisionNav();
  closeCommonRuleEditor();toast('Tronco común eliminado.');
}

window.toggleProgramEnabled=function(id){
  if(!isAdmin()){toast('Solo el administrador puede cambiar programas.');return}
  if(disabledPrograms.includes(id))disabledPrograms=disabledPrograms.filter(x=>x!==id);
  else disabledPrograms=[...new Set([...disabledPrograms,id])];
  if(!programs().length){
    disabledPrograms=disabledPrograms.filter(x=>x!==id);
    toast('Debe permanecer al menos un programa educativo activo.');
    return;
  }
  currentProgramIndex=Math.min(currentProgramIndex,programs().length-1);
  persist();saveGlobalSettings(disabledPrograms.includes(id)?'Programa deshabilitado':'Programa habilitado');renderAdmin();renderCurrentProgram();updateProgress();lockRevisionNav();
  toast(disabledPrograms.includes(id)?'Programa deshabilitado.':'Programa habilitado.');
}
function renderProgramAdminList(){
  const root=$('programAdminList'); if(!root)return;
  root.innerHTML=allPrograms().map(p=>{
    const enabled=!disabledPrograms.includes(p.id);
    const custom=p.id.startsWith('custom_');
    const rule=commonRuleForProgram(p.id);
    return `<div class="program-admin-item ${enabled?'':'disabled'}">
      <div class="program-admin-name"><b>${p.name}</b><small>${p.exit}${custom?' · Programa agregado':''}${rule?` · <strong>Tronco común</strong>`:''}</small></div>
      <label class="acronym-edit acronym-only"><input aria-label="Acrónimo del programa" value="${programAcronym(p)}" maxlength="18" onchange="setProgramAcronym('${p.id}',this.value)"></label>
      <button class="edit-program-btn program-action-btn" onclick="openProgramEditor('${p.id}')"><span class="admin-icon edit-icon">✎</span>Editar</button>
      <button class="common-program-btn program-action-btn ${rule?'active':''}" onclick="openCommonRuleEditor('${p.id}')"><span class="admin-icon common-icon">↔</span>${rule?'Tronco común':'Configurar tronco'}</button>
      <button class="program-action-btn ${enabled?'disable-program':'enable-program'}" onclick="toggleProgramEnabled('${p.id}')"><span class="admin-icon state-icon">${enabled?'−':'+'}</span>${enabled?'Deshabilitar':'Habilitar'}</button>
    </div>`
  }).join('');
}

window.deleteCustomProgram=function(id){if(!confirm('¿Eliminar este programa?'))return;customPrograms=customPrograms.filter(p=>p.id!==id);disabledPrograms=disabledPrograms.filter(x=>x!==id);currentProgramIndex=Math.min(currentProgramIndex,Math.max(0,programs().length-1));persist();saveGlobalSettings('Programa educativo eliminado');renderAdmin();renderCurrentProgram()}
function renderCustomPrograms(){
  $('customProgramsList').innerHTML=customPrograms.length?`<h3 style="margin-top:16px">Programas agregados</h3>`+customPrograms.map(p=>`<div class="custom-program-item"><div><b>${p.name}</b><br>${p.exit}<br><small>${p.semesters.reduce((n,s)=>n+s.length,0)} materias · horas configuradas</small></div><div class="custom-program-actions"><button onclick="openProgramEditor('${p.id}')">Editar</button><button onclick="deleteCustomProgram('${p.id}')">Eliminar</button></div></div>`).join(''):''
}

function renderRules(){
  const root=$('commonRules');if(!root)return;
  root.innerHTML=commonRules.length?commonRules.map(r=>{
    const programsText=(r.programIds||[]).map(id=>{
      const p=allPrograms().find(x=>x.id===id);
      return p?programAcronym(p):id;
    }).join(' · ');
    const sems=(r.semesters||[]).map(x=>`${x+1}.°`).join(', ');
    return `<div class="common-rule-summary"><b>${r.name}</b><span>${programsText}</span><span>Cuatrimestres: ${sems}</span></div>`;
  }).join(''):'<div class="coord-empty">No hay troncos comunes configurados.</div>';
}

async function exportWorkbook(){
  const XLSX=window.XLSX;
  if(!XLSX || !XLSX.utils){
    throw new Error('No fue posible cargar el módulo de Excel con estilos.');
  }

  collectProfile();
  const p=store.profile||{};
  const ps=programs();

  const teachers=await loadTeachersForExport();

  // --- Hoja 1: concentrado horizontal similar al archivo operativo ---
  const headerRows=6;
  const aoa=Array.from({length:headerRows+teachers.length},()=>[]);
  aoa[0][0]='PROGRAMA EDUCATIVO';
  aoa[0][1]='Leyenda: ★ = Favorito · rojo y negrita = Coordinó la asignatura';
  aoa[1][0]='ASIGNATURA';
  aoa[2][0]='HORAS AL CUATRIMESTRE';
  aoa[3][0]='HORAS A LA SEMANA';
  aoa[4][0]='CUATRIMESTRE';
  aoa[5][0]='PROFESOR';
  aoa[5][1]='CATEGORÍA';

  let col=2;
  const merges=[];
  const programRanges=[];
  ps.forEach((pr,pi)=>{
    const startCol=col;
    pr.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
      aoa[1][col]=subjectCase(name);
      aoa[2][col]=subjectHours(pr.id,s,c)||'';
      aoa[3][col]=weeklyHours(pr.id,s,c)||'';
      aoa[4][col]=s+1;
      teachers.forEach((t,ti)=>{
        const a=teacherAnswer(t,pr.id,s,c,name);
        const level=['X','XX'].includes(a.status)?a.status:'';
        const fav=!!a.ideal;
        const coord=teacherCoordinator(t,pr.id,s,c);
        aoa[headerRows+ti][0]=t.name;
        aoa[headerRows+ti][1]=t.category;
        aoa[headerRows+ti][col]=level?`${level}${fav?' ★':''}`:'';
      });
      col++;
    }));
    const endCol=col-1;
    if(endCol>=startCol){
      merges.push({s:{r:0,c:startCol},e:{r:0,c:endCol}});
      aoa[0][startCol]=`${pr.name} (${programAcronym(pr)})`;
      programRanges.push({start:startCol,end:endCol,index:pi});
    }
  });

  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges']=merges;
  ws['!freeze']={xSplit:2,ySplit:6,topLeftCell:'C7',activePane:'bottomRight',state:'frozen'};
  ws['!autofilter']={ref:`A6:${XLSX.utils.encode_col(col-1)}${aoa.length}`};
  ws['!cols']=[{wch:30},{wch:32},...Array.from({length:col-2},()=>({wch:13}))];
  ws['!rows']=[
    {hpt:25},{hpt:86},{hpt:24},{hpt:24},{hpt:22},{hpt:28},
    ...teachers.map(()=>({hpt:24}))
  ];

  const pastel=['DDEBF7','FCE4D6','E2F0D9','E4DFEC','FFF2CC','DDEBF7','F4CCCC','E2EFDA'];

  function styleCell(addr,style){
    if(!ws[addr])ws[addr]={t:'s',v:''};
    ws[addr].s=style;
  }

  // Columnas Profesor y Categoría
  for(let r=0;r<aoa.length;r++){
    [0,1].forEach(c=>styleCell(XLSX.utils.encode_cell({r,c}),{
      font:{bold:r<6,color:{rgb:'183B59'}},
      fill:{fgColor:{rgb:r<6?'EAF2F8':'FFFFFF'}},
      alignment:{vertical:'center',horizontal:r<6?'center':'left',wrapText:true},
      border:{top:{style:'thin',color:{rgb:'AAB7C4'}},bottom:{style:'thin',color:{rgb:'AAB7C4'}},left:{style:'thin',color:{rgb:'AAB7C4'}},right:{style:'thin',color:{rgb:'AAB7C4'}}}
    }));
  }

  // Programas y materias
  programRanges.forEach(range=>{
    const fill=pastel[range.index%pastel.length];
    for(let c=range.start;c<=range.end;c++){
      // Encabezado de programa
      styleCell(XLSX.utils.encode_cell({r:0,c}),{
        font:{bold:true,color:{rgb:'173B57'}},
        fill:{fgColor:{rgb:fill}},
        alignment:{horizontal:'center',vertical:'center',wrapText:true},
        border:{top:{style:'thin',color:{rgb:'7F8C8D'}},bottom:{style:'thin',color:{rgb:'7F8C8D'}},left:{style:'thin',color:{rgb:'7F8C8D'}},right:{style:'thin',color:{rgb:'7F8C8D'}}}
      });
      // Asignatura vertical
      styleCell(XLSX.utils.encode_cell({r:1,c}),{
        font:{bold:false,color:{rgb:'243746'}},
        fill:{fgColor:{rgb:fill}},
        alignment:{textRotation:90,horizontal:'center',vertical:'center',wrapText:true},
        border:{top:{style:'thin',color:{rgb:'AAB7C4'}},bottom:{style:'thin',color:{rgb:'AAB7C4'}},left:{style:'thin',color:{rgb:'AAB7C4'}},right:{style:'thin',color:{rgb:'AAB7C4'}}}
      });
      for(let r=2;r<6;r++){
        styleCell(XLSX.utils.encode_cell({r,c}),{
          fill:{fgColor:{rgb:fill}},
          alignment:{horizontal:'center',vertical:'center',wrapText:true},
          border:{top:{style:'thin',color:{rgb:'AAB7C4'}},bottom:{style:'thin',color:{rgb:'AAB7C4'}},left:{style:'thin',color:{rgb:'AAB7C4'}},right:{style:'thin',color:{rgb:'AAB7C4'}}}
        });
      }
      for(let r=6;r<aoa.length;r++){
        styleCell(XLSX.utils.encode_cell({r,c}),{
          font:{bold:false},
          alignment:{horizontal:'center',vertical:'center'},
          border:{top:{style:'thin',color:{rgb:'D4DCE3'}},bottom:{style:'thin',color:{rgb:'D4DCE3'}},left:{style:'thin',color:{rgb:'D4DCE3'}},right:{style:'thin',color:{rgb:'D4DCE3'}}}
        });
      }
    }
  });


  // Marcas administrativas del concentrado:
  // ★ = Favorito; FUENTE ROJA EN NEGRITA = Coordinó la asignatura.
  // No se utilizan fondos especiales.
  for(let r=headerRows;r<aoa.length;r++){
    const t=teachers[r-headerRows];
    let matrixCol=2;
    ps.forEach(pr=>pr.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
      const addr=XLSX.utils.encode_cell({r,c:matrixCol});
      const cell=ws[addr];
      const value=String(cell?.v ?? aoa[r]?.[matrixCol] ?? '');
      const coordinated=teacherCoordinator(t,pr.id,s,c);
      const favorite=value.includes('★');
      if(cell && value){
        cell.s={
          font:{
            name:'Aptos',
            sz:10,
            bold:favorite || coordinated,
            color:{rgb:coordinated?'FF0000':'243746'}
          },
          fill:{patternType:'solid',fgColor:{rgb:'FFFFFF'},bgColor:{rgb:'FFFFFF'}},
          alignment:{horizontal:'center',vertical:'center'},
          border:{
            top:{style:'thin',color:{rgb:'D4DCE3'}},
            bottom:{style:'thin',color:{rgb:'D4DCE3'}},
            left:{style:'thin',color:{rgb:'D4DCE3'}},
            right:{style:'thin',color:{rgb:'D4DCE3'}}
          }
        };
      }
      matrixCol++;
    })));
  }

  // --- Hoja 2: Base maestra cruda (se conserva por compatibilidad) ---
  const base=[];
  teachers.forEach(t=>ps.forEach(pr=>pr.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    const a=teacherAnswer(t,pr.id,s,c,name);
    base.push({
      Profesor:t.name,
      Categoria:t.category||'',
      Correo:t.email||'',
      Periodo:cfg.periodo,
      Programa:pr.name,
      'Acrónimo PE':programAcronym(pr),
      'Salida lateral':pr.exit,
      Cuatrimestre:s+1,
      Asignatura:subjectCase(name),
      'Horas al cuatrimestre':subjectHours(pr.id,s,c)||'',
      'Horas a la semana':weeklyHours(pr.id,s,c)||'',
      'Estado interno':a.status,
      'Nivel competencia':['X','XX'].includes(a.status)?a.status:'',
      'Área conocimiento':(a.origins||[]).sort().join(''),
      'Materia favorita':a.ideal?'Sí':'',
      'Coordinador de academia':teacherCoordinator(t,pr.id,s,c)?'Sí':''
    });
  }))));

  const wsBase=XLSX.utils.json_to_sheet(base);
  wsBase['!autofilter']={ref:wsBase['!ref']};
  wsBase['!freeze']={xSplit:2,ySplit:1,topLeftCell:'C2',activePane:'bottomRight',state:'frozen'};
  // Resalta en rojo y negrita el dato de coordinación también en Base maestra.
  if(base.length){
    const coordHeader='Coordinador de academia';
    const headers=Object.keys(base[0]);
    const coordCol=headers.indexOf(coordHeader);
    if(coordCol>=0){
      for(let r=1;r<=base.length;r++){
        const addr=XLSX.utils.encode_cell({r,c:coordCol});
        if(wsBase[addr] && String(wsBase[addr].v||'').toLowerCase()==='sí'){
          wsBase[addr].s={
            font:{name:'Aptos',sz:10,bold:true,color:{rgb:'FF0000'}},
            fill:{patternType:'solid',fgColor:{rgb:'FFFFFF'}},
            alignment:{horizontal:'center',vertical:'center'}
          };
        }
      }
    }
  }

  wsBase['!cols']=[
    {wch:30},{wch:34},{wch:28},{wch:20},{wch:42},{wch:13},{wch:42},{wch:12},{wch:36},
    {wch:18},{wch:16},{wch:14},{wch:17},{wch:18},{wch:16},{wch:24}
  ];

  // --- Hoja 3: Catálogo ---
  const catalog=ps.flatMap(pr=>pr.semesters.flatMap((sem,s)=>sem.map((name,c)=>({
    Programa:pr.name,
    'Acrónimo PE':programAcronym(pr),
    'Salida lateral':pr.exit,
    Cuatrimestre:s+1,
    Asignatura:subjectCase(name),
    'Horas al cuatrimestre':subjectHours(pr.id,s,c)||'',
    'Horas a la semana':weeklyHours(pr.id,s,c)||''
  }))));
  const wsCat=XLSX.utils.json_to_sheet(catalog);
  wsCat['!cols']=[{wch:42},{wch:13},{wch:42},{wch:12},{wch:36},{wch:18},{wch:16}];


  // --- Hoja 4: Resumen por asignatura ---
  const summary=[];
  ps.forEach(pr=>pr.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    let x=0,xx=0,fav=0,coord=0;
    teachers.forEach(t=>{
      const a=teacherAnswer(t,pr.id,s,c,name);
      if(a.status==='X')x++;
      if(a.status==='XX')xx++;
      if(a.ideal)fav++;
      if(teacherCoordinator(t,pr.id,s,c))coord++;
    });
    summary.push({
      Programa:pr.name,
      'Acrónimo PE':programAcronym(pr),
      Cuatrimestre:s+1,
      Asignatura:subjectCase(name),
      'Horas al cuatrimestre':subjectHours(pr.id,s,c)||'',
      'Horas a la semana':weeklyHours(pr.id,s,c)||'',
      'Profesores X':x,
      'Profesores XX':xx,
      'Marcada favorita':fav,
      'Coordinadores de academia':coord
    });
  })));
  const wsSummary=XLSX.utils.json_to_sheet(summary);
  wsSummary['!autofilter']={ref:wsSummary['!ref']};
  wsSummary['!freeze']={ySplit:1,topLeftCell:'A2',activePane:'bottomLeft',state:'frozen'};
  wsSummary['!cols']=[{wch:42},{wch:16},{wch:12},{wch:38},{wch:18},{wch:16},{wch:14},{wch:14},{wch:16},{wch:23}];

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Concentrado perfiles');
  XLSX.utils.book_append_sheet(wb,wsBase,'Base maestra');
  XLSX.utils.book_append_sheet(wb,wsCat,'Catálogo');
  XLSX.utils.book_append_sheet(wb,wsSummary,'Resumen por asignatura');

  XLSX.writeFile(wb,`Concentrado_Perfiles_DIN_${cfg.periodo.replace(/[^a-z0-9]+/gi,'_')}.xlsx`,{cellStyles:true,bookSST:true});
}
window.exportExcel=function(){if(!isAdmin()){toast('Solo el administrador puede exportar la base maestra.');return}exportWorkbook().catch(e=>alert('No fue posible generar Excel: '+e.message))}


function setupAutoSave(){
  let timer=null;
  document.addEventListener('input',e=>{
    if(!editingAllowed())return;
    if(!e.target.matches('#perfil input,#perfil select,#perfil textarea'))return;
    e.target.classList.remove('required-field-error');
    const wrap=e.target.closest('label,.form-row');if(wrap)wrap.classList.remove('required-wrap-error');
    clearTimeout(timer);timer=setTimeout(()=>{collectProfile();updateNavState()},500);
  });
  document.addEventListener('change',e=>{
    if(!editingAllowed())return;
    if(e.target.matches('#perfil input,#perfil select,#perfil textarea')){collectProfile();updateNavState()}
  });
}

function init(){
  loadProfile();
  updatePeriodBadges();
  initAuth();
  renderCurrentProgram();
  renderAdmin();
  applyEditState();
  lockRevisionNav();
  setupAutoSave();
  updateLastSavedUI();
  startCountdown();
  updateNavState();
}
init();


/* V38: enlace robusto del botón de avance en escritorio y móvil */
document.addEventListener('DOMContentLoaded',()=>{
  const btn=document.getElementById('continueProfileBtn');
  if(!btn||btn.dataset.boundContinue==='1')return;
  btn.dataset.boundContinue='1';
  btn.addEventListener('click',async ev=>{
    ev.preventDefault();
    ev.stopPropagation();
    if(btn.disabled)return;
    btn.disabled=true;
    try{
      await window.continueToCapture();
    }finally{
      btn.disabled=false;
    }
  },{passive:false});
});
