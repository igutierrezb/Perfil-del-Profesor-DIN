
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, onSnapshot, serverTimestamp, addDoc } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const $=id=>document.getElementById(id);
const store=JSON.parse(localStorage.getItem('PAD_UTEQ')||'{}');
const cfg=Object.assign({jefe:'Iván Gutiérrez Bautista',codigo:'EA-F-86',revision:'Rev.01',fechaRevision:'21-sep-2018',periodo:'SEP 2026 - AGO 2027',editingLocked:false,captureDeadline:null},store.cfg||{});
const DEFAULT_COMMON_RULES=[
  {id:'TC_IND',name:'Tronco común Industrial',programIds:['ind_plasticos','ind_procesos'],semesters:[0,1,2]},
  {id:'TC_MEC',name:'Tronco común Mecánica',programIds:['mec_ind','mec_moldes','mec_auto'],semesters:[0,1,2]}
];
let answers=store.answers||{},programMeta=store.programMeta||{},customPrograms=store.customPrograms||[],disabledPrograms=store.disabledPrograms||[],programAcronyms=store.programAcronyms||{},commonRules=Array.isArray(store.commonRules)?store.commonRules:JSON.parse(JSON.stringify(DEFAULT_COMMON_RULES));
let currentProgramIndex=Number.isInteger(store.currentProgramIndex)?store.currentProgramIndex:0;
let newSemesterCount=5,auth=null,currentUser=null,authReady=false,db=null,cloudSettingsUnsub=null,remoteProfileLoaded=false,cloudAvailable=false,cloudSaveTimer=null,countdownTimer=null,lastSavedAt=store.lastSavedAt||null,editingCommonRuleId=null;
const allowedDomain=(window.PAD_ALLOWED_DOMAIN||'uteq.edu.mx').toLowerCase();
const adminEmail=(window.PAD_ADMIN_EMAIL||'ivan.gutierrez@uteq.edu.mx').toLowerCase();

function allPrograms(){return [...PROGRAMS,...customPrograms]}
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
  const rows=(typeof PROGRAM_HOURS!=='undefined'&&PROGRAM_HOURS[pid])||[];
  const base=Number(rows?.[s]?.[c])||0;
  if(base)return base;
  const pr=allPrograms().find(x=>x.id===pid);
  return Number(pr?.hours?.[s]?.[c])||0;
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
function editingAllowed(){
  return isAdmin() || (!cfg.editingLocked && !deadlinePassed() && !submissionLockedForCurrentPeriod());
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
  toast('La edición de perfiles está temporalmente desactivada.');
  return false;
}
function applyEditState(){
  const locked=!editingAllowed();
  document.body.classList.toggle('profile-edit-locked',locked);
  ['perfil','captura'].forEach(id=>{
    const root=$(id); if(!root)return;
    root.querySelectorAll('input,select,textarea,button').forEach(el=>{
      if(el.closest('.flow-buttons') && el.textContent.includes('Anterior')) return;
      if(id==='captura' && el.textContent.includes('Continuar a revisión')) return;
      el.disabled=locked;
    });
  });
  const banner=$('editingLockedBanner');
  if(banner){
    banner.classList.toggle('hidden',!locked);
    if(locked){
      banner.textContent=submissionLockedForCurrentPeriod()
        ?'✓ Perfil formalizado. La edición quedó cerrada para este periodo; podrá consultar e imprimir.'
        :deadlinePassed()
          ?'⏱ Captura fuera de tiempo. Puede consultar e imprimir, pero la edición está cerrada.'
          :'🔒 La edición de perfiles está temporalmente desactivada por Administración.';
    }
  }
}
window.toggleEditingLock=function(){
  if(!isAdmin()){toast('Solo el administrador puede cambiar este estado.');return}
  cfg.editingLocked=!cfg.editingLocked;
  persist();
  renderAdmin();
  applyEditState();
  saveGlobalSettings(cfg.editingLocked?'Edición global desactivada':'Edición global activada');
  toast(cfg.editingLocked?'Edición de perfiles desactivada.':'Edición de perfiles activada.');
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
  store.cfg=cfg;store.answers=answers;store.programMeta=programMeta;store.customPrograms=customPrograms;store.disabledPrograms=disabledPrograms;store.programAcronyms=programAcronyms;store.commonRules=commonRules;store.currentProgramIndex=currentProgramIndex;store.lastSavedAt=Date.now();
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
    programAcronyms:{...programAcronyms},
    commonRules:JSON.parse(JSON.stringify(commonRules))
  };
}
function applyGlobalSettings(data){
  if(!data)return;
  if(data.cfg)Object.assign(cfg,data.cfg);
  if(Array.isArray(data.disabledPrograms))disabledPrograms=data.disabledPrograms;
  if(Array.isArray(data.customPrograms))customPrograms=data.customPrograms;
  if(data.programAcronyms&&typeof data.programAcronyms==='object')programAcronyms=data.programAcronyms;
  if(Array.isArray(data.commonRules))commonRules=data.commonRules;
  currentProgramIndex=Math.min(currentProgramIndex,Math.max(0,programs().length-1));
  localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,disabledPrograms,programAcronyms,commonRules,currentProgramIndex,lastSavedAt}));
  updatePeriodBadges();renderCurrentProgram();renderAdmin();updateCountdownUI();updateNavState();
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
      store.answers=answers;store.programMeta=programMeta;
      localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,customPrograms,disabledPrograms,programAcronyms,commonRules,currentProgramIndex,lastSavedAt}));
      loadProfileValuesOnly();
      renderCurrentProgram();
      updateProgress();
    }
    remoteProfileLoaded=true;
    if(!snap.exists())scheduleCloudProfileSave();
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
}
async function loadTeachersForExport(){
  if(!db||!isAdmin())return [{name:fullName()||'(Profesor sin nombre)',category:store.profile?.categoria||'',answers,programMeta,email:currentUser?.email||''}];
  try{
    const snap=await getDocs(collection(db,'profiles'));
    const rows=[];
    snap.forEach(ds=>{
      const d=ds.data(),p=d.profile||{};
      const name=[p.apPat,p.apMat,p.nombres].filter(Boolean).join(' ')||d.displayName||d.email||'(Sin nombre)';
      rows.push({name,category:p.categoria||'',answers:d.answers||{},programMeta:d.programMeta||{},email:d.email||''});
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
function updateAuthUI(){
  const gateStatus=$('authStatusGate'),topStatus=$('authStatus');
  if(authConfigured()){
    gateStatus.textContent=currentUser?`${currentUser.email}${isAdmin()?' · administrador':''}`:`Sin sesión · requiere cuenta institucional`;
    topStatus.textContent=currentUser?`${currentUser.email}${isAdmin()?' · administrador':''}`:`Sin sesión · requiere cuenta institucional`;
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
window.signIn=async function(){
  if(!authConfigured()){alert('Firebase no está configurado correctamente. Revisa firebase-config.js y confirma apiKey, authDomain, projectId y appId.');return}
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({hd:allowedDomain,prompt:'select_account'});
  try{
    await setPersistence(auth,browserLocalPersistence);
    const res=await signInWithPopup(auth,provider);
    const email=(res.user.email||'').toLowerCase();
    if(!isInstitutional(email)){await signOut(auth);alert('Solo se permiten cuentas @'+allowedDomain);return}
  }catch(e){
    const code=e&&e.code?e.code:'';
    if(code==='auth/api-key-not-valid.-please-pass-a-valid-api-key.' || code==='auth/invalid-api-key'){
      alert('La configuración de Firebase no es válida. Esta versión ya no guarda la API key en el repositorio: configura los GitHub Actions Secrets indicados en SETUP_FIREBASE_GITHUB.md y vuelve a desplegar.');
    }else{
      alert('No fue posible iniciar sesión: '+(e.message||e));
    }
  }
}
window.signOutApp=async function(){if(auth)await signOut(auth)}

function initAuth(){
  if(!authConfigured()){updateAuthUI();return}
  const fbApp=initializeApp(window.FIREBASE_CONFIG);
  auth=getAuth(fbApp);
  db=getFirestore(fbApp);
  onAuthStateChanged(auth,async user=>{
    currentUser=user;
    remoteProfileLoaded=false;
    if(user&&!isInstitutional(user.email||'')){signOut(auth);currentUser=null;alert('Solo se permiten cuentas @'+allowedDomain)}
    updateAuthUI();
    if(currentUser)await initCloud();
  });
}

window.go=function(id,force=false){
  if(id==='admin'&&!isAdmin()){toast('Administración disponible únicamente para ivan.gutierrez@uteq.edu.mx');return}
  if(id==='captura'&&!force){const p=validateProfile();if(!p.ok){$('profileErrors').innerHTML=statusBox(p.errors,'Complete los datos obligatorios antes de continuar.');return}}
  if(id==='revision'&&!force){const v=validateAll();if(!v.ok){showCaptureErrors(v.errors);return}}
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
  if(rBtn)rBtn.classList.toggle('complete',validateAll().ok);
}

function buildProfileRows(){
  const f=['Licenciatura o TSU','Posgrado 1','Posgrado 2','Posgrado 3','Posgrado 4','Posgrado 5','Posgrado 6'];
  $('formacion').innerHTML=f.map((lab,i)=>`<div class="form-row two"><div class="row-label">${lab}${i===0?' *':''}</div><input placeholder="Grado / estudio" data-g="f${i+1}a"><input placeholder="Institución" data-g="f${i+1}b"></div>`).join('');
  $('docencia').innerHTML=Array.from({length:4},(_,i)=>`<div class="form-row two"><div class="row-label">Institución ${i+1}${i===0?' *':''}</div><input placeholder="Institución" data-g="d${i+1}a"><input placeholder="Periodo" data-g="d${i+1}c"></div>`).join('');
  $('laboral').innerHTML=Array.from({length:5},(_,i)=>`<div class="form-row"><div class="row-label">Organización ${i+1}${i===0?' *':''}</div><input placeholder="Organización" data-g="l${i+1}a"><input placeholder="Cargo" data-g="l${i+1}b"><input placeholder="Periodo" data-g="l${i+1}c"></div>`).join('');
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
function validateProfile(){const p=collectProfile(),e=p.extra||{},errs=[];if(!p.apPat)errs.push('Capture el apellido paterno.');if(!p.apMat)errs.push('Capture el apellido materno.');if(!p.nombres)errs.push('Capture los nombres.');if(!p.categoria)errs.push('Seleccione la categoría.');if(!e.f1a||!e.f1b)errs.push('Capture la primera línea de Formación profesional.');if(!e.d1a||!e.d1c)errs.push('Capture la primera línea de Experiencia docente.');if(!e.l1a||!e.l1b||!e.l1c)errs.push('Capture la primera línea de Experiencia laboral.');return{ok:!errs.length,errors:errs}}
window.saveSection=function(){if(!requireEditing())return;collectProfile();writeAudit('Sección de perfil guardada');toast('Sección guardada.')}
window.continueToCapture=function(){if(!requireEditing())return;const v=validateProfile();$('profileErrors').innerHTML=v.ok?'':statusBox(v.errors,'Complete los datos obligatorios antes de continuar.');if(!v.ok)return;renderCurrentProgram();window.go('captura',true)}

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
  if(!source||!sourceName||!rule)return;
  const normalized=normalizeSubjectName(sourceName);
  (rule.programIds||[]).forEach(other=>{
    if(other===pid)return;
    const target=allPrograms().find(x=>x.id===other);
    const targetSem=target?.semesters?.[s]||[];
    const tc=targetSem.findIndex(n=>normalizeSubjectName(n)===normalized);
    if(tc<0)return;
    answers[key(other,s,tc)]={status:r.status,origins:[...(r.origins||[])],ideal:!!r.ideal};
  });
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
      pending.push({pi,name});
      const logical=logicalCourseKey(p.id,s,c,name);
      if(!pendingLogical.has(logical))pendingLogical.set(logical,{pi,name});
    }
    if(['X','XX'].includes(a.status)&&!(a.origins||[]).length)invalid++;
  })));
  return{total,done,invalid,pending,pendingUnique:[...pendingLogical.values()],remainingUnique:pendingLogical.size}
}
function favoriteCount(){const u=new Set();programs().forEach(p=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{if(getAns(p.id,s,c,name).ideal)u.add(`${p.id}|${s}|${c}`)})));return u.size}
function updateProgress(){
  const x=overallStats(),pct=x.total?Math.round(x.done/x.total*100):0;
  $('progressText').textContent=`${x.done} de ${x.total} revisadas (${pct}%)${x.remainingUnique?` · ${x.remainingUnique} pendiente${x.remainingUnique===1?'':'s'}`:''}`;
  $('progressBar').style.width=pct+'%';
  $('idealCounter').textContent=`Materias favoritas: ${favoriteCount()} / mínimo 3`;
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
function renderCoordinator(p){
  const meta=programMeta[p.id]||{},enabled=!!meta.coordinatorEnabled;
  return `<div class="coordinator-panel coordinator-alert compact-coordinator">
    <div class="coordinator-inline">
      <div>
        <b>Coordinación de academia</b>
        <span>Solo habilitar si has sido coordinador(a) de academia previamente.</span>
      </div>
      <label class="coord-main-toggle">
        <input type="checkbox" ${enabled?'checked':''} onchange="toggleCoordinatorMode('${p.id}',this.checked)">
        <span>${enabled?'Sí, he sido coordinador(a)':'No habilitado'}</span>
      </label>
    </div>
  </div>`;
}


function rowCoordinatorChecked(pid,s,c){
  return !!(((programMeta[pid]||{}).coordinators||[]).includes(`${s}|${c}`));
}
function rowCoordinatorEnabled(pid,s,c,name){
  const meta=programMeta[pid]||{};
  const a=getAns(pid,s,c,name);
  return !!meta.coordinatorEnabled && !isEnglish(name) && a.status!=='off' && ['X','XX'].includes(a.status);
}

const pastelTitles=['#eef4f9','#f7efe7','#edf6f0','#f2effa','#fff4ea','#ecf6f8','#f8eef1','#eef5e9'];
function renderCurrentProgram(){
  const p=currentProgram();if(!p)return;
  $('programStep').textContent=`Programa ${currentProgramIndex+1} de ${programs().length}`;
  $('programFlowName').textContent=`${p.name} — ${p.exit}`;
  const st=programStats(p);
  let bg = pastelTitles[currentProgramIndex % pastelTitles.length];
  let h=`<article class="program"><div class="program-head" style="background:${bg}"><div class="program-title"><strong>${p.name}</strong><span><b>Salida lateral:</b> ${p.exit}</span></div><div class="program-progress">${st.done}/${st.total} revisadas${st.missing?` · ${st.missing} pendientes`:''}</div></div>${commonRuleForProgram(p.id)?`<div class="common-note">${commonDescription(p.id)}</div>`:''}${renderCoordinator(p)}<div class="program-scroll-wrap"><div class="scroll-hint">↔ Si la pantalla es más angosta, desplácese horizontalmente para ver todas las columnas.</div><div class="semesters-grid">`;
  p.semesters.forEach((sem,s)=>{
    h+=`<div class="semester-card"><h4>${s+1}.° cuatrimestre <span>${sem.length} asignaturas</span></h4><div class="course-columns"><span>Asignatura</span><span>Habilitar</span><span>Competencia</span><span class="area-head">Área de<br>conocimiento</span><span class="coord-head">Coordinación</span><span>Favorito</span></div>`;
    sem.forEach((name,c)=>{
      const a=getAns(p.id,s,c,name),na=isEnglish(name),enc=encodeURIComponent(name),enabled=!['off','na'].includes(a.status),pending=a.status==='pending',reviewed=!pending&&!na;
      h+=`<div class="course ${pending?'pending':''} ${a.status==='off'?'off':''} ${reviewed&&a.status!=='off'?'reviewed':''} ${na?'na':''}">
      <div class="name">${subjectCase(name)}${subjectHours(p.id,s,c)?` <small class="course-hours">(${subjectHours(p.id,s,c)} h)</small>`:'' }${na?' · NO APLICA':''}</div>
      <label class="toggle ${na?'locked':''}"><input type="checkbox" ${enabled?'checked':''} ${na?'disabled':''} onchange="setEnabled('${p.id}',${s},${c},decodeURIComponent('${enc}'),this.checked)"><span class="switch"></span><span>${na?'Bloqueado':enabled?'Sí':'No'}</span></label>
      <div class="comp-buttons"><button class="mini ${a.status==='X'?'on':''}" ${!enabled?'disabled':''} onclick="setCompetence('${p.id}',${s},${c},decodeURIComponent('${enc}'),'X')">X</button><button class="mini ${a.status==='XX'?'on':''}" ${!enabled?'disabled':''} onclick="setCompetence('${p.id}',${s},${c},decodeURIComponent('${enc}'),'XX')">XX</button></div>
      <div class="area-buttons">${['1','2','3','12','13','23','123'].map(code=>`<button class="mini area ${originCode(a)===code?'on':''}" ${!['X','XX'].includes(a.status)?'disabled':''} onclick="setOriginCode('${p.id}',${s},${c},decodeURIComponent('${enc}'),'${code}')">${code}</button>`).join('')}</div>
      <label class="coord-row-check ${rowCoordinatorChecked(p.id,s,c)?'on':''}" title="Solo habilitar si has sido coordinador(a) de academia previamente.">
        <input type="checkbox" ${rowCoordinatorChecked(p.id,s,c)?'checked':''} ${rowCoordinatorEnabled(p.id,s,c,name)?'':'disabled'} onchange="toggleCoordinator('${p.id}','${s}|${c}',this.checked)">
        <span>✓</span>
      </label>
      <button class="ideal-btn ${a.ideal?'on':''}" ${!enabled?'disabled':''} onclick="toggleIdeal('${p.id}',${s},${c},decodeURIComponent('${enc}'))">${a.ideal?'★ Favorito':'☆ Favorito'}</button></div>`
    });
    h+='</div>';
  });
  const lastProgram=currentProgramIndex===programs().length-1;
  h+=`</div></div><div class="program-save"><small>${st.missing?'Las filas rojizas indican materias pendientes.':'Programa completo.'}</small><button class="save-btn" onclick="${lastProgram?'validateAndReview()':'saveAndNextProgram()'}">${lastProgram?'Continuar a revisión e impresión →':'Guardar y seguir al siguiente programa →'}</button></div></article>`;
  $('programs').innerHTML=h;
  const flowBtn=$('flowNextBtn');
  if(flowBtn){
    flowBtn.textContent=lastProgram?'Continuar a revisión e impresión →':'Guardar y seguir al siguiente programa →';
    flowBtn.onclick=lastProgram?()=>validateAndReview():()=>saveAndNextProgram();
  }
  updateProgress();lockRevisionNav();updateNavState();applyEditState();
}
window.prevProgram=function(){currentProgramIndex=(currentProgramIndex-1+programs().length)%programs().length;persist();renderCurrentProgram();scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'})}
window.saveAndNextProgram=function(){
  persist();toast('Programa guardado.');
  if(currentProgramIndex>=programs().length-1){validateAndReview();return}
  currentProgramIndex++;
  persist();renderCurrentProgram();scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'})
}

function validateCapture(){const x=overallStats(),errs=[];if(x.remainingUnique)errs.push(`Falta${x.remainingUnique===1?'':'n'} ${x.remainingUnique} asignatura${x.remainingUnique===1?'':'s'} por revisar.`);if(x.invalid)errs.push(`${x.invalid} asignatura(s) tienen X/XX pero no tienen área de conocimiento.`);if(favoriteCount()<3)errs.push(`Debe seleccionar al menos 3 materias favoritas. Actualmente hay ${favoriteCount()}.`);return{ok:!errs.length,errors:errs}}
function validateAll(){const p=validateProfile(),c=validateCapture();return{ok:p.ok&&c.ok,errors:[...p.errors,...c.errors]}}
function showCaptureErrors(errs){$('captureErrors').innerHTML=statusBox(errs,'No puede pasar a revisión todavía.');const p=overallStats().pendingUnique;if(p.length){currentProgramIndex=p[0].pi;renderCurrentProgram()}}
window.validateAndReview=function(){collectProfile();persist();const v=validateAll();if(!v.ok){showCaptureErrors(v.errors);toast('Complete las materias pendientes.');return}$('captureErrors').innerHTML='';$('validation').innerHTML=`<div class="status-box ok"><b>Perfil completo.</b><br>La información puede formalizarse e imprimirse.</div>`;buildPrint();window.go('revision',true)}
function lockRevisionNav(){$('navRevision').classList.toggle('locked',!validateAll().ok)}
window.saveAll=function(show=false){if(!requireEditing())return;collectProfile();persist();updateProgress();lockRevisionNav();writeAudit('Perfil guardado manualmente');if(show)toast('Perfil guardado.')}

function printHeader(){
  return `<div class="sheetHead">
    <div class="brandPrint">
      <img src="logo-uteq-wordmark.svg" class="print-logo">
      <div class="printBrandText">UNIVERSIDAD TECNOLÓGICA<br>DE QUERÉTARO</div>
    </div>
    <div class="sheetTitle"><h2>PERFIL DEL PROFESOR</h2><b>DIVISIÓN: INDUSTRIAL</b><br><span>PERIODO DE VIGENCIA: ${cfg.periodo}</span></div>
    <div class="quality-plain"><span>${cfg.codigo}</span><span>${cfg.revision}</span><span>Fecha ${cfg.fechaRevision}</span></div>
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
  const nSem=Math.max(1,pr.semesters.length),levelW=1.7,areaW=2.35,subjectW=(100/nSem)-levelW-areaW;
  const colgroup=`<colgroup>${Array.from({length:nSem},()=>`<col class="subject" style="width:${subjectW}%"><col class="level" style="width:${levelW}%"><col class="area" style="width:${areaW}%">`).join('')}</colgroup>`;
  const th=pr.semesters.map((s,i)=>`<th colspan="3" style="background:${pastel}">${i+1}.° CUATRIMESTRE</th>`).join('');
  const sub=pr.semesters.map(()=>`<th style="background:${pastel}">Asignatura</th><th class="vhead" style="background:${pastel}">Nivel</th><th class="vhead" style="background:${pastel}">Área de competencia</th>`).join('');
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
    html+=`<div class="sheet program-trio">${printHeader()}${metaCentered()}${printProgram(ps[i],i)}${ps[i+1]?printProgram(ps[i+1],i+1):''}${ps[i+2]?printProgram(ps[i+2],i+2):''}</div>`
  }
  $('printArea').innerHTML=html
}
window.printProfile=function(){
  const v=validateAll();
  if(!v.ok){window.go('captura',true);showCaptureErrors(v.errors);return}
  buildPrint();
  window.print();
  setTimeout(()=>{
    if(isAdmin())return;
    const lock=window.confirm(
      '¿Deseas dar por finalizada tu captura?\n\nAceptar: se deshabilitará la edición de este perfil hasta que Administración cambie al próximo periodo.\n\nCancelar: podrás seguir editando.'
    );
    if(lock){
      store.submittedPeriod=cfg.periodo;
      persist();
      scheduleCloudProfileSave();
      writeAudit('Perfil formalizado después de imprimir/guardar PDF');
      applyEditState();
      updateNavState();
      toast('Perfil formalizado. La edición quedó cerrada para este periodo.');
    }else{
      toast('La edición permanece habilitada.');
    }
  },250);
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
function renderAdmin(){
  $('jefe').value=cfg.jefe;$('codigo').value=cfg.codigo;$('revisionCal').value=cfg.revision;$('fechaRevision').value=cfg.fechaRevision;$('periodoAdmin').value=cfg.periodo;
  if($('captureDeadlineAdmin'))$('captureDeadlineAdmin').value=toLocalDateTimeValue(cfg.captureDeadline);updateCountdownUI();
  const st=$('editModeStatus'),btn=$('editModeBtn');
  if(st){st.textContent=cfg.editingLocked?'Edición desactivada':'Edición activa';st.className='edit-mode-status '+(cfg.editingLocked?'locked':'open')}
  if(btn){btn.textContent=cfg.editingLocked?'Activar edición de perfiles':'Desactivar edición de perfiles';btn.className='edit-mode-btn '+(cfg.editingLocked?'activate':'deactivate')}
  renderSemesterEditors();renderProgramAdminList();renderCustomPrograms();renderRules();applyEditState()
}
function renderSemesterEditors(){
  let h='';
  for(let i=0;i<newSemesterCount;i++)h+=`<div class="semester-editor"><div class="semester-editor-head"><b>${i+1}.° cuatrimestre</b>${newSemesterCount>1?`<button onclick="removeSemesterEditor(${i})">Quitar</button>`:''}</div><textarea id="newSem${i}" placeholder="Ejemplo:\nCálculo diferencial - 90\nFísica - 75"></textarea><small class="semester-help">Formato: Asignatura - horas totales del cuatrimestre</small></div>`;
  $('newProgramSemesters').innerHTML=h
}
window.addSemesterEditor=function(){newSemesterCount++;renderSemesterEditors()}
window.removeSemesterEditor=function(i){const vals=Array.from({length:newSemesterCount},(_,x)=>$(`newSem${x}`)?.value||'');vals.splice(i,1);newSemesterCount=Math.max(1,newSemesterCount-1);renderSemesterEditors();vals.forEach((v,x)=>$(`newSem${x}`).value=v)}
function slug(s){return 'custom_'+s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_')+'_'+Date.now()}
function parseCustomSubjectLine(line){
  const clean=String(line||'').trim();
  const m=clean.match(/^(.*?)\s*-\s*(\d+(?:[.,]\d+)?)\s*$/);
  if(!m)return {name:clean,hours:0};
  return {name:m[1].trim(),hours:Number(m[2].replace(',','.'))||0};
}
window.saveNewProgram=function(){
  const name=$('newProgramName').value.trim(),exit=$('newProgramExit').value.trim();
  const parsed=Array.from({length:newSemesterCount},(_,i)=>($(`newSem${i}`).value||'').split(/\n+/).map(parseCustomSubjectLine).filter(x=>x.name));
  const semesters=parsed.map(rows=>rows.map(x=>x.name));
  const hours=parsed.map(rows=>rows.map(x=>x.hours));
  if(!name||!exit||semesters.some(x=>!x.length)){toast('Complete nombre, salida lateral y materias.');return}
  if(parsed.some(rows=>rows.some(x=>!x.hours))){toast('Agregue las horas de cada materia con el formato: Asignatura - horas.');return}
  customPrograms.push({id:slug(name),name,exit,common:null,semesters,hours});
  $('newProgramName').value='';$('newProgramExit').value='';newSemesterCount=5;persist();saveGlobalSettings('Programa educativo agregado');renderAdmin();renderCurrentProgram();toast('Programa educativo agregado.');
}


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
      <div><b>${p.name}</b><small>${p.exit}${custom?' · Programa agregado':''}${rule?` · <strong>Tronco común</strong>`:''}</small></div>
      <label class="acronym-edit">Acrónimo<input value="${programAcronym(p)}" maxlength="18" onchange="setProgramAcronym('${p.id}',this.value)"></label>
      <button class="common-program-btn ${rule?'active':''}" onclick="openCommonRuleEditor('${p.id}')">${rule?'Tronco común ✓':'Configurar tronco'}</button>
      <button class="${enabled?'disable-program':'enable-program'}" onclick="toggleProgramEnabled('${p.id}')">${enabled?'Deshabilitar':'Habilitar'}</button>
    </div>`
  }).join('');
}

window.deleteCustomProgram=function(id){if(!confirm('¿Eliminar este programa?'))return;customPrograms=customPrograms.filter(p=>p.id!==id);disabledPrograms=disabledPrograms.filter(x=>x!==id);currentProgramIndex=Math.min(currentProgramIndex,Math.max(0,programs().length-1));persist();saveGlobalSettings('Programa educativo eliminado');renderAdmin();renderCurrentProgram()}
function renderCustomPrograms(){
  $('customProgramsList').innerHTML=customPrograms.length?`<h3 style="margin-top:16px">Programas agregados</h3>`+customPrograms.map(p=>`<div class="custom-program-item"><div><b>${p.name}</b><br>${p.exit}<br><small>${p.semesters.reduce((n,s)=>n+s.length,0)} materias · horas configuradas</small></div><button onclick="deleteCustomProgram('${p.id}')">Eliminar</button></div>`).join(''):''
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
  aoa[0][1]='Leyenda: ★ Favorito · C Coordinador de academia';
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
        aoa[headerRows+ti][col]=level?`${level}${fav?' ★':''}${coord?' C':''}`:'';
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


  // Marcas administrativas: Coordinación en rojo suave; Favorito en ámbar.
  for(let r=headerRows;r<aoa.length;r++){
    for(let c=2;c<col;c++){
      const addr=XLSX.utils.encode_cell({r,c}),v=String(aoa[r]?.[c]||'');
      if(!v)continue;
      if(v.includes(' C')){
        styleCell(addr,{
          font:{bold:true,color:{rgb:'9C2F2F'}},
          fill:{fgColor:{rgb:'FCE8E6'}},
          alignment:{horizontal:'center',vertical:'center'},
          border:{top:{style:'thin',color:{rgb:'D9908B'}},bottom:{style:'thin',color:{rgb:'D9908B'}},left:{style:'thin',color:{rgb:'D9908B'}},right:{style:'thin',color:{rgb:'D9908B'}}}
        });
      }else if(v.includes('★')){
        styleCell(addr,{
          font:{bold:true,color:{rgb:'8B6411'}},
          fill:{fgColor:{rgb:'FFF2CC'}},
          alignment:{horizontal:'center',vertical:'center'},
          border:{top:{style:'thin',color:{rgb:'D7BE72'}},bottom:{style:'thin',color:{rgb:'D7BE72'}},left:{style:'thin',color:{rgb:'D7BE72'}},right:{style:'thin',color:{rgb:'D7BE72'}}}
        });
      }
    }
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
  wsSummary['!cols']=[{wch:42},{wch:16},{wch:12},{wch:38},{wch:18},{wch:16},{wch:14},{wch:14},{wch:16},{wch:23}];

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Concentrado perfiles');
  XLSX.utils.book_append_sheet(wb,wsBase,'Base maestra');
  XLSX.utils.book_append_sheet(wb,wsCat,'Catálogo');
  XLSX.utils.book_append_sheet(wb,wsSummary,'Resumen por asignatura');

  XLSX.writeFile(wb,`Concentrado_Perfiles_DIN_${cfg.periodo.replace(/[^a-z0-9]+/gi,'_')}.xlsx`);
}
window.exportExcel=function(){if(!isAdmin()){toast('Solo el administrador puede exportar la base maestra.');return}exportWorkbook().catch(e=>alert('No fue posible generar Excel: '+e.message))}


function setupAutoSave(){
  let timer=null;
  document.addEventListener('input',e=>{
    if(!editingAllowed())return;
    if(!e.target.matches('#perfil input,#perfil select,#perfil textarea'))return;
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
