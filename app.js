import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, onSnapshot, serverTimestamp, addDoc } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';


const $=id=>document.getElementById(id);


const GLOBAL_SETTINGS_CACHE_KEY='PAD_UTEQ_GLOBAL_SETTINGS';
function readGlobalSettingsCache(){
  try{
    const raw=localStorage.getItem(GLOBAL_SETTINGS_CACHE_KEY);
    return raw?JSON.parse(raw):{};
  }catch(_){return {}}
}
const cachedGlobalSettings=readGlobalSettingsCache();
const store=JSON.parse(localStorage.getItem('PAD_UTEQ')||'{}');
const cfg=Object.assign(
  {jefe:'Iván Gutiérrez Bautista',codigo:'EA-F-86',revision:'Rev.01',fechaRevision:'21-sep-2018',periodo:'SEP 2026 - AGO 2027',editingLocked:false,captureDeadline:null,planningEnabled:false},
  cachedGlobalSettings.cfg||{},
  store.cfg||{}
);
let globalSettingsKnown=!!cachedGlobalSettings.cfg;
const DEFAULT_COMMON_RULES=[
  {id:'TC_IND',name:'Tronco común Industrial',programIds:['ind_plasticos','ind_procesos'],semesters:[0,1,2]},
  {id:'TC_MEC',name:'Tronco común Mecánica',programIds:['mec_ind','mec_moldes','mec_auto'],semesters:[0,1,2]}
];
let answers=store.answers||{},programMeta=store.programMeta||{},customPrograms=store.customPrograms||[],programOverrides=store.programOverrides||{},disabledPrograms=store.disabledPrograms||[],programAcronyms=store.programAcronyms||{},commonRules=Array.isArray(store.commonRules)?store.commonRules:JSON.parse(JSON.stringify(DEFAULT_COMMON_RULES)),transversalRules=Array.isArray(store.transversalRules)?store.transversalRules:[],planningByPeriod=(store.planningByPeriod&&typeof store.planningByPeriod==='object')?store.planningByPeriod:{};
let currentProgramIndex=0;
const workflowState={
  profileConfirmed:false,
  expectedProgramIndex:0,
  reviewUnlocked:false
};
let newSemesterCount=5,programEditorSemesters=[],auth=null,currentUser=null,authReady=false,db=null,cloudSettingsUnsub=null,cloudProfileMetaUnsub=null,remoteProfileLoaded=false,cloudAvailable=false,cloudSaveTimer=null,cloudRetryTimer=null,countdownTimer=null,lastSavedAt=store.lastSavedAt||null,editingCommonRuleId=null,editingProgramId=null,teacherAdminCache={};
let cloudSyncInFlight=false;
const allowedDomain=(window.PAD_ALLOWED_DOMAIN||'uteq.edu.mx').toLowerCase();
const PAD_BUILD_VERSION='V80-2026-09-29';
window.PAD_BUILD_VERSION=PAD_BUILD_VERSION;
const adminEmail=(window.PAD_ADMIN_EMAIL||'ivan.gutierrez@uteq.edu.mx').toLowerCase();
const googleClientId=String(window.PAD_GOOGLE_CLIENT_ID||'').trim();


const PLANNING_DAYS=[
  {key:'lunes',label:'Lunes'},
  {key:'martes',label:'Martes'},
  {key:'miercoles',label:'Miércoles'},
  {key:'jueves',label:'Jueves'},
  {key:'viernes',label:'Viernes'}
];
const PLANNING_SLOTS=[
  ['07:00','08:00'],['08:00','09:00'],['09:00','10:00'],['10:00','11:00'],
  ['11:00','12:00'],['12:00','13:00'],['13:00','14:00'],['14:00','15:00'],['15:00','16:00']
];


function emptyCommission(){
  return {
    name:'',
    authorizedHours:'',
    scheduleRequired:'no',
    reservedSlots:[]
  };
}
function defaultPlanningRecord(){
  return {
    commissionMode:'',
    commissions:[emptyCommission()],
    projectMode:'',
    projectName:'',
    projectRole:'',
    projectHours:'',
    projectReference:'',
    comments:'',
    completedAtMs:null,
    updatedAtMs:null
  };
}
function migratePlanningRecord(raw){
  if(!raw||typeof raw!=='object')return defaultPlanningRecord();


  // Compatibilidad con V46/V47: conserva información capturada previamente.
  if(!Array.isArray(raw.commissions)){
    const oldName=String(raw.commissionName||'').trim();
    const oldMgmt=Array.isArray(raw.managementCommissions)
      ?raw.managementCommissions.map(x=>String(x||'').trim()).filter(Boolean)
      :[];
    const oldSlots=Array.isArray(raw.reservedSlots)?raw.reservedSlots:[];
    const names=[oldName,...oldMgmt].filter(Boolean);
    raw.commissions=(names.length?names:['']).map((name,i)=>({
      name,
      authorizedHours:'',
      scheduleRequired:(i===0&&oldSlots.length)?'yes':'no',
      reservedSlots:(i===0?oldSlots:[])
    }));
    raw.commissionMode=(raw.scheduleMode==='yes'||raw.managementMode==='yes'||names.length)?'yes':
      ((raw.scheduleMode==='na'&&raw.managementMode==='na')?'na':'');
  }


  raw.projectMode=raw.projectMode||raw.pidetMode||'';
  raw.projectName=raw.projectName||raw.pidetName||'';
  raw.projectRole=raw.projectRole||raw.pidetCoordinator||'';
  raw.projectHours=raw.projectHours||'';
  raw.projectReference=raw.projectReference||'';
  raw.comments=raw.comments||'';
  if(!Array.isArray(raw.commissions)||!raw.commissions.length)raw.commissions=[emptyCommission()];
  raw.commissions=raw.commissions.map(c=>({
    name:String(c?.name||''),
    authorizedHours:String(c?.authorizedHours??''),
    scheduleRequired:['yes','no'].includes(c?.scheduleRequired)?c.scheduleRequired:'no',
    reservedSlots:Array.isArray(c?.reservedSlots)?c.reservedSlots:[]
  }));
  return raw;
}
function currentPlanningRecord(create=true){
  const period=cfg.periodo||'';
  if(!planningByPeriod[period]&&create)planningByPeriod[period]=defaultPlanningRecord();
  const raw=migratePlanningRecord(planningByPeriod[period]||defaultPlanningRecord());
  if(create)planningByPeriod[period]=raw;
  return raw;
}
function planningEnabled(){return !!cfg.planningEnabled}
function planningEditingAllowed(){return editingAllowed()}
function planningSlotKey(day,start,end){return `${day}|${start}-${end}`}
function planningSlotLabel(slotKey){
  const [dayKey,hours='']=String(slotKey||'').split('|');
  const day=PLANNING_DAYS.find(d=>d.key===dayKey)?.label||dayKey;
  return `${day} ${hours}`;
}
function commissionScheduleSummary(commission){
  const slots=Array.isArray(commission?.reservedSlots)?commission.reservedSlots:[];
  if(commission?.scheduleRequired!=='yes')return 'Sin bloque específico';
  return PLANNING_DAYS.map(day=>{
    const daySlots=slots
      .filter(x=>String(x).startsWith(day.key+'|'))
      .map(x=>String(x).split('|')[1])
      .filter(Boolean);
    return daySlots.length?`${day.label}: ${daySlots.join(', ')}`:'';
  }).filter(Boolean).join(' | ');
}




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
function academicDegree(){return String(store.profile?.gradoAcademico||'').trim();}
function printedProfessorName(){
  const p=store.profile||{};
  const degree=String(p.gradoAcademico||'').trim();
  const name=[p.nombres,p.apPat,p.apMat].filter(Boolean).join(' ').trim();
  return [degree,name].filter(Boolean).join(' ').trim();
}
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
function individualEditBlocked(){
  return !!store.individualEditDisabled;
}
function editingAllowed(){
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
  window.scrollTo(0,0);
}
function removeLegacyBackupUI(){
  $('backupRestoreCard')?.remove();
  $('restoreModal')?.remove();
  document.body.classList.remove('restore-open');
}
function installLegacyBackupGuard(){
  removeLegacyBackupUI();
  const observer=new MutationObserver(()=>removeLegacyBackupUI());
  observer.observe(document.body,{childList:true,subtree:true});
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
  if(!cfg.captureDeadline){
    if(!currentUser && !globalSettingsKnown){
      return {text:'Inicie sesión para consultar la fecha límite de captura',level:'neutral'};
    }
    return {text:'Captura sin fecha límite definida',level:'neutral'};
  }
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
  if(st){
    st.textContent=cfg.captureDeadline
      ?(deadlinePassed()?'Fuera de tiempo':'Captura abierta')
      :(globalSettingsKnown?'Sin fecha límite':'Cargando configuración');
    st.className=`deadline-admin-status ${deadlinePassed()?'expired':cfg.captureDeadline?'open':'neutral'}`
  }
  if(prev)prev.innerHTML=cfg.captureDeadline
    ?`<b>${formatDateTime(cfg.captureDeadline)}</b><span>${info.text}</span>`
    :(globalSettingsKnown
      ?'<b>Sin fecha límite</b><span>La edición dependerá únicamente del interruptor general.</span>'
      :'<b>Cargando configuración</b><span>La fecha límite se confirmará al iniciar sesión.</span>');
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
      if(id==='captura' && (el.textContent.includes('Continuar a revisión')||el.textContent.includes('continuar a revisión'))) return;
      el.disabled=locked;
    });
  });
  const banner=$('editingLockedBanner');
  if(banner){
    banner.classList.toggle('hidden',!locked);
    if(locked){
      if(submissionLockedForCurrentPeriod()){
        banner.classList.add('finalized-profile-banner');
        banner.innerHTML=`<strong>🔒 Perfil finalizado</strong>
          <ul>
            <li>La edición está <b>bloqueada para el periodo actual</b>.</li>
            <li>Puede consultar e imprimir nuevamente su información cuando lo requiera.</li>
            <li>Si necesita realizar alguna corrección, solicite al <b>JUCA</b> la habilitación temporal de edición.</li>
          </ul>`;
      }else{
        banner.classList.remove('finalized-profile-banner');
        banner.textContent=deadlinePassed()
          ?'⏱ Captura fuera de tiempo. Puede consultar e imprimir, pero la edición está cerrada.'
          :'🔒 Edición desactivada por Administración. Puede consultar todo su perfil e imprimirlo normalmente.';
      }
    }
  }


  const commissionsRoot=$('commissionsBlock');
  const planningLocked=!planningEditingAllowed();
  if(commissionsRoot){
    commissionsRoot.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=planningLocked);
  }
  const planningBanner=$('commissionsLockedBanner');
  if(planningBanner){
    planningBanner.classList.toggle('hidden',!planningLocked);
    if(planningLocked){
      planningBanner.textContent=deadlinePassed()
        ?'⏱ La captura de Comisiones está fuera de tiempo. La información permanece disponible para consulta.'
        :'🔒 La edición de Comisiones está bloqueada. La información permanece disponible para consulta.';
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
function ordinalSemesterList(values=[]){
  const items=[...values].sort((a,b)=>a-b).map(x=>`${x+1}.°`);
  if(items.length<=1)return items.join('');
  if(items.length===2)return `${items[0]} y ${items[1]}`;
  return `${items.slice(0,-1).join(', ')} y ${items[items.length-1]}`;
}
function commonProgramDisplay(id){
  const pr=allPrograms().find(x=>x.id===id);
  if(!pr)return id;
  return `${pr.name}${pr.exit?` — ${pr.exit}`:''}`;
}
function commonNoticeHtml(pid){
  const rule=commonRuleForProgram(pid);
  if(!rule)return '';
  const semesterText=ordinalSemesterList(rule.semesters||[]);
  const peers=(rule.programIds||[])
    .filter(id=>id!==pid)
    .map(commonProgramDisplay);
  const peerHtml=peers.length
    ? peers.map(x=>`<li>${escapeHtml(x)}</li>`).join('')
    : '<li>Otros programas vinculados al mismo tronco común.</li>';
  return `<div class="common-sync-alert">
    <div class="common-sync-icon">↔</div>
    <div class="common-sync-copy">
      <strong>Tronco común sincronizado · ${escapeHtml(semesterText)} cuatrimestre${(rule.semesters||[]).length===1?'':'s'}</strong>
      <p>Las asignaturas coincidentes de estos cuatrimestres comparten su configuración académica. Si posteriormente <b>deshabilita</b> una materia, esa decisión será individual y no modificará las demás.</p>
      <div class="common-sync-programs"><span>Programas relacionados:</span><ul>${peerHtml}</ul></div>
    </div>
  </div>`;
}


function getAns(pid,s,c,name){
  const k=key(pid,s,c);
  if(isEnglish(name)){answers[k]={status:'na',origins:[],ideal:false};return answers[k]}
  if(!answers[k])answers[k]={status:'pending',origins:[],ideal:false};
  return answers[k]
}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2400)}
function profileBackupKey(uid=currentUser?.uid){
  return uid?`PAD_UTEQ_PROFILE_${uid}`:'';
}
function profileBackupSnapshot(){
  return {
    profile:JSON.parse(JSON.stringify(store.profile||{})),
    answers:JSON.parse(JSON.stringify(answers||{})),
    programMeta:JSON.parse(JSON.stringify(programMeta||{})),
    planningByPeriod:JSON.parse(JSON.stringify(planningByPeriod||{})),
    submittedPeriod:store.submittedPeriod||null,
    finalizedAtMs:Number(store.finalizedAtMs)||null,
    profileResetToken:store.profileResetToken||null,
    profileDeletionToken:store.profileDeletionToken||null,
    currentProgramIndex:0,
    localUpdatedAt:Number(store.localUpdatedAt)||Number(store.lastSavedAt)||Date.now(),
    cloudUpdatedAt:Number(store.cloudUpdatedAt)||0,
    syncPending:!!store.syncPending,
    dataRevision:Number(store.dataRevision)||0,
    savedAt:Date.now()
  };
}
function saveUserBackup(){
  const key=profileBackupKey();
  if(!key)return;
  try{localStorage.setItem(key,JSON.stringify(profileBackupSnapshot()))}
  catch(e){console.warn('No fue posible actualizar el respaldo local por usuario',e)}
}
function readUserBackup(){
  const key=profileBackupKey();
  if(!key)return null;
  try{
    const raw=localStorage.getItem(key);
    return raw?JSON.parse(raw):null;
  }catch(e){
    console.warn('No fue posible leer el respaldo local por usuario',e);
    return null;
  }
}
function clearUserBackup(uid){
  const key=profileBackupKey(uid);
  if(key)localStorage.removeItem(key);
}
function backupHasTeacherData(backup){
  if(!backup||typeof backup!=='object')return false;
  const p=backup.profile||{};
  const hasProfile=!!(p.apPat||p.apMat||p.nombres||p.categoria||p.gradoAcademico||Object.values(p.extra||{}).some(Boolean));
  const hasAnswers=Object.keys(backup.answers||{}).length>0;
  const hasMeta=Object.keys(backup.programMeta||{}).length>0;
  const hasPlanning=Object.keys(backup.planningByPeriod||{}).length>0;
  return hasProfile||hasAnswers||hasMeta||hasPlanning||!!backup.submittedPeriod||!!backup.finalizedAtMs;
}
function cloudHasTeacherData(data){
  return backupHasTeacherData({
    profile:data?.profile||{},
    answers:data?.answers||{},
    programMeta:data?.programMeta||{},
    planningByPeriod:data?.planningByPeriod||{},
    submittedPeriod:data?.submittedPeriod||null,
    finalizedAtMs:Number(data?.finalizedAtMs)||null
  });
}


function persist(options={}){
  const {touch=true,schedule=true}=options;
  cfg.periodo=cfg.periodo||'SEP 2026 - AGO 2027';
  const now=Date.now();
  store.cfg=cfg;
  store.answers=answers;
  store.programMeta=programMeta;
  store.customPrograms=customPrograms;
  store.programOverrides=programOverrides;
  store.disabledPrograms=disabledPrograms;
  store.programAcronyms=programAcronyms;
  store.commonRules=commonRules;
  store.transversalRules=transversalRules;
  store.planningByPeriod=planningByPeriod;
  store.currentProgramIndex=0;
  store.lastSavedAt=now;
  if(touch){
    store.localUpdatedAt=now;
    store.dataRevision=(Number(store.dataRevision)||0)+1;
    store.syncPending=true;
  }
  lastSavedAt=store.lastSavedAt;
  try{
    localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
    saveUserBackup();
  }catch(e){
    console.error('No fue posible guardar localmente el perfil',e);
    updateCloudStatus('Error de almacenamiento local','warn');
  }
  updateLastSavedUI();
  if(schedule)scheduleCloudProfileSave();
}
function statusBox(errors,title){return `<div class="status-box bad"><b>${title}</b><ul>${errors.map(x=>`<li>${x}</li>`).join('')}</ul></div>`}
function updatePeriodBadges(){ $('periodBadgeGate').textContent=`Periodo de vigencia · ${cfg.periodo}`; $('periodBadgeInline').textContent=`Periodo de vigencia · ${cfg.periodo}`; }
function authConfigured(){return !!(window.FIREBASE_CONFIG&&window.FIREBASE_CONFIG.apiKey&&window.FIREBASE_CONFIG.projectId&&window.FIREBASE_CONFIG.appId)}


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
    commonRules:JSON.parse(JSON.stringify(commonRules)),
    transversalRules:JSON.parse(JSON.stringify(transversalRules))
  };
}
function cacheGlobalSettings(){
  try{
    localStorage.setItem(GLOBAL_SETTINGS_CACHE_KEY,JSON.stringify({
      cfg:{...cfg},
      savedAt:Date.now()
    }));
    globalSettingsKnown=true;
  }catch(e){
    console.warn('No fue posible conservar la configuración global en caché',e);
  }
}


function applyGlobalSettings(data){
  if(!data)return;
  if(data.cfg)Object.assign(cfg,data.cfg);
  globalSettingsKnown=true;
  cacheGlobalSettings();
  if(Array.isArray(data.disabledPrograms))disabledPrograms=data.disabledPrograms;
  if(Array.isArray(data.customPrograms))customPrograms=data.customPrograms;
  if(data.programOverrides&&typeof data.programOverrides==='object')programOverrides=data.programOverrides;
  if(data.programAcronyms&&typeof data.programAcronyms==='object')programAcronyms=data.programAcronyms;
  if(Array.isArray(data.commonRules))commonRules=data.commonRules;
  if(Array.isArray(data.transversalRules))transversalRules=data.transversalRules;
  currentProgramIndex=Math.min(currentProgramIndex,Math.max(0,programs().length-1));
  localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt}));
  updatePeriodBadges();renderCurrentProgram();renderAdmin();updateCountdownUI();updatePlanningAvailability();renderPlanning();applyEditState();updateNavState();
}
async function saveGlobalSettings(action='Configuración global actualizada'){
  if(!db||!isAdmin())return;
  cacheGlobalSettings();
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
  planningByPeriod={};
  store.planningByPeriod=planningByPeriod;
  currentProgramIndex=0;
  lastSavedAt=null;


  localStorage.setItem('PAD_UTEQ',JSON.stringify({
    ...store,cfg,answers,programMeta,customPrograms,programOverrides,
    disabledPrograms,programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt
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
    individualEditDisabled:!!store.individualEditDisabled,
    profileResetToken:store.profileResetToken||null,
    profileDeletionToken:store.profileDeletionToken||null,
    deletedByAdmin:false,
    planningByPeriod:JSON.parse(JSON.stringify(planningByPeriod)),
    clientUpdatedAt:Number(store.localUpdatedAt)||Date.now(),
    dataRevision:Number(store.dataRevision)||0,
    updatedAt:serverTimestamp()
  };
}
function scheduleCloudRetry(delay=5000){
  clearTimeout(cloudRetryTimer);
  if(!currentUser||!store.syncPending)return;
  cloudRetryTimer=setTimeout(()=>{
    if(navigator.onLine!==false)syncProfileToCloud({reason:'reintento automático'});
    else scheduleCloudRetry(Math.min(delay*2,30000));
  },delay);
}
async function syncProfileToCloud({reason='guardado automático'}={}){
  if(!db||!currentUser||!remoteProfileLoaded||cloudSyncInFlight)return false;
  cloudSyncInFlight=true;
  const version=Number(store.localUpdatedAt)||Date.now();
  try{
    await setDoc(doc(db,'profiles',currentUser.uid),profileCloudPayload(),{merge:true});
    if((Number(store.localUpdatedAt)||0)<=version){
      store.cloudUpdatedAt=version;
      store.syncPending=false;
      try{
        localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
        saveUserBackup();
      }catch(_){}
    }
    updateCloudStatus('Sincronizado','ok');
    clearTimeout(cloudRetryTimer);
    return true;
  }catch(e){
    console.warn(`Guardado en nube no disponible (${reason})`,e);
    store.syncPending=true;
    try{localStorage.setItem('PAD_UTEQ',JSON.stringify(store));saveUserBackup()}catch(_){}
    updateCloudStatus('Guardado local · nube pendiente','warn');
    scheduleCloudRetry();
    return false;
  }finally{
    cloudSyncInFlight=false;
  }
}
function scheduleCloudProfileSave(){
  if(!db||!currentUser||!remoteProfileLoaded)return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>syncProfileToCloud({reason:'guardado progresivo'}),700);
}
async function forceProfileCheckpointToCloud(reason='checkpoint de seguridad'){
  if(!db||!currentUser)return false;
  try{
    await setDoc(doc(db,'profiles',currentUser.uid),profileCloudPayload(),{merge:true});
    store.cloudUpdatedAt=Number(store.localUpdatedAt)||Date.now();
    store.syncPending=false;
    try{
      localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
      saveUserBackup();
    }catch(_){}
    updateCloudStatus('Sincronizado','ok');
    return true;
  }catch(e){
    console.warn(`No fue posible confirmar ${reason}`,e);
    store.syncPending=true;
    try{
      localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
      saveUserBackup();
    }catch(_){}
    updateCloudStatus('Guardado local seguro · nube pendiente','warn');
    return false;
  }
}


function applyProfileContent(data){
  if(data.profile)store.profile=JSON.parse(JSON.stringify(data.profile));
  if(data.answers)answers=JSON.parse(JSON.stringify(data.answers));
  if(data.programMeta)programMeta=JSON.parse(JSON.stringify(data.programMeta));
  if(data.planningByPeriod&&typeof data.planningByPeriod==='object'){
    planningByPeriod=JSON.parse(JSON.stringify(data.planningByPeriod));
  }
  store.answers=answers;
  store.programMeta=programMeta;
  store.planningByPeriod=planningByPeriod;
}
function renderLoadedProfile(){
  localStorage.setItem('PAD_UTEQ',JSON.stringify({
    ...store,cfg,customPrograms,programOverrides,disabledPrograms,
    programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt
  }));
  saveUserBackup();
  loadProfileValuesOnly();
  renderCurrentProgram();
  renderPlanning();
  updatePlanningAvailability();
  updateProgress();
  applyEditState();
  updateNavState();
}
function restoreUserBackupBeforeCloud(){
  if(!currentUser)return false;
  const backup=readUserBackup();
  if(!backupHasTeacherData(backup))return false;


  applyProfileContent(backup);
  if('submittedPeriod' in backup)store.submittedPeriod=backup.submittedPeriod||null;
  if('finalizedAtMs' in backup)store.finalizedAtMs=Number(backup.finalizedAtMs)||null;
  if('profileResetToken' in backup)store.profileResetToken=backup.profileResetToken||null;
  if('profileDeletionToken' in backup)store.profileDeletionToken=backup.profileDeletionToken||null;
  store.localUpdatedAt=Number(backup.localUpdatedAt)||Number(store.localUpdatedAt)||Date.now();
  store.cloudUpdatedAt=Number(backup.cloudUpdatedAt)||Number(store.cloudUpdatedAt)||0;
  store.dataRevision=Number(backup.dataRevision)||Number(store.dataRevision)||0;
  store.syncPending=!!backup.syncPending;
  currentProgramIndex=0;


  renderLoadedProfile();
  updateCloudStatus('Respaldo local cargado · verificando nube…','warn');
  return true;
}


async function loadRemoteProfile(){
  if(!db||!currentUser)return;
  try{
    const snap=await getDoc(doc(db,'profiles',currentUser.uid));
    if(snap.exists()){
      const d=snap.data()||{};
      const backup=readUserBackup();


      // Una eliminación administrativa explícita prevalece sobre cualquier respaldo local antiguo.
      if(d.deletedByAdmin===true){
        clearUserBackup(currentUser.uid);
        resetLocalTeacherData({keepProfile:false});
        store.profileDeletionToken=d.profileDeletionToken||null;
        store.localUpdatedAt=timestampToMs(d.deletedAt)||Date.now();
        store.cloudUpdatedAt=store.localUpdatedAt;
        store.syncPending=false;
        localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
        remoteProfileLoaded=true;
        updateCloudStatus('Perfil eliminado por Administración · nueva captura disponible','warn');
        toast('Administración eliminó este perfil. Puede iniciar una nueva captura desde cero.');
        return;
      }


      const remoteUpdatedAt=Number(d.clientUpdatedAt)||timestampToMs(d.updatedAt)||0;
      const localUpdatedAt=Number(backup?.localUpdatedAt)||0;
      const remoteRevision=Number(d.dataRevision)||0;
      const localRevision=Number(backup?.dataRevision)||0;
      const remoteResetToken=d.profileResetToken||null;
      const backupResetToken=backup?.profileResetToken||null;
      const remoteAnswers=d.answers&&typeof d.answers==='object'?d.answers:{};
      const remoteProgramMeta=d.programMeta&&typeof d.programMeta==='object'?d.programMeta:{};
      const explicitResetIsNew=
        !!remoteResetToken &&
        remoteResetToken!==backupResetToken &&
        Object.keys(remoteAnswers).length===0 &&
        Object.keys(remoteProgramMeta).length===0;


      const localHasData=backupHasTeacherData(backup);
      const remoteHasData=cloudHasTeacherData(d);


      // Prioridad de recuperación:
      // 1. Una eliminación administrativa explícita ya fue tratada arriba.
      // 2. Un reset administrativo explícito y realmente vacío sí debe respetarse.
      // 3. Una copia local válida NUNCA puede ser reemplazada por una nube vacía accidental.
      // 4. Si ambos lados tienen revisión V62, gana la revisión mayor.
      // 5. Para datos previos a V62, se conserva la comparación por fecha.
      const localIsNewer=!!backup && !explicitResetIsNew && (
        (localHasData && !remoteHasData) ||
        (localRevision>0 && remoteRevision>0 && localRevision>remoteRevision) ||
        (!(localRevision>0 && remoteRevision>0) && localUpdatedAt>remoteUpdatedAt)
      );
      const preserveLocalAgainstEmptyCloud=
        !!backup &&
        localHasData &&
        !remoteHasData &&
        d.deletedByAdmin!==true &&
        !explicitResetIsNew;


      if('individualEditEnabled' in d)store.individualEditEnabled=!!d.individualEditEnabled;
      if('individualEditDisabled' in d)store.individualEditDisabled=!!d.individualEditDisabled;
      if('profileResetToken' in d)store.profileResetToken=d.profileResetToken||null;


      if(localIsNewer || preserveLocalAgainstEmptyCloud){
        applyProfileContent(backup);
        currentProgramIndex=0;
        const localFinal=Number(backup.finalizedAtMs)||0;
        const remoteFinal=Number(d.finalizedAtMs)||0;
        if(localFinal>remoteFinal){
          store.submittedPeriod=backup.submittedPeriod||d.submittedPeriod||null;
          store.finalizedAtMs=localFinal;
        }else{
          store.submittedPeriod=d.submittedPeriod||null;
          store.finalizedAtMs=remoteFinal||null;
        }
        store.localUpdatedAt=localUpdatedAt;
        store.dataRevision=localRevision||Number(store.dataRevision)||0;
        store.syncPending=true;
        renderLoadedProfile();
        remoteProfileLoaded=true;
        updateCloudStatus('Recuperando cambios locales…','warn');
        await syncProfileToCloud({reason:'recuperación de una copia local más reciente'});
      }else{
        applyProfileContent(d);
        if('submittedPeriod' in d)store.submittedPeriod=d.submittedPeriod||null;
        if('finalizedAtMs' in d)store.finalizedAtMs=Number(d.finalizedAtMs)||null;
        store.localUpdatedAt=remoteUpdatedAt||Date.now();
        store.cloudUpdatedAt=remoteUpdatedAt||store.localUpdatedAt;
        store.dataRevision=remoteRevision||Number(store.dataRevision)||0;
        store.syncPending=false;
        renderLoadedProfile();
        remoteProfileLoaded=true;
        updateCloudStatus('Sincronizado','ok');
      }


      if(store.submittedPeriod===cfg.periodo){
        toast('Perfil finalizado. Puede consultarlo e imprimirlo nuevamente. Si requiere editar algo, consulte a su JUCA.');
      }
    }else{
      const backup=readUserBackup();
      if(backupHasTeacherData(backup)){
        // Firestore todavía no contiene el documento, pero existe una copia válida del mismo UID.
        // Se recupera primero y después se intenta reconstruir la copia en nube; nunca se destruye al cerrar sesión.
        applyProfileContent(backup);
        currentProgramIndex=0;
        store.submittedPeriod=backup.submittedPeriod||null;
        store.finalizedAtMs=Number(backup.finalizedAtMs)||null;
        store.profileResetToken=backup.profileResetToken||null;
        store.profileDeletionToken=backup.profileDeletionToken||null;
        store.localUpdatedAt=Number(backup.localUpdatedAt)||Date.now();
        store.cloudUpdatedAt=Number(backup.cloudUpdatedAt)||0;
        store.dataRevision=Number(backup.dataRevision)||Number(store.dataRevision)||0;
        store.syncPending=true;
        renderLoadedProfile();
        remoteProfileLoaded=true;
        updateCloudStatus('Perfil recuperado · reconstruyendo copia en nube…','warn');
        await forceProfileCheckpointToCloud('reconstrucción de perfil remoto desde respaldo local');
      }else{
        resetLocalTeacherData({keepProfile:false});
        remoteProfileLoaded=true;
        updateCloudStatus('Perfil nuevo · sincronización activa','ok');
      }
    }
  }catch(e){
    remoteProfileLoaded=true;
    console.warn('Perfil remoto no disponible',e);
    const backup=readUserBackup();
    if(backup){
      applyProfileContent(backup);
      store.submittedPeriod=backup.submittedPeriod||store.submittedPeriod||null;
      store.finalizedAtMs=Number(backup.finalizedAtMs)||store.finalizedAtMs||null;
      store.localUpdatedAt=Number(backup.localUpdatedAt)||Number(store.localUpdatedAt)||Date.now();
      store.dataRevision=Number(backup.dataRevision)||Number(store.dataRevision)||0;
      store.syncPending=true;
      renderLoadedProfile();
    }
    updateCloudStatus('Modo local · sincronización pendiente','warn');
    scheduleCloudRetry();
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
      // IMPORTANTE:
      // Un snapshot inexistente puede ser temporal (caché vacía, reconexión, latencia o
      // documento todavía no creado). NO debe borrar información local.
      // La única eliminación válida se identifica mediante deletedByAdmin=true.
      if(remoteProfileLoaded&&!isAdmin()){
        const backup=readUserBackup();
        if(backupHasTeacherData(backup)){
          updateCloudStatus('Respaldo local conservado · esperando sincronización','warn');
          store.syncPending=true;
          scheduleCloudRetry();
        }
      }
      return;
    }
    const d=s.data()||{};


    if(d.deletedByAdmin===true){
      if(!isAdmin()){
        clearUserBackup(currentUser?.uid);
        resetLocalTeacherData({keepProfile:false});
        store.profileDeletionToken=d.profileDeletionToken||null;
        localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
        toast('Administración eliminó este perfil. La siguiente captura iniciará desde cero.');
      }
      return;
    }


    const priorPeriod=store.submittedPeriod||null;
    const priorOverride=!!store.individualEditEnabled;
    const priorDisabled=!!store.individualEditDisabled;
    const priorResetToken=store.profileResetToken||null;
    store.submittedPeriod=d.submittedPeriod||null;
    store.finalizedAtMs=Number(d.finalizedAtMs)||null;
    store.individualEditEnabled=!!d.individualEditEnabled;
    store.individualEditDisabled=!!d.individualEditDisabled;
    store.profileResetToken=d.profileResetToken||null;


    const snapshotAnswers=d.answers&&typeof d.answers==='object'?d.answers:{};
    const snapshotProgramMeta=d.programMeta&&typeof d.programMeta==='object'?d.programMeta:{};
    const explicitProgramReset=
      !!store.profileResetToken &&
      priorResetToken!==store.profileResetToken &&
      Object.keys(snapshotAnswers).length===0 &&
      Object.keys(snapshotProgramMeta).length===0;


    if(explicitProgramReset&&!isAdmin()){
      answers={};
      programMeta={};
      store.answers=answers;
      store.programMeta=programMeta;
      currentProgramIndex=0;
      if(d.profile)store.profile=d.profile;
      localStorage.setItem('PAD_UTEQ',JSON.stringify({
        ...store,cfg,answers,programMeta,customPrograms,programOverrides,
        disabledPrograms,programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt
      }));
      saveUserBackup();
      loadProfileValuesOnly();
      renderCurrentProgram();
      updateProgress();
      applyEditState();
      updateNavState();
      toast('Administración eliminó las asignaturas capturadas. El Perfil por programa iniciará desde cero.');
      return;
    }


    if(priorPeriod!==store.submittedPeriod || priorOverride!==store.individualEditEnabled || priorDisabled!==store.individualEditDisabled){
      localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt}));
      const reopenedNow=!priorOverride&&store.individualEditEnabled&&!isAdmin();
      if(reopenedNow){
        resetWorkflowState();
        loadProfileValuesOnly();
        renderCurrentProgram();
        activateViewDirect('perfil');
      }
      applyEditState();updateNavState();
      toast(store.individualEditDisabled
        ?'Administración deshabilitó temporalmente la edición de su perfil.'
        :store.individualEditEnabled
          ?'Administración habilitó la edición únicamente para su perfil.'
          :(store.submittedPeriod===cfg.periodo?'Perfil finalizado. Edición bloqueada.':'El perfil vuelve a respetar los controles generales.'));
    }
  },e=>console.warn('No fue posible escuchar el estado del perfil',e));
}
async function loadTeachersForExport(){
  if(!db||!isAdmin())return [{name:fullName()||'(Profesor sin nombre)',category:store.profile?.categoria||'',answers,programMeta,planningByPeriod,email:currentUser?.email||''}];
  try{
    const snap=await getDocs(collection(db,'profiles'));
    const rows=[];
    snap.forEach(ds=>{
      const d=ds.data();
      if(d.deletedByAdmin===true)return;
      const p=d.profile||{};
      const name=[p.apPat,p.apMat,p.nombres].filter(Boolean).join(' ')||d.displayName||d.email||'(Sin nombre)';
      rows.push({name,category:p.categoria||'',answers:d.answers||{},programMeta:d.programMeta||{},planningByPeriod:d.planningByPeriod||{},email:d.email||'',uid:ds.id,submittedPeriod:d.submittedPeriod||null,finalizedAtMs:Number(d.finalizedAtMs)||null});
    });
    return rows.length?rows:[{name:fullName()||'(Profesor sin nombre)',category:store.profile?.categoria||'',answers,programMeta,planningByPeriod,email:currentUser?.email||''}];
  }catch(e){
    console.warn('No fue posible leer todos los perfiles',e);
    return [{name:fullName()||'(Profesor sin nombre)',category:store.profile?.categoria||'',answers,programMeta,planningByPeriod,email:currentUser?.email||''}];
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
/* V53 · Google Identity Services directo: evita por completo /__/auth/handler de firebaseapp.com */
function googleIdentityReady(){
  return !!(window.google?.accounts?.oauth2?.initTokenClient);
}
function waitForGoogleIdentity(timeoutMs=10000){
  if(googleIdentityReady())return Promise.resolve(true);
  return new Promise(resolve=>{
    const start=Date.now();
    const timer=setInterval(()=>{
      if(googleIdentityReady()){
        clearInterval(timer);resolve(true);return;
      }
      if(Date.now()-start>=timeoutMs){clearInterval(timer);resolve(false)}
    },100);
  });
}
function googleAuthErrorMessage(detail=''){
  const suffix=detail?`\n\n${detail}`:'';
  return `Acceso institucional UTEQ\n\n`+
    `Debes ingresar con una cuenta @${allowedDomain}.\n\n`+
    `Esta plataforma no solicita ni almacena tu contraseña. El acceso se realiza directamente con Google y la sesión se valida en Firebase mediante una credencial de Google; no se utiliza la página de acceso de firebaseapp.com.${suffix}`;
}
async function signInWithGoogleIdentity(){
  if(!googleClientId){
    alert(
      'Falta configurar GOOGLE_CLIENT_ID para el acceso institucional.\\n\\n'+
      'Administración: agregue el Client ID de Google como secreto GOOGLE_CLIENT_ID en GitHub y publique nuevamente.'
    );
    return false;
  }
  const ready=await waitForGoogleIdentity();
  if(!ready){
    alert(googleAuthErrorMessage('No fue posible cargar el servicio de acceso de Google (accounts.google.com). Verifique la conexión o las restricciones de red y vuelva a intentarlo.'));
    return false;
  }


  return await new Promise(resolve=>{
    let settled=false;
    const finish=v=>{if(!settled){settled=true;resolve(v)}};
    try{
      const tokenClient=window.google.accounts.oauth2.initTokenClient({
        client_id:googleClientId,
        scope:'openid email profile',
        include_granted_scopes:true,
        hosted_domain:allowedDomain,
        prompt:'select_account',
        callback:async response=>{
          if(!response||response.error||!response.access_token){
            console.error('Google OAuth response',response);
            alert(googleAuthErrorMessage('Google no devolvió una credencial válida. Vuelva a seleccionar su cuenta institucional.'));
            finish(false);return;
          }
          try{
            const credential=GoogleAuthProvider.credential(null,response.access_token);
            const result=await signInWithCredential(auth,credential);
            const email=String(result.user?.email||'').toLowerCase();
            if(!isInstitutional(email)){
              await signOut(auth);
              alert(googleAuthErrorMessage(`La cuenta seleccionada no pertenece al dominio autorizado @${allowedDomain}.`));
              finish(false);return;
            }
            finish(true);
          }catch(e){
            console.error('Firebase credential sign-in error',e);
            const code=e?.code||'';
            if(code==='auth/network-request-failed'){
              alert(googleAuthErrorMessage('No fue posible validar la credencial con Firebase. Verifique la conexión y vuelva a intentarlo.'));
            }else{
              alert(googleAuthErrorMessage(`No fue posible completar el acceso (${code||'error de autenticación'}).`));
            }
            finish(false);
          }
        },
        error_callback:error=>{
          console.error('Google popup error',error);
          const type=error?.type||'';
          if(type==='popup_failed_to_open'){
            alert(googleAuthErrorMessage('El navegador bloqueó la ventana de Google. Permita ventanas emergentes para igutierrezb.github.io y vuelva a intentarlo.'));
          }else if(type==='popup_closed'){
            // El usuario cerró la ventana; no convertirlo en un error técnico.
          }else{
            alert(googleAuthErrorMessage('No fue posible abrir el selector de cuenta de Google. Vuelva a intentarlo.'));
          }
          finish(false);
        }
      });
      // Debe ejecutarse desde el clic del usuario para que Safari/Chrome no lo bloqueen.
      tokenClient.requestAccessToken({prompt:'select_account'});
    }catch(e){
      console.error('Google Identity Services init error',e);
      alert(googleAuthErrorMessage('No fue posible iniciar el selector de cuenta de Google.'));
      finish(false);
    }
  });
}


function updateAuthUI(){
  const gateStatus=$('authStatusGate'),topStatus=$('authStatus');
  if(authConfigured()){
    const loadingProfile=!!currentUser&&!authReady;
    gateStatus.textContent=loadingProfile
      ?`${currentUser.email} · recuperando perfil…`
      :(currentUser?`${currentUser.email}${isAdmin()?' · administrador':''}`:`Sin sesión · use una cuenta @${allowedDomain}`);
    topStatus.textContent=loadingProfile
      ?`${currentUser.email} · recuperando perfil…`
      :(currentUser?`${currentUser.email}${isAdmin()?' · administrador':''}`:`Sin sesión · use una cuenta @${allowedDomain}`);
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
  showApp(!!currentUser && authReady);
}
window.signIn=async function(){
  if(!authConfigured()){
    alert('Firebase no está configurado correctamente. Revise apiKey, projectId y appId.');
    return;
  }
  // V53: Google autentica directamente y entrega un access token.
  // Firebase recibe esa credencial mediante signInWithCredential().
  // Por diseño NO se abre perfil-profesor-din.firebaseapp.com/__/auth/handler.
  await signInWithGoogleIdentity();
}
window.signOutApp=async function(){
  const uid=currentUser?.uid||null;


  try{
    if(uid){
      // Capturar texto visible aún pendiente del debounce.
      try{
        if($('apPat')){
          const extra={};
          document.querySelectorAll('[data-g]').forEach(x=>extra[x.dataset.g]=x.value.trim());
          store.profile={
            apPat:$('apPat')?.value.trim()||store.profile?.apPat||'',
            apMat:$('apMat')?.value.trim()||store.profile?.apMat||'',
            nombres:$('nombres')?.value.trim()||store.profile?.nombres||'',
            categoria:$('categoria')?.value||store.profile?.categoria||'',
            gradoAcademico:$('gradoAcademico')?.value||store.profile?.gradoAcademico||'',
            extra
          };
        }
        if(planningEnabled()&&$('commissionsBlock')){
          try{collectPlanning()}catch(_){}
        }
      }catch(e){
        console.warn('No fue posible capturar el último estado visual antes del cierre',e);
      }


      // Nueva revisión local del estado final.
      try{persist({touch:true,schedule:false})}
      catch(e){console.warn('Checkpoint local previo al cierre',e)}
      saveUserBackup();


      // Guardado directo a Firestore; no depende de remoteProfileLoaded.
      if(db&&currentUser){
        let timeoutId;
        try{
          await Promise.race([
            forceProfileCheckpointToCloud('checkpoint final antes de cerrar sesión'),
            new Promise(resolve=>{
              timeoutId=setTimeout(()=>{
                console.warn('La confirmación de nube excedió 5 s; se conserva el respaldo por UID.');
                resolve(false);
              },5000);
            })
          ]);
        }finally{
          if(timeoutId)clearTimeout(timeoutId);
        }
      }


      // Reafirmar respaldo persistente del UID.
      saveUserBackup();
    }


    if(auth)await signOut(auth);
  }finally{
    // Se elimina sólo la copia de trabajo compartida por privacidad.
    // Se conservan PAD_UTEQ_PROFILE_<UID> y PAD_UTEQ_GLOBAL_SETTINGS.
    localStorage.removeItem('PAD_UTEQ');


    try{
      [...Object.keys(sessionStorage)]
        .filter(k=>k.startsWith('PAD_CAPTURE_ORIENTATION_'))
        .forEach(k=>sessionStorage.removeItem(k));
    }catch(_){}


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
    authReady=false;


    if(user&&!isInstitutional(user.email||'')){
      await signOut(auth);
      currentUser=null;
      updateAuthUI();
      showInstitutionalAccessMessage(`La cuenta seleccionada no pertenece al dominio autorizado @${allowedDomain}.`);
      return;
    }


    if(!currentUser){
      updateAuthUI();
      updateCountdownUI();
      return;
    }


    // Recuperar primero la última copia local del MISMO UID.
    restoreUserBackupBeforeCloud();
    updateAuthUI();


    try{
      await initCloud();
    }finally{
      authReady=true;
      updateAuthUI();
      updateCountdownUI();
    }
  });
}




function updateStepLabels(){
  if($('profileStepBadge'))$('profileStepBadge').textContent='Paso 1 de 3';
  if($('captureStepKicker'))$('captureStepKicker').textContent='Paso 2 de 3';
  if($('reviewStepKicker'))$('reviewStepKicker').textContent='Paso 3 de 3';
}
function updatePlanningAvailability(){
  const enabled=planningEnabled();
  const block=$('commissionsBlock');
  if(block){
    block.classList.toggle('hidden',!enabled);
    block.style.display=enabled?'':'none';
  }
  updateStepLabels();


  const st=$('planningAdminStatus');
  const btn=$('planningToggleBtn');
  if(st){
    st.textContent=enabled?'Habilitado · obligatorio':'Deshabilitado';
    st.className=`planning-admin-status ${enabled?'enabled':'disabled'}`;
  }
  if(btn){
    btn.textContent=enabled?'Deshabilitar apartado de Comisiones':'Habilitar apartado de Comisiones';
    btn.className=`planning-toggle-btn ${enabled?'disable':'enable'}`;
  }
}
window.togglePlanningPage=async function(){
  if(!isAdmin())return;
  const next=!cfg.planningEnabled;
  const ok=confirm(
    next
      ?'¿Habilitar el apartado 4 de Comisiones?\n\nSi se habilita, las preguntas sobre comisiones autorizadas y proyectos avalados serán obligatorias; ambas permiten seleccionar No aplica. La información NO se incluirá en el PDF.'
      :'¿Deshabilitar el apartado 4 de Comisiones?\n\nLa información ya capturada se conservará, pero dejará de mostrarse y de ser obligatoria.'
  );
  if(!ok)return;
  cfg.planningEnabled=next;
  persist();
  await saveGlobalSettings(next?'Apartado de Comisiones habilitado':'Apartado de Comisiones deshabilitado');
  updatePlanningAvailability();
  renderPlanning();
  renderAdmin();
  toast(next?'Comisiones habilitadas.':'Comisiones deshabilitadas.');
}


function renderCommissionScheduleGrid(commission,index){
  const selected=new Set(commission.reservedSlots||[]);
  return `<div class="commission-schedule-grid ${commission.scheduleRequired==='yes'?'':'hidden'}">
    <div class="commission-schedule-caption">Bloques específicos de atención</div>
    <div class="compact-schedule">
      ${PLANNING_DAYS.map(day=>`<div class="compact-day">
        <b>${day.label}</b>
        <div class="compact-slots">
          ${PLANNING_SLOTS.map(([start,end],slotIndex)=>{
            const key=planningSlotKey(day.key,start,end);
            return `<label class="compact-slot ${slotIndex===PLANNING_SLOTS.length-1?'late':''}" title="${day.label} ${start}-${end}">
              <input type="checkbox" data-commission-index="${index}" data-commission-slot="${key}" ${selected.has(key)?'checked':''}>
              <span>${start.replace(':00','')} a ${end.replace(':00','')}</span>
            </label>`;
          }).join('')}
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}
function renderCommissionList(record){
  const rows=(record.commissions||[]).length?record.commissions:[emptyCommission()];
  return rows.map((c,i)=>`<div class="commission-entry" data-commission-row="${i}">
    <div class="commission-entry-top">
      <span class="commission-entry-number">${i+1}</span>
      <label class="commission-name-field">Nombre de la comisión
        <input data-commission-name="${i}" value="${escapeHtml(c.name||'')}" placeholder="Ej. Enlace de calidad, Enlace de tutoría, Coordinación de visitas..." onfocus="this.dataset.ph=this.placeholder;this.placeholder=''" onblur="if(!this.value)this.placeholder=this.dataset.ph||'Ej. Enlace de calidad, Enlace de tutoría, Coordinación de visitas...'">
      </label>
      <label class="commission-hours-field">Horas autorizadas
        <input data-commission-hours="${i}" type="number" min="0" step="0.5" value="${escapeHtml(String(c.authorizedHours||''))}" placeholder="Ej. 3">
      </label>
      <button type="button" class="commission-remove-btn" onclick="removePlanningCommission(${i})" ${rows.length===1?'disabled':''}>Eliminar</button>
    </div>
    <div class="commission-schedule-question">
      <span>¿Requiere un bloque específico de horas en la semana?</span>
      <label class="mini-choice yes"><input type="radio" name="commissionSchedule_${i}" value="yes" ${c.scheduleRequired==='yes'?'checked':''} onchange="commissionScheduleChanged(${i},'yes')"> Sí</label>
      <label class="mini-choice no"><input type="radio" name="commissionSchedule_${i}" value="no" ${c.scheduleRequired!=='yes'?'checked':''} onchange="commissionScheduleChanged(${i},'no')"> No</label>
      <div class="commission-inline-actions">
        <button type="button" class="commission-inline-save-btn" onclick="savePlanningCommission(${i})">✓ Guardar</button>
        <button type="button" class="commission-inline-add-btn" onclick="addPlanningCommission()">＋ Agregar nueva comisión</button>
      </div>
    </div>
    ${renderCommissionScheduleGrid(c,i)}
  </div>`).join('');
}
function renderPlanning(){
  const root=$('commissionsBlock');
  if(!root)return;
  const record=currentPlanningRecord(true);


  root.querySelectorAll('input[name="planningCommissionMode"]').forEach(x=>x.checked=x.value===record.commissionMode);
  root.querySelectorAll('input[name="planningProjectMode"]').forEach(x=>x.checked=x.value===record.projectMode);


  if($('planningCommissionList'))$('planningCommissionList').innerHTML=renderCommissionList(record);
  if($('planningProjectName'))$('planningProjectName').value=record.projectName||'';
  if($('planningProjectRole'))$('planningProjectRole').value=record.projectRole||'';
  if($('planningProjectHours'))$('planningProjectHours').value=record.projectHours||'';
  if($('planningProjectReference'))$('planningProjectReference').value=record.projectReference||'';
  if($('planningComments'))$('planningComments').value=record.comments||'';


  updatePlanningConditionalUI();
  updatePlanningAvailability();
}
function updatePlanningConditionalUI(){
  const record=currentPlanningRecord(true);
  if($('planningCommissionsFields'))$('planningCommissionsFields').classList.toggle('hidden',record.commissionMode!=='yes');
  if($('planningProjectFields'))$('planningProjectFields').classList.toggle('hidden',record.projectMode!=='yes');
}
function collectPlanning(){
  const record=currentPlanningRecord(true);
  record.commissionMode=document.querySelector('input[name="planningCommissionMode"]:checked')?.value||'';
  record.projectMode=document.querySelector('input[name="planningProjectMode"]:checked')?.value||'';


  record.commissions=[...document.querySelectorAll('[data-commission-row]')].map(row=>{
    const i=Number(row.dataset.commissionRow);
    const prev=(record.commissions||[])[i]||emptyCommission();
    return {
      name:row.querySelector(`[data-commission-name="${i}"]`)?.value.trim()||'',
      authorizedHours:row.querySelector(`[data-commission-hours="${i}"]`)?.value.trim()||'',
      scheduleRequired:row.querySelector(`input[name="commissionSchedule_${i}"]:checked`)?.value||prev.scheduleRequired||'no',
      reservedSlots:[...row.querySelectorAll('[data-commission-slot]:checked')].map(x=>x.dataset.commissionSlot)
    };
  });
  if(!record.commissions.length)record.commissions=[emptyCommission()];


  record.projectName=$('planningProjectName')?.value.trim()||'';
  record.projectRole=$('planningProjectRole')?.value.trim()||'';
  record.projectHours=$('planningProjectHours')?.value.trim()||'';
  record.projectReference=$('planningProjectReference')?.value.trim()||'';
  record.comments=$('planningComments')?.value.trim()||'';
  record.updatedAtMs=Date.now();
  planningByPeriod[cfg.periodo]=record;
  store.planningByPeriod=planningByPeriod;
  return record;
}
window.planningModeChanged=function(){
  collectPlanning();
  updatePlanningConditionalUI();
  persist();
  updateNavState();
}
window.commissionScheduleChanged=function(index,value){
  const record=collectPlanning();
  if(!record.commissions[index])return;
  record.commissions[index].scheduleRequired=value;
  if(value!=='yes')record.commissions[index].reservedSlots=[];
  planningByPeriod[cfg.periodo]=record;
  persist();
  renderPlanning();
}
window.savePlanningCommission=function(index){
  if(!planningEnabled()){toast('El apartado de Comisiones está deshabilitado.');return false}
  if(!planningEditingAllowed()){toast('La edición está cerrada.');return false}
  const record=collectPlanning();
  planningByPeriod[cfg.periodo]=record;
  persist();
  toast(`Comisión ${Number(index)+1} guardada.`);
  return true;
}
window.addPlanningCommission=function(){
  if(!planningEditingAllowed())return;
  const record=collectPlanning();
  record.commissions.push(emptyCommission());
  planningByPeriod[cfg.periodo]=record;
  persist();
  renderPlanning();
  requestAnimationFrame(()=>{
    document.querySelector(`[data-commission-name="${record.commissions.length-1}"]`)?.focus();
  });
}
window.removePlanningCommission=function(index){
  if(!planningEditingAllowed())return;
  const record=collectPlanning();
  if(record.commissions.length<=1)return;
  record.commissions.splice(index,1);
  planningByPeriod[cfg.periodo]=record;
  persist();
  renderPlanning();
}
function clearPlanningValidation(){
  document.querySelectorAll('#commissionsBlock .planning-question-error').forEach(x=>x.classList.remove('planning-question-error'));
}
function validatePlanning(opts={}){
  if(!planningEnabled())return {ok:true,errors:[],firstCard:null};
  const record=opts.collect===false?currentPlanningRecord(true):collectPlanning();
  const errors=[];
  let firstCard=null;
  const mark=(id,msg)=>{
    errors.push(msg);
    if(!firstCard)firstCard=$(id);
    if(opts.visual&&$(id))$(id).classList.add('planning-question-error');
  };
  if(opts.visual)clearPlanningValidation();


  if(!['yes','na'].includes(record.commissionMode)){
    mark('planningCommissionsCard','Indique si tiene comisiones autorizadas por la Dirección o seleccione No aplica.');
  }else if(record.commissionMode==='yes'){
    const commissions=(record.commissions||[]);
    if(!commissions.length)mark('planningCommissionsCard','Agregue al menos una comisión autorizada.');
    commissions.forEach((c,i)=>{
      if(!String(c.name||'').trim())mark('planningCommissionsCard',`Comisión ${i+1}: capture el nombre.`);
      if(String(c.authorizedHours||'').trim()==='')mark('planningCommissionsCard',`Comisión ${i+1}: capture las horas autorizadas.`);
      if(c.scheduleRequired==='yes' && !(c.reservedSlots||[]).length){
        mark('planningCommissionsCard',`Comisión ${i+1}: seleccione al menos un día y horario específico.`);
      }
    });
  }


  if(!['yes','na'].includes(record.projectMode)){
    mark('planningProjectCard','Indique si participa en un proyecto avalado por la Universidad o seleccione No aplica.');
  }else if(record.projectMode==='yes'){
    if(!record.projectName)mark('planningProjectCard','Capture el nombre del proyecto.');
    if(!record.projectRole)mark('planningProjectCard','Capture la responsabilidad que ocupa en el proyecto.');
    if(String(record.projectHours||'').trim()==='')mark('planningProjectCard','Capture las horas autorizadas para el proyecto.');
  }


  if(opts.visual&&firstCard){
    requestAnimationFrame(()=>firstCard.scrollIntoView({behavior:'smooth',block:'center'}));
  }
  return {ok:!errors.length,errors,firstCard};
}
window.savePlanning=async function(show=false){
  if(!planningEnabled()){toast('El apartado de Comisiones está deshabilitado.');return false}
  if(!planningEditingAllowed()){toast('La edición está cerrada.');return false}
  const v=validatePlanning({visual:true});
  if(!v.ok){
    if($('planningErrors'))$('planningErrors').innerHTML=statusBox(v.errors,'Complete la información obligatoria de Comisiones.');
    return false;
  }
  const record=currentPlanningRecord(true);
  record.completedAtMs=Date.now();
  record.updatedAtMs=Date.now();
  planningByPeriod[cfg.periodo]=record;
  if($('planningErrors'))$('planningErrors').innerHTML='<div class="status-box ok"><b>Comisiones guardadas.</b><br>La información queda disponible para consulta y para el concentrado administrativo.</div>';
  persist();
  await writeAudit('Comisiones y consideraciones académicas guardadas');
  updateNavState();
  if(show)toast('Comisiones guardadas.');
  return true;
}




function captureOrientationSessionKey(){
  return `PAD_CAPTURE_ORIENTATION_${currentUser?.uid||'guest'}_${String(cfg.periodo||'').replace(/\s+/g,'_')}`;
}
function shouldShowCaptureOrientation(){
  if(isAdmin()||(submissionLockedForCurrentPeriod()&&!individualEditOverride()))return false;
  try{return sessionStorage.getItem(captureOrientationSessionKey())!=='1'}catch(_){return true}
}
function showCaptureOrientationIfNeeded(){
  if(!shouldShowCaptureOrientation())return;
  const modal=$('captureOrientationModal');
  if(!modal)return;
  modal.classList.remove('hidden');
  document.body.classList.add('capture-orientation-open');
}
window.acceptCaptureOrientation=function(){
  try{sessionStorage.setItem(captureOrientationSessionKey(),'1')}catch(_){}
  const modal=$('captureOrientationModal');
  if(modal)modal.classList.add('hidden');
  document.body.classList.remove('capture-orientation-open');
}


window.go=function(id,force=false){
  if(id==='admin'&&!isAdmin()){
    toast('Administración disponible únicamente para ivan.gutierrez@uteq.edu.mx');
    return false;
  }

  const sequential=sequentialProfessorMode();

  if(id==='captura'&&sequential&&!workflowState.profileConfirmed){
    activateViewDirect('perfil');
    const p=validateProfile({visual:true,focusFirst:false});
    if($('profileErrors')&&!p.ok){
      $('profileErrors').innerHTML=statusBox(p.errors,'Confirme primero los datos del profesor.');
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

  const sequential=sequentialProfessorMode();
  [pBtn,cBtn,rBtn].forEach(btn=>{
    if(!btn)return;
    btn.disabled=sequential;
    btn.classList.toggle('flow-indicator-only',sequential);
    btn.classList.toggle('locked',sequential);
    btn.setAttribute('aria-disabled',sequential?'true':'false');
    btn.title=sequential
      ?'Indicador de avance. Durante la edición use los botones inferiores.'
      :'';
  });
}

function buildProfileRows(){
  const f=['Licenciatura o TSU','Posgrado 1','Posgrado 2','Posgrado 3','Posgrado 4','Posgrado 5','Posgrado 6'];
  $('formacion').innerHTML=f.map((lab,i)=>`<div class="form-row two"><div class="row-label">${lab}${i===0?' *':''}</div><input placeholder="${i===0?'Ej. Licenciatura en Ingeniería Industrial':'Ej. Maestría en Educación'}" data-g="f${i+1}a"><input placeholder="Ej. Universidad Tecnológica de Querétaro" data-g="f${i+1}b"></div>`).join('');
  $('docencia').innerHTML=Array.from({length:4},(_,i)=>`<div class="form-row two"><div class="row-label">Institución ${i+1}${i===0?' *':''}</div><input placeholder="Ej. UTEQ" data-g="d${i+1}a"><input placeholder="Ej. 2023 - 2025" data-g="d${i+1}c"></div>`).join('');
  $('laboral').innerHTML=Array.from({length:5},(_,i)=>`<div class="form-row"><div class="row-label">Organización ${i+1}${i===0?' *':''}</div><input placeholder="Ej. Empresa / institución" data-g="l${i+1}a"><input placeholder="Ej. Jefe de área" data-g="l${i+1}b"><input placeholder="Ej. 2020 - 2023" data-g="l${i+1}c"></div>`).join('');
}
function loadProfileValuesOnly(){
  if($('gradoAcademico'))$('gradoAcademico').value=store.profile?.gradoAcademico||'';
  const p=store.profile||{};
  ['apPat','apMat','nombres','categoria'].forEach(x=>{if($(x))$(x).value=p[x]||''});
  document.querySelectorAll('[data-g]').forEach(x=>x.value=(p.extra||{})[x.dataset.g]||'');
}
function loadProfile(){
  if(!$('categoria').options.length)CATEGORIES.forEach(c=>$('categoria').add(new Option(c,c)));
  buildProfileRows();
  loadProfileValuesOnly();
}
function profileFromInputs(){
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
}
function captureProfileLocallyWithoutCloud(){
  if(!currentUser||!editingAllowed())return;

  const before=JSON.stringify({
    profile:store.profile||{},
    planningByPeriod:planningByPeriod||{}
  });

  store.profile=profileFromInputs();
  if(planningEnabled()){
    try{collectPlanning()}catch(_){}
  }

  const after=JSON.stringify({
    profile:store.profile||{},
    planningByPeriod:planningByPeriod||{}
  });

  const now=Date.now();
  store.answers=answers;
  store.programMeta=programMeta;
  store.planningByPeriod=planningByPeriod;
  store.lastSavedAt=now;
  store.currentProgramIndex=0;

  if(before!==after){
    store.localUpdatedAt=now;
    store.dataRevision=(Number(store.dataRevision)||0)+1;
    store.syncPending=true;
  }

  try{
    localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
    saveUserBackup();
  }catch(_){}
}

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
  const p=profileFromInputs(),e=p.extra||{},checks=requiredProfileChecks(p,e);
  const errors=checks.filter(x=>x.missing).map(x=>x.msg);
  if(opts.visual)highlightRequired(checks,!!opts.focusFirst);
  return{ok:!errors.length,errors,checks}
}

window.saveSection=function(){if(!requireEditing())return;collectProfile();writeAudit('Sección de perfil guardada');toast('Avances guardados.')}
window.continueToCapture=async function(){
  if(!requireEditing())return false;

  try{document.activeElement?.blur()}catch(_){}

  const v=validateProfile({visual:true,focusFirst:false});
  const errorBox=$('profileErrors');
  if(errorBox)errorBox.innerHTML=v.ok?'':statusBox(v.errors,'Complete los datos obligatorios antes de continuar.');

  if(!v.ok){
    const missing=v.checks.filter(x=>x.missing&&x.el);
    const first=missing[0]?.el;

    if(first){
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

  if(planningEnabled()){
    const planningCheck=validatePlanning({visual:true});
    if(!planningCheck.ok){
      if($('planningErrors'))$('planningErrors').innerHTML=statusBox(
        planningCheck.errors,
        'Complete Comisiones o seleccione No aplica antes de continuar.'
      );
      toast('Complete el apartado de Comisiones antes de pasar al Perfil por programa.');
      return false;
    }

    const planningSaved=await savePlanning(false);
    if(!planningSaved)return false;
  }

  clearRequiredHighlights();
  document.querySelectorAll('#perfil .mobile-required-focus').forEach(el=>el.classList.remove('mobile-required-focus'));

  collectProfile();
  persist();

  if(cloudAvailable&&currentUser){
    await forceProfileCheckpointToCloud('avance de Datos del profesor a Perfil por programa');
  }

  workflowState.profileConfirmed=true;
  workflowState.expectedProgramIndex=0;
  workflowState.reviewUnlocked=false;
  currentProgramIndex=0;
  store.currentProgramIndex=0;
  persist({touch:false,schedule:false});
  renderCurrentProgram();

  activateViewDirect('captura');
  const capture=$('captura');

  requestAnimationFrame(()=>{
    const top=(capture?.offsetTop||0)-48;
    window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
  });

  updateNavState();
  requestAnimationFrame(()=>{
    try{sessionStorage.removeItem(captureOrientationSessionKey())}catch(_){}
    showCaptureOrientationIfNeeded();
  });
  return true;
}

function originCode(a){return(a.origins||[]).join('')}
function originTooltip(code){
  const labels={
    '1':'1 = Formación académica',
    '2':'2 = Experiencia docente',
    '3':'3 = Experiencia laboral',
    '12':'12 = Formación académica + Experiencia docente',
    '13':'13 = Formación académica + Experiencia laboral',
    '23':'23 = Experiencia docente + Experiencia laboral',
    '123':'123 = Formación académica + Experiencia docente + Experiencia laboral'
  };
  return labels[String(code)]||String(code);
}
function normalizeOrigins(code){return String(code).split('').map(Number)}
window.setEnabled=function(pid,s,c,name,on){
  if(!requireEditing())return;
  if(isEnglish(name))return;
  let r=getAns(pid,s,c,name);


  if(!on){
    // Deshabilitar es una decisión individual; nunca se replica.
    r.status='off';
    r.origins=[];
    r.ideal=false;
    answers[key(pid,s,c)]=r;
    setCoordinatorValue(pid,s,c,false);
    persist();
    renderCurrentProgram();
    return;
  }


  if(r.status==='off'){
    const peer=bestLinkedAnswer(pid,s,c,name);
    if(peer){
      const source=getAns(peer.pid,peer.s,peer.c,peer.name);
      r={
        status:source.status==='off'?'pending':source.status,
        origins:[...(source.origins||[])],
        ideal:!!source.ideal
      };
      setCoordinatorValue(pid,s,c,coordinatorValue(peer.pid,peer.s,peer.c));
    }else{
      r={status:'pending',origins:[],ideal:false};
      setCoordinatorValue(pid,s,c,false);
    }
  }


  answers[key(pid,s,c)]=r;
  replicateCommon(pid,s,c,r);
  replicateLinkedAnswer(pid,s,c,name,r);
  replicateLinkedCoordinator(pid,s,c,name,coordinatorValue(pid,s,c));
  persist();
  renderCurrentProgram();
}
window.setCompetence=function(pid,s,c,name,level){if(!requireEditing())return;const r=getAns(pid,s,c,name);if(['off','na'].includes(r.status))return;r.status=level;r.origins=[];answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);replicateLinkedAnswer(pid,s,c,name,r);persist();renderCurrentProgram()}
window.setOriginCode=function(pid,s,c,name,code){if(!requireEditing())return;const r=getAns(pid,s,c,name);if(!['X','XX'].includes(r.status))return;r.origins=normalizeOrigins(code);answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);replicateLinkedAnswer(pid,s,c,name,r);persist();renderCurrentProgram()}
window.toggleIdeal=function(pid,s,c,name){if(!requireEditing())return;const r=getAns(pid,s,c,name);if(!['X','XX'].includes(r.status)||(r.origins||[]).length===0){toast('Primero seleccione competencia y área de conocimiento.');return}r.ideal=!r.ideal;answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);replicateLinkedAnswer(pid,s,c,name,r);persist();renderCurrentProgram()}
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
    const current=getAns(other,s,tc,targetSem[tc]);
    if(current.status==='off')return;
    answers[key(other,s,tc)]={status:r.status,origins:[...(r.origins||[])],ideal:!!r.ideal};
    synced++;
  });
  return synced;
}




function strictSubjectKey(name){
  return String(name||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('es-MX');
}
function isProjectIntegrator(name){
  return /^proyecto integrador(?:\s|$)/i.test(String(name||'').trim());
}
function courseLocation(pid,s,c){
  const pr=allPrograms().find(x=>x.id===pid);
  const name=pr?.semesters?.[s]?.[c];
  return name===undefined?null:{pid,s,c,name};
}
function automaticSameNameLocations(pid,s,c,name){
  if(!name||isProjectIntegrator(name))return [];
  const wanted=strictSubjectKey(name),found=[];
  allPrograms().forEach(pr=>pr.semesters.forEach((sem,ss)=>sem.forEach((n,cc)=>{
    if(isProjectIntegrator(n))return;
    if(strictSubjectKey(n)===wanted && !(pr.id===pid&&ss===s&&cc===c)){
      found.push({pid:pr.id,s:ss,c:cc,name:n});
    }
  })));
  return found;
}
function normalizeTransversalEndpoint(ep){
  if(!ep||typeof ep!=='object')return null;
  const pid=String(ep.pid||'');
  const s=Number(ep.s),c=Number(ep.c);
  if(!pid||!Number.isInteger(s)||!Number.isInteger(c))return null;
  return courseLocation(pid,s,c);
}
function explicitTransversalPeers(pid,s,c,name){
  if(isProjectIntegrator(name))return [];
  const peers=[];
  transversalRules.forEach(rule=>{
    if(rule.source&&rule.target){
      const a=normalizeTransversalEndpoint(rule.source);
      const b=normalizeTransversalEndpoint(rule.target);
      if(!a||!b||isProjectIntegrator(a.name)||isProjectIntegrator(b.name))return;
      if(a.pid===pid&&a.s===s&&a.c===c)peers.push(b);
      else if(b.pid===pid&&b.s===s&&b.c===c)peers.push(a);
      return;
    }


    // Compatibilidad con las reglas creadas en V59.
    if(rule.subjectNormalized){
      const ids=[rule.sourceProgramId,...(rule.targetProgramIds||[])];
      if(!ids.includes(pid) || normalizeSubjectName(name)!==rule.subjectNormalized)return;
      ids.forEach(id=>{
        if(id===pid)return;
        const pr=allPrograms().find(x=>x.id===id);
        pr?.semesters?.forEach((sem,ss)=>sem.forEach((n,cc)=>{
          if(!isProjectIntegrator(n)&&normalizeSubjectName(n)===rule.subjectNormalized){
            peers.push({pid:id,s:ss,c:cc,name:n});
          }
        }));
      });
    }
  });
  return peers;
}
function linkedCourseLocations(pid,s,c,name){
  if(isProjectIntegrator(name))return [];
  const seen=new Set(),out=[];
  [...automaticSameNameLocations(pid,s,c,name),...explicitTransversalPeers(pid,s,c,name)].forEach(loc=>{
    const k=`${loc.pid}|${loc.s}|${loc.c}`;
    if(k===`${pid}|${s}|${c}`||seen.has(k))return;
    seen.add(k);out.push(loc);
  });
  return out;
}
function setCoordinatorValue(pid,s,c,checked){
  programMeta[pid]=programMeta[pid]||{};
  let arr=programMeta[pid].coordinators||[];
  const id=`${s}|${c}`;
  arr=checked?[...new Set([...arr,id])]:arr.filter(x=>x!==id);
  programMeta[pid].coordinators=arr;
}
function coordinatorValue(pid,s,c){
  return !!(((programMeta[pid]||{}).coordinators||[]).includes(`${s}|${c}`));
}
function bestLinkedAnswer(pid,s,c,name){
  const peers=linkedCourseLocations(pid,s,c,name);
  const complete=peers.find(loc=>{
    const a=getAns(loc.pid,loc.s,loc.c,loc.name);
    return ['X','XX'].includes(a.status)&&(a.origins||[]).length;
  });
  if(complete)return complete;
  return peers.find(loc=>getAns(loc.pid,loc.s,loc.c,loc.name).status!=='off')||null;
}
function replicateLinkedAnswer(pid,s,c,name,r){
  if(isProjectIntegrator(name))return 0;
  let synced=0;
  linkedCourseLocations(pid,s,c,name).forEach(loc=>{
    const current=getAns(loc.pid,loc.s,loc.c,loc.name);
    // Una materia deshabilitada intencionalmente queda independiente.
    if(current.status==='off')return;
    answers[key(loc.pid,loc.s,loc.c)]={
      status:r.status,
      origins:[...(r.origins||[])],
      ideal:!!r.ideal
    };
    synced++;
  });
  return synced;
}
function replicateLinkedCoordinator(pid,s,c,name,checked){
  if(isProjectIntegrator(name))return 0;
  let synced=0;
  linkedCourseLocations(pid,s,c,name).forEach(loc=>{
    const current=getAns(loc.pid,loc.s,loc.c,loc.name);
    if(current.status==='off')return;
    setCoordinatorValue(loc.pid,loc.s,loc.c,checked);
    synced++;
  });
  return synced;
}
function courseTransversalBadge(pid,s,c,name){
  if(isProjectIntegrator(name))return '';
  const peers=linkedCourseLocations(pid,s,c,name);
  if(!peers.length)return '';
  const labels=[...new Set(peers.map(loc=>{
    const pr=allPrograms().find(x=>x.id===loc.pid);
    return pr?`${programAcronym(pr)} · ${loc.s+1}.°`:loc.pid;
  }))];
  return `<span class="transversal-course-badge" title="Respuesta vinculada con: ${escapeHtml(labels.join(', '))}">↔ Transversal</span>`;
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
      ${groups.map(g=>`<button type="button" class="capture-error-group" onclick="goToCaptureIssue(${g.pi},${g.s},${g.items[0].c},'${g.items[0].type}')">
        <strong>${escapeHtml(g.programName)}</strong>
        <span>${g.s+1}.° cuatrimestre · ${g.items.length} pendiente${g.items.length===1?'':'s'}</span>
        <small>${g.items.slice(0,3).map(x=>escapeHtml(subjectCase(x.name))).join(' · ')}${g.items.length>3?' · …':''}</small>
      </button>`).join('')}
    </div>
  </div>`;
}
function focusExactCaptureIssue(issue){
  if(!issue)return;
  document.querySelectorAll('.exact-missing-focus').forEach(el=>el.classList.remove('exact-missing-focus'));
  const row=document.querySelector(`[data-course-loc="${issue.pi}|${issue.s}|${issue.c}"]`);
  if(!row)return;
  const exact=issue.type==='area'
    ?row.querySelector('.area-buttons')
    :issue.type==='competence'
      ?row.querySelector('.comp-buttons')
      :row;
  row.scrollIntoView({behavior:'smooth',block:'center'});
  (exact||row).classList.add('exact-missing-focus');
  setTimeout(()=>{(exact||row).classList.remove('exact-missing-focus')},4500);
}
window.goToCaptureIssue=function(pi,s,c,type='competence'){
  const target=captureIssues().find(x=>x.pi===Number(pi)&&x.s===Number(s)&&x.c===Number(c)&&x.type===type);
  if(!target){
    toast('Ese pendiente ya fue corregido.');
    refreshCaptureErrorState();
    return;
  }

  currentProgramIndex=target.pi;
  workflowState.expectedProgramIndex=target.pi;
  workflowState.reviewUnlocked=false;
  persist({touch:false,schedule:false});
  activateViewDirect('captura');
  renderCurrentProgram();
  requestAnimationFrame(()=>focusExactCaptureIssue(target));
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
  const [s,c]=String(id).split('|').map(Number);
  const pr=allPrograms().find(x=>x.id===pid);
  const name=pr?.semesters?.[s]?.[c]||'';
  setCoordinatorValue(pid,s,c,checked);
  replicateLinkedCoordinator(pid,s,c,name,checked);
  persist();
  renderCurrentProgram();
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
  requestAnimationFrame(()=>focusExactCaptureIssue(mapped[0]));
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
        <span><strong>Revise cada materia</strong> y márquela como <strong>apagada</strong> si usted no puede impartir esa asignatura. <strong>Al imprimir, la asignatura quedará vacía en el formato.</strong> Si usted puede impartirla, <strong>déjela habilitada</strong> y seleccione su <strong>nivel de competencia</strong> y su <strong>área de conocimiento</strong>.</span>
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


function adjustSemesterColumnWidths(){
  document.querySelectorAll('.semester-card').forEach(card=>{
    card.classList.remove('needs-wide-subjects');
    const names=[...card.querySelectorAll('.course .name')].filter(el=>!el.closest('.na-clean'));
    const needsMore=names.some(el=>{
      const cs=getComputedStyle(el);
      const lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.15||12;
      return el.scrollHeight>(lh*2.12);
    });
    if(needsMore)card.classList.add('needs-wide-subjects');
  });
}
function renderCurrentProgram(){
  const totalPrograms=programs().length;
  if(!totalPrograms)return;

  if(currentProgramIndex<0||currentProgramIndex>=totalPrograms){
    currentProgramIndex=0;
  }

  if(workflowState.expectedProgramIndex<0||workflowState.expectedProgramIndex>totalPrograms){
    workflowState.expectedProgramIndex=currentProgramIndex;
    workflowState.reviewUnlocked=false;
  }

  const p=currentProgram();if(!p)return;
  $('programStep').textContent=`Programa ${currentProgramIndex+1} de ${programs().length}`;
  $('programFlowName').innerHTML=`<strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.exit)}</span>`;
  const st=programStats(p);
  let bg = pastelTitles[currentProgramIndex % pastelTitles.length];


  const guideSteps=[
    '1. Habilita la asignatura que puedes impartir',
    '2. Selecciona tu nivel de competencia: X = media · XX = alta',
    '3. Señala el origen del conocimiento: 1 formación · 2 experiencia docente · 3 experiencia laboral · o sus combinaciones 12, 13, 23, 123',
    '4. Marca ✓ si ya has coordinado esa asignatura',
    '5. Opcional: marca ★ si es una de tus asignaturas favoritas'
  ];
  const guideText=`Guía rápida: ${guideSteps.join(' · ')}`;
  const guideTrack=guideSteps.map(step=>`<span class="guide-step">${step}</span>`).join('');


  let h=`<article class="program">
    ${captureGuideHtml()}
    <div class="capture-marquee" aria-label="${guideText}">
      <div class="capture-marquee-track"><div class="guide-sequence">${guideTrack}</div><div class="guide-sequence" aria-hidden="true">${guideTrack}</div></div>
    </div>
    ${commonNoticeHtml(p.id)}
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
        <div class="name">${subjectCase(name)}${subjectHours(p.id,s,c)?` <small class="course-hours">(${subjectHours(p.id,s,c)} h)</small>`:''}${na?' · NO APLICA':''}${!na?courseTransversalBadge(p.id,s,c,name):''}</div>`;


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
            ${['1','2','3','12','13','23','123'].map(code=>`<button class="mini area ${originCode(a)===code?'on':''}" aria-label="Área de conocimiento ${code}" title="${originTooltip(code)}" ${!['X','XX'].includes(a.status)?'disabled':''} onclick="setOriginCode('${p.id}',${s},${c},decodeURIComponent('${enc}'),'${code}')">${code}</button>`).join('')}
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
      <button class="save-btn" onclick="saveAndNextProgram()">${lastProgram?'Guardar y continuar a revisión →':'Guardar y seguir →'}</button>
    </div>
  </article>`;


  $('programs').innerHTML=h;
  const flowBtn=$('flowNextBtn');
  if(flowBtn){
    flowBtn.textContent=lastProgram?'Guardar y continuar a revisión →':'Guardar y seguir →';
    flowBtn.onclick=()=>saveAndNextProgram();
  }
  requestAnimationFrame(adjustSemesterColumnWidths);
  updateProgress();lockRevisionNav();updateNavState();applyEditState();
  refreshCaptureErrorState();
}
window.prevProgram=function(){
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
  persist({touch:false,schedule:false});
  renderCurrentProgram();
  scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'});
}

window.saveAndNextProgram=function(){
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
  persist({touch:false,schedule:false});
  renderCurrentProgram();
  scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'});
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
  const complete=validateAll().ok;

  if(sequentialProfessorMode()){
    return workflowState.reviewUnlocked && complete;
  }

  return complete || cfg.editingLocked || deadlinePassed() || submissionLockedForCurrentPeriod();
}

function showCaptureErrors(errs){
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
    persist({touch:false,schedule:false});
    activateViewDirect('captura');
    renderCurrentProgram();
    $('captureErrors').innerHTML=captureIssuePanel(issues);
    updateNavState();
    requestAnimationFrame(()=>focusExactCaptureIssue(issues[0]));
  }else{
    $('captureErrors').innerHTML=statusBox(errs,'No puede pasar a revisión todavía.');
  }
}

window.validateAndReview=function(fromSequentialFlow=false){
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
    ?`<div class="status-box ok"><b>Perfil completo.</b><br>La información puede formalizarse e imprimirse.</div>`
    :`<div class="status-box info"><b>Consulta en modo solo lectura.</b><br>La edición está cerrada, pero puede revisar e imprimir el perfil capturado.</div>`;

  buildPrint();
  return window.go('revision',true);
}

function lockRevisionNav(){
  const btn=$('navRevision');
  if(!btn)return;

  const locked=sequentialProfessorMode()
    ?!workflowState.reviewUnlocked
    :!reviewAvailable();

  btn.classList.toggle('locked',locked);
}

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
function metaCentered(){return `<div class="meta center compactline"><span><b>Nombre:</b> ${printedProfessorName()}</span><span><b>Categoría:</b> ${store.profile?.categoria||''}</span><span><b>Competencia:</b> X = Medio · XX = Alto</span><span><b>Área de conocimiento:</b> 1 Formación · 2 Docencia · 3 Laboral</span></div>`}
function signatures(){return `<div class="sign"><div class="signature-line">${printedProfessorName()}<br>Firma del Profesor</div><div class="stamp-box">SELLO</div><div class="signature-line">${cfg.jefe}<br>Jefe de Unidad de Coordinación Académica</div></div>`}
function preambleSheet(){
  const p=store.profile||{},e=p.extra||{},f=['Licenciatura o TSU','Posgrado 1','Posgrado 2','Posgrado 3','Posgrado 4','Posgrado 5','Posgrado 6'];
  return `<div class="sheet profile-first-sheet">${printHeader()}<div class="meta center compactline first-profile-meta"><span class="first-meta-item"><b class="first-meta-label">Nombre:</b><strong class="first-meta-value">${printedProfessorName()}</strong></span><span class="first-meta-item"><b class="first-meta-label">Categoría:</b><strong class="first-meta-value">${store.profile?.categoria||''}</strong></span></div><table class="profileTable"><tr><th colspan="4">1. FORMACIÓN PROFESIONAL</th></tr>${f.map((lab,i)=>`<tr><td><b>${lab}</b></td><td>${e[`f${i+1}a`]||''}</td><td><b>Institución</b></td><td>${e[`f${i+1}b`]||''}</td></tr>`).join('')}<tr><th colspan="4">2. EXPERIENCIA DOCENTE</th></tr>${[1,2,3,4].map(i=>`<tr><td><b>Institución ${i}</b></td><td colspan="2">${e[`d${i}a`]||''}</td><td><b>Periodo:</b> ${e[`d${i}c`]||''}</td></tr>`).join('')}<tr><th colspan="4">3. EXPERIENCIA LABORAL</th></tr>${[1,2,3,4,5].map(i=>`<tr><td><b>Organización ${i}</b></td><td>${e[`l${i}a`]||''}</td><td><b>Cargo:</b> ${e[`l${i}b`]||''}</td><td><b>Periodo:</b> ${e[`l${i}c`]||''}</td></tr>`).join('')}</table>${signatures()}</div>`
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
function buildPrint(collectCurrent=true){
  if(collectCurrent&&editingAllowed())collectProfile();
  else if(collectCurrent)store.profile=profileFromInputs();
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
  collectProfile();

  const finalCheck=validateAll();
  if(!finalCheck.ok){
    throw new Error('No se puede finalizar un perfil con información pendiente.');
  }

  if(sequentialProfessorMode()&&!workflowState.reviewUnlocked){
    throw new Error('No se puede finalizar sin concluir el recorrido secuencial.');
  }

  persist();
  const preSyncOk=await syncProfileToCloud({reason:'sincronización previa a finalización'});

  store.submittedPeriod=cfg.periodo;
  store.finalizedAtMs=Date.now();
  store.individualEditEnabled=false;
  store.individualEditDisabled=false;
  persist();

  const finalSyncOk=await syncProfileToCloud({reason:'confirmación de finalización'});
  store.finalizationCloudConfirmed=!!finalSyncOk;
  store.syncPending=!finalSyncOk;
  try{localStorage.setItem('PAD_UTEQ',JSON.stringify(store));saveUserBackup()}catch(_){}

  updateCloudStatus(
    finalSyncOk?'Perfil finalizado y sincronizado':'Perfil finalizado localmente · nube pendiente',
    finalSyncOk?'ok':'warn'
  );
  await writeAudit(
    finalSyncOk
      ?'Perfil finalizado y sincronizado para impresión/guardado PDF'
      :'Perfil finalizado localmente; sincronización pendiente'
  );
  applyEditState();updateNavState();
  return {preSyncOk,finalSyncOk};
}

function profileDocumentBaseName(){
  const p=store.profile||{};
  const surnames=[p.apPat,p.apMat].map(x=>String(x||'').trim()).filter(Boolean).join(' ');
  return `Perfil Académico Docente · DIN · ${surnames||'Profesor'}`;
}
function safeProfilePdfFilename(){
  return `${profileDocumentBaseName().replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim()}.pdf`;
}
function mobilePrintClient(){
  const ua=navigator.userAgent||'';
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua)
    || (window.matchMedia&&window.matchMedia('(max-width: 780px)').matches);
}
async function createMobileLandscapePdf(){
  if(!window.html2canvas||!window.jspdf?.jsPDF)return false;
  const sheets=[...document.querySelectorAll('#printArea .sheet')];
  if(!sheets.length)return false;


  document.body.classList.add('mobile-pdf-capture');
  try{
    const {jsPDF}=window.jspdf;
    const pageW=355.6; // Legal landscape: 14 in
    const pageH=215.9; // 8.5 in
    const margin=4;
    const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:[pageW,pageH],compress:true});


    for(let i=0;i<sheets.length;i++){
      const sheet=sheets[i];
      if(i>0)pdf.addPage([pageW,pageH],'landscape');
      const canvas=await window.html2canvas(sheet,{
        scale:2,
        useCORS:true,
        backgroundColor:'#ffffff',
        logging:false,
        scrollX:0,
        scrollY:0,
        windowWidth:sheet.scrollWidth,
        windowHeight:sheet.scrollHeight
      });
      const maxW=pageW-(margin*2),maxH=pageH-(margin*2);
      const ratio=Math.min(maxW/canvas.width,maxH/canvas.height);
      const w=canvas.width*ratio,h=canvas.height*ratio;
      const x=(pageW-w)/2,y=(pageH-h)/2;
      pdf.addImage(canvas.toDataURL('image/jpeg',0.94),'JPEG',x,y,w,h,undefined,'FAST');
    }


    pdf.save(safeProfilePdfFilename());
    return true;
  }finally{
    document.body.classList.remove('mobile-pdf-capture');
  }
}
async function openProfilePrintDialog(){
  if(mobilePrintClient()){
    try{
      const generated=await createMobileLandscapePdf();
      if(generated){
        toast('PDF horizontal generado.');
        return;
      }
    }catch(e){
      console.warn('PDF horizontal móvil no disponible; se usará impresión del navegador.',e);
    }
  }


  document.body.classList.add('printing-profile');
  const previousTitle=document.title;
  document.title=profileDocumentBaseName();
  const cleanup=()=>{
    document.body.classList.remove('printing-profile');
    document.title=previousTitle;
  };
  window.addEventListener('afterprint',cleanup,{once:true});
  requestAnimationFrame(()=>setTimeout(()=>window.print(),80));
}


let finalizeDialogResolver=null;
function showFinalizeDialog(){
  const modal=$('finalizeProfileModal');
  if(!modal)return Promise.resolve(window.confirm('¿Finalizar e imprimir / guardar PDF?\n\nLa edición quedará bloqueada para el periodo actual. Para cualquier modificación posterior deberá solicitar al JUCA la habilitación de edición.'));
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  return new Promise(resolve=>{finalizeDialogResolver=resolve});
}
window.resolveFinalizeDialog=function(value){
  const modal=$('finalizeProfileModal');
  if(modal)modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  const resolver=finalizeDialogResolver;
  finalizeDialogResolver=null;
  if(resolver)resolver(!!value);
}
window.printProfile=async function(){
  const v=validateAll();

  if(sequentialProfessorMode()&&(!workflowState.reviewUnlocked||!v.ok)){
    toast('Concluya primero Datos del profesor y todos los programas en orden.');
    if(!v.ok)showCaptureErrors(v.errors);
    return;
  }
  if(!reviewAvailable()){
    window.go('captura',true);
    showCaptureErrors(v.errors);
    return;
  }


  if(planningEnabled()){
    const pv=validatePlanning({visual:true});
    if(!pv.ok){
      if($('planningErrors'))$('planningErrors').innerHTML=statusBox(
        pv.errors,
        'Antes de finalizar, complete el apartado de Comisiones o seleccione No aplica donde corresponda.'
      );
      window.go('perfil',true);
      requestAnimationFrame(()=>$('commissionsBlock')?.scrollIntoView({behavior:'smooth',block:'start'}));
      toast('Complete el apartado de Comisiones antes de finalizar.');
      return;
    }
  }


  if(isAdmin()){
    buildPrint();
    await openProfilePrintDialog();
    return;
  }
  if(submissionLockedForCurrentPeriod() && !individualEditOverride()){
    buildPrint();
    await openProfilePrintDialog();
    return;
  }


  if(!v.ok){
    const proceed=window.confirm(
      'El perfil no cumple todavía todas las validaciones. Puede imprimir el estado actual, pero NO se marcará como concluido.\n\n¿Desea continuar con la impresión?'
    );
    if(proceed){
      buildPrint();
      await openProfilePrintDialog();
    }
    return;
  }


  const ok=await showFinalizeDialog();
  if(!ok){
    toast('La captura permanece abierta.');
    return;
  }


  const result=await finalizeCurrentProfile();
  buildPrint();


  toast(
    result.finalSyncOk
      ?'Perfil concluido. La edición quedó bloqueada. Para cualquier modificación posterior, consulte a su JUCA.'
      :'Perfil concluido y bloqueado. La nube se sincronizará automáticamente; para cualquier modificación posterior, consulte a su JUCA.'
  );
  await openProfilePrintDialog();
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
  cfg.captureDeadline=ts;cacheGlobalSettings();persist();updateCountdownUI();saveGlobalSettings('Fecha límite de captura actualizada');toast('Fecha límite guardada.');
}
window.closeCaptureNow=function(){
  if(!isAdmin())return;
  if(!confirm('¿Cerrar la captura para profesores en este momento?'))return;
  cfg.captureDeadline=Date.now();persist();updateCountdownUI();saveGlobalSettings('Captura cerrada manualmente');toast('Captura cerrada.');
}
window.clearDeadline=function(){
  if(!isAdmin())return;
  cfg.captureDeadline=null;cacheGlobalSettings();persist();updateCountdownUI();saveGlobalSettings('Fecha límite eliminada');toast('Fecha límite eliminada.');
}


window.saveAdmin=function(){
  const previousPeriod=cfg.periodo;
  cfg.jefe=$('jefe').value.trim()||cfg.jefe;
  cfg.codigo=$('codigo').value.trim()||cfg.codigo;
  cfg.revision=$('revisionCal').value.trim()||cfg.revision;
  cfg.fechaRevision=$('fechaRevision').value.trim()||cfg.fechaRevision;
  cfg.periodo=$('periodoAdmin').value.trim()||cfg.periodo;


  if(previousPeriod!==cfg.periodo){
    cfg.planningEnabled=confirm(
      `El periodo cambió de "${previousPeriod}" a "${cfg.periodo}".\n\n`+
      `¿Desea habilitar para este periodo el apartado 4 de Comisiones?\n\n`+
      `Si lo habilita, las preguntas sobre comisiones autorizadas y proyectos avalados serán obligatorias; ambas permiten No aplica. La información no se imprimirá ni formará parte del PDF.`
    );
  }


  // El cambio de periodo nunca borra profile, answers, programMeta ni planeaciones de periodos anteriores.
  updatePeriodBadges();cacheGlobalSettings();persist();updatePlanningAvailability();renderPlanning();
  saveGlobalSettings(previousPeriod===cfg.periodo?'Configuración institucional actualizada':`Periodo actualizado de ${previousPeriod} a ${cfg.periodo} sin borrar perfiles`);
  toast(previousPeriod===cfg.periodo?'Configuración guardada.':`Periodo actualizado. Comisiones ${cfg.planningEnabled?'habilitadas':'deshabilitadas'} para el nuevo periodo.`);
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




window.refreshTeacherAdminProgress=async function(){
  if(!isAdmin())return;
  const btn=$('refreshTeacherProgressBtn');
  const previous=btn?.textContent||'↻ Actualizar avance';
  if(btn){
    btn.disabled=true;
    btn.textContent='↻ Actualizando…';
    btn.classList.add('loading');
  }
  try{
    await renderTeacherAdminList();
    toast('Avance de profesores actualizado.');
  }catch(e){
    console.warn('No fue posible actualizar el avance de profesores',e);
    toast('No fue posible actualizar el avance.');
  }finally{
    if(btn){
      btn.disabled=false;
      btn.textContent=previous;
      btn.classList.remove('loading');
    }
  }
}


function teacherCaptureProgress(remoteAnswers={}){
  let totalSubjects=0,completedSubjects=0,totalPrograms=0,completedPrograms=0;


  programs().forEach(pr=>{
    let programTotal=0,programCompleted=0;


    pr.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
      if(isEnglish(name))return;


      programTotal++;
      totalSubjects++;


      const a=remoteAnswers?.[key(pr.id,s,c)]||{status:'pending',origins:[]};
      const complete=
        a.status==='off' ||
        (['X','XX'].includes(a.status) && Array.isArray(a.origins) && a.origins.length>0);


      if(complete){
        programCompleted++;
        completedSubjects++;
      }
    }));


    if(programTotal>0){
      totalPrograms++;
      if(programCompleted===programTotal)completedPrograms++;
    }
  });


  const pct=totalSubjects?Math.round((completedSubjects/totalSubjects)*100):0;
  return {pct,totalSubjects,completedSubjects,totalPrograms,completedPrograms};
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
      const d=ds.data()||{};
      if(d.deletedByAdmin===true)return;
      const p=d.profile||{};
      const name=[p.apPat,p.apMat,p.nombres].filter(Boolean).join(' ')||d.displayName||d.email||'(Sin nombre)';
      const captureProgress=teacherCaptureProgress(d.answers||{});
      const row={
        uid:ds.id,
        name,
        email:d.email||'',
        categoria:p.categoria||'',
        submittedPeriod:d.submittedPeriod||null,
        finalizedAtMs:Number(d.finalizedAtMs)||0,
        individualEditEnabled:!!d.individualEditEnabled,
        individualEditDisabled:!!d.individualEditDisabled,
        updatedAt:d.updatedAt,
        profileResetToken:d.profileResetToken||null,
        captureProgress
      };
      rows.push(row);teacherAdminCache[row.uid]=row;
    });
    rows.sort((a,b)=>a.name.localeCompare(b.name,'es',{sensitivity:'base'}));
    const done=rows.filter(x=>x.submittedPeriod===cfg.periodo).length;
    summary.innerHTML=`<b>${rows.length}</b> profesor${rows.length===1?'':'es'} con información · <b>${done}</b> concluido${done===1?'':'s'} en ${cfg.periodo}`;
    if(!rows.length){root.innerHTML='<div class="teacher-empty">Aún no hay perfiles de profesores guardados.</div>';return}
    const tableHeader=`<div class="teacher-admin-table-head" aria-hidden="true">
      <span>Profesor</span>
      <span>Avance de captura</span>
      <span>Estado</span>
      <span>Acciones</span>
    </div>`;
    root.innerHTML=tableHeader+rows.map(r=>{
      const doneNow=r.submittedPeriod===cfg.periodo;
      const override=!!r.individualEditEnabled;
      const individuallyDisabled=!!r.individualEditDisabled;
      const statusTitle=individuallyDisabled
        ?'Edición individual deshabilitada'
        :override
          ?'Edición individual habilitada'
          :(doneNow?'Concluido':'En captura / sin concluir');
      const lastCompletion=doneNow?formatTeacherCompletion(r):'';
      const lastEdit=formatTeacherUpdatedAt(r.updatedAt);
      const statusText=individuallyDisabled
        ?`Última edición: ${lastEdit} · Edición deshabilitada por Administración`
        :override
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
        <div class="teacher-admin-progress" title="${r.captureProgress.completedSubjects} de ${r.captureProgress.totalSubjects} asignaturas revisadas">
          <div class="teacher-progress-top">
            <strong>${r.captureProgress.pct}%</strong>
            <span>${r.captureProgress.completedSubjects}/${r.captureProgress.totalSubjects} asignaturas</span>
          </div>
          <div class="teacher-progress-track"><i style="width:${r.captureProgress.pct}%"></i></div>
          <small>${r.captureProgress.completedPrograms}/${r.captureProgress.totalPrograms} programas completos</small>
        </div>
        <div class="teacher-admin-status ${override?'individual-open':doneNow?'finished':'open'}">
          <strong>${escapeHtml(statusTitle)}</strong>
          <span>${escapeHtml(statusText)}</span>
        </div>
        <div class="teacher-admin-actions">
          ${(()=>{
            const enableNext=individuallyDisabled || (doneNow && !override);
            const label=enableNext?'Habilitar edición':'Deshabilitar edición';
            return `<button class="teacher-reopen-btn ${enableNext?'':'active'}" onclick="setTeacherEditAccess('${r.uid}',${enableNext?'true':'false'})">${label}</button>`;
          })()}
          <button class="teacher-print-profile-btn" onclick="printTeacherProfile('${r.uid}')">Imprimir perfil</button>
          <button class="teacher-reset-program-btn" onclick="resetTeacherProgramProfile('${r.uid}')">🔒 Eliminar asignaturas capturadas</button>
          <button class="teacher-delete-btn" onclick="deleteTeacherProfile('${r.uid}')">🔒 Eliminar perfil completo</button>
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


window.printTeacherProfile=async function(uid){
  if(!isAdmin()||!db)return;
  const cached=teacherAdminCache[uid]||{};
  try{
    const snap=await getDoc(doc(db,'profiles',uid));
    if(!snap.exists()){
      alert('El perfil seleccionado ya no existe.');
      return;
    }
    const d=snap.data()||{};


    const previousProfile=store.profile;
    const previousAnswers=answers;
    const previousProgramMeta=programMeta;
    const previousFinalizedAtMs=store.finalizedAtMs;


    try{
      store.profile=JSON.parse(JSON.stringify(d.profile||{}));
      answers=JSON.parse(JSON.stringify(d.answers||{}));
      programMeta=JSON.parse(JSON.stringify(d.programMeta||{}));
      store.finalizedAtMs=Number(d.finalizedAtMs)||null;


      buildPrint(false);
      await openProfilePrintDialog();
      await writeAudit(`Perfil impreso por Administración: ${d.email||cached.email||uid}`);
    }finally{
      store.profile=previousProfile;
      answers=previousAnswers;
      programMeta=previousProgramMeta;
      store.finalizedAtMs=previousFinalizedAtMs;
    }
  }catch(e){
    console.error('No fue posible imprimir el perfil del profesor',e);
    alert('No fue posible preparar el perfil para impresión. Revise la conexión con Firestore.');
  }
}


window.setTeacherEditAccess=async function(uid,enable){
  if(!isAdmin()||!db)return;
  const r=teacherAdminCache[uid]||{};
  const who=r.name||r.email||'este profesor';
  const question=enable
    ?`¿Habilitar la edición para ${who}?\n\nSe conservará íntegramente la última información guardada. El profesor continuará exactamente desde su captura anterior. Sólo los botones de eliminación pueden borrar información.`
    :`¿Deshabilitar la edición para ${who}?\n\nEl profesor podrá consultar su información, pero no podrá modificarla hasta que Administración vuelva a habilitarla.`;
  if(!confirm(question))return;
  try{
    await setDoc(doc(db,'profiles',uid),{
      individualEditEnabled:!!enable,
      individualEditDisabled:!enable,
      reopenedAt:enable?serverTimestamp():null,
      reopenedBy:enable?(currentUser.email||''):null,
      individualEditUpdatedAt:serverTimestamp()
    },{merge:true});
    await writeAudit(`${enable?'Edición individual habilitada':'Edición individual deshabilitada'} para ${r.email||uid}`);
    toast(enable?'Edición habilitada para ese profesor.':'Edición deshabilitada para ese profesor.');
    await renderTeacherAdminList();
  }catch(e){
    console.error('Error de edición individual',e);
    alert(`No fue posible ${enable?'habilitar':'deshabilitar'} la edición individual.\n\nCódigo: ${e?.code||'sin código'}\n\nVerifique que las reglas de Firestore vigentes permitan la administración de perfiles.`);
  }
}
window.toggleTeacherEditOverride=function(uid,enable){return window.setTeacherEditAccess(uid,enable)}


window.reopenTeacherProfile=function(uid){return window.toggleTeacherEditOverride(uid,true)}


function confirmAdministrativeDeletion(firstMessage,secondLabel){
  if(!confirm(firstMessage))return false;
  const typed=prompt(
    `SEGUNDO CANDADO DE SEGURIDAD\n\nPara confirmar ${secondLabel}, escriba exactamente:\n\nELIMINAR`
  );
  if(String(typed||'').trim().toUpperCase()!=='ELIMINAR'){
    if(typed!==null)toast('Eliminación cancelada: no se escribió ELIMINAR.');
    return false;
  }
  return true;
}


window.resetTeacherProgramProfile=async function(uid){
  if(!isAdmin()||!db)return;
  const r=teacherAdminCache[uid]||{};
  const who=r.name||r.email||'este profesor';


  const ok=confirmAdministrativeDeletion(
    `¿CONFIRMAR eliminación de las asignaturas capturadas de ${who}?\n\n`+
    `Se borrarán respuestas por asignatura, niveles X/XX, áreas de conocimiento, coordinaciones, favoritas y el estado de finalización.\n\n`+
    `Se conservarán los datos del profesor, pero la edición quedará habilitada para corregirlos y comenzar desde cero el Perfil por programa.\n\n`+
    `Esta acción no se puede deshacer desde esta pantalla.`,
    'la eliminación de las asignaturas capturadas'
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
      individualEditDisabled:false,
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


  const ok=confirmAdministrativeDeletion(
    `¿CONFIRMAR eliminación COMPLETA del perfil de ${who}?\n\n`+
    `Se eliminarán datos del profesor, formación, experiencia, respuestas por asignatura, niveles, áreas, coordinaciones, favoritas y el estado de finalización.\n\n`+
    `En su próximo ingreso comenzará desde cero. Esta acción NO elimina su cuenta institucional.\n\n`+
    `Esta acción no se puede deshacer desde esta pantalla.`,
    'la eliminación COMPLETA del perfil'
  );
  if(!ok)return;


  try{
    const deletionToken=`DEL-${Date.now()}-${uid}`;
    await setDoc(doc(db,'profiles',uid),{
      uid,
      email:r.email||'',
      displayName:r.name||'',
      deletedByAdmin:true,
      profileDeletionToken:deletionToken,
      deletedAt:serverTimestamp(),
      deletedBy:currentUser?.email||'',
      profile:{},
      answers:{},
      programMeta:{},
      planningByPeriod:{},
      submittedPeriod:null,
      finalizedAtMs:null,
      individualEditEnabled:false,
      individualEditDisabled:false,
      profileResetToken:null,
      updatedAt:serverTimestamp()
    });
    await writeAudit(`Perfil completo eliminado por Administración: ${r.email||uid}`);
    toast('Perfil completo eliminado. En su próximo ingreso el profesor comenzará desde cero.');
    await renderTeacherAdminList();
  }catch(e){
    console.error(e);
    alert('No fue posible eliminar el perfil completo. Verifique las reglas de Firestore.');
  }
}






function transversalAvailablePrograms(){
  return allPrograms();
}
function transversalSemesterCourses(pid,s){
  const pr=allPrograms().find(x=>x.id===pid);
  const sem=pr?.semesters?.[Number(s)]||[];
  return sem.map((name,c)=>({pid,s:Number(s),c,name}))
    .filter(x=>!isEnglish(x.name)&&!isProjectIntegrator(x.name));
}
function endpointFromControls(side){
  const prefix=side==='source'?'transversalSource':'transversalTarget';
  const pid=$(prefix+'Program')?.value||'';
  const s=Number($(prefix+'Semester')?.value);
  const c=Number($(prefix+'Subject')?.value);
  return Number.isInteger(s)&&Number.isInteger(c)?courseLocation(pid,s,c):null;
}
function renderTransversalAdmin(){
  const source=$('transversalSourceProgram'),target=$('transversalTargetProgram');
  if(!source||!target)return;


  const ps=transversalAvailablePrograms();
  const oldSource=source.value,oldTarget=target.value;
  source.innerHTML=ps.map(p=>`<option value="${p.id}">${escapeHtml(programAcronym(p))} · ${escapeHtml(p.name)} — ${escapeHtml(p.exit)}</option>`).join('');
  if(oldSource&&ps.some(p=>p.id===oldSource))source.value=oldSource;


  renderTransversalSemesterOptions('source',false);
  syncTransversalDestinationPrograms(oldTarget);
  renderTransversalRulesList();
}
window.syncTransversalDestinationPrograms=function(preferred=''){
  const source=$('transversalSourceProgram'),target=$('transversalTargetProgram');
  if(!source||!target)return;
  const previous=preferred||target.value;
  const candidates=transversalAvailablePrograms().filter(p=>p.id!==source.value);
  target.innerHTML=candidates.map(p=>`<option value="${p.id}">${escapeHtml(programAcronym(p))} · ${escapeHtml(p.name)} — ${escapeHtml(p.exit)}</option>`).join('');
  if(previous&&candidates.some(p=>p.id===previous))target.value=previous;
  renderTransversalSemesterOptions('target',false);
}
window.renderTransversalSemesterOptions=function(side,resyncTarget=true){
  const prefix=side==='source'?'transversalSource':'transversalTarget';
  const program=$(prefix+'Program'),semester=$(prefix+'Semester');
  if(!program||!semester)return;
  const pr=allPrograms().find(x=>x.id===program.value);
  const previous=Number(semester.value);
  semester.innerHTML=(pr?.semesters||[]).map((sem,s)=>`<option value="${s}">${s+1}.° cuatrimestre</option>`).join('');
  if(Number.isInteger(previous)&&pr?.semesters?.[previous])semester.value=String(previous);
  renderTransversalCourseOptions(side);
  if(side==='source'&&resyncTarget)syncTransversalDestinationPrograms();
}
window.renderTransversalCourseOptions=function(side){
  const prefix=side==='source'?'transversalSource':'transversalTarget';
  const program=$(prefix+'Program'),semester=$(prefix+'Semester'),subject=$(prefix+'Subject');
  if(!program||!semester||!subject)return;
  const previous=Number(subject.value);
  const courses=transversalSemesterCourses(program.value,Number(semester.value));
  subject.innerHTML=courses.map(x=>`<option value="${x.c}">${escapeHtml(subjectCase(x.name))}</option>`).join('');
  if(Number.isInteger(previous)&&courses.some(x=>x.c===previous))subject.value=String(previous);
}
window.saveTransversalRule=function(){
  if(!isAdmin())return;
  const source=endpointFromControls('source');
  const target=endpointFromControls('target');


  if(!source||!target){toast('Seleccione completamente la materia de origen y la materia de destino.');return}
  if(isProjectIntegrator(source.name)||isProjectIntegrator(target.name)){
    toast('Proyecto integrador siempre debe permanecer autónomo.');
    return;
  }
  if(source.pid===target.pid&&source.s===target.s&&source.c===target.c){
    toast('La materia de origen y la de destino deben ser distintas.');
    return;
  }


  const samePair=transversalRules.some(rule=>{
    if(!rule.source||!rule.target)return false;
    const a=rule.source,b=rule.target;
    const direct=a.pid===source.pid&&a.s===source.s&&a.c===source.c&&b.pid===target.pid&&b.s===target.s&&b.c===target.c;
    const reverse=b.pid===source.pid&&b.s===source.s&&b.c===source.c&&a.pid===target.pid&&a.s===target.s&&a.c===target.c;
    return direct||reverse;
  });
  if(samePair){toast('Esta relación transversal ya está configurada.');return}


  transversalRules.push({
    id:`TR_${Date.now()}`,
    source:{pid:source.pid,s:source.s,c:source.c},
    target:{pid:target.pid,s:target.s,c:target.c},
    sourceName:source.name,
    targetName:target.name
  });


  store.transversalRules=transversalRules;
  persist();
  saveGlobalSettings('Relación transversal configurada');
  renderTransversalRulesList();
  renderAcademicRelationsTree();
  renderCurrentProgram();
  toast('Relación transversal guardada.');
}
window.deleteTransversalRule=function(id){
  if(!isAdmin())return;
  const rule=transversalRules.find(r=>r.id===id);
  if(!rule)return;
  if(!confirm('¿Quitar esta relación transversal? Las respuestas ya capturadas no se borrarán.'))return;
  transversalRules=transversalRules.filter(r=>r.id!==id);
  store.transversalRules=transversalRules;
  persist();
  saveGlobalSettings('Relación transversal eliminada');
  renderTransversalRulesList();
  renderAcademicRelationsTree();
  renderCurrentProgram();
  toast('Relación transversal eliminada.');
}
function renderTransversalRulesList(){
  const root=$('transversalRulesList');
  if(!root)return;
  if(!transversalRules.length){
    root.innerHTML='<div class="transversal-empty">No hay relaciones transversales configuradas.</div>';
    return;
  }
  root.innerHTML=transversalRules.map(rule=>{
    if(rule.source&&rule.target){
      const a=normalizeTransversalEndpoint(rule.source);
      const b=normalizeTransversalEndpoint(rule.target);
      if(!a||!b)return '';
      const pa=allPrograms().find(x=>x.id===a.pid),pb=allPrograms().find(x=>x.id===b.pid);
      return `<div class="transversal-rule-row v60">
        <div class="transversal-rule-endpoint">
          <span class="endpoint-chip">Origen</span>
          <strong>${escapeHtml(subjectCase(a.name))}</strong>
          <small>${escapeHtml(pa?programAcronym(pa):a.pid)} · ${a.s+1}.° cuatrimestre</small>
        </div>
        <div class="transversal-rule-link">→</div>
        <div class="transversal-rule-endpoint">
          <span class="endpoint-chip target">Destino</span>
          <strong>${escapeHtml(subjectCase(b.name))}</strong>
          <small>${escapeHtml(pb?programAcronym(pb):b.pid)} · ${b.s+1}.° cuatrimestre</small>
        </div>
        <button type="button" onclick="deleteTransversalRule('${rule.id}')">Quitar</button>
      </div>`;
    }


    // Compatibilidad con relaciones de V59 ya guardadas.
    const source=allPrograms().find(x=>x.id===rule.sourceProgramId);
    const targets=(rule.targetProgramIds||[]).map(id=>allPrograms().find(x=>x.id===id)).filter(Boolean);
    return `<div class="transversal-rule-row legacy">
      <div class="transversal-rule-name"><strong>${escapeHtml(subjectCase(rule.subjectName||rule.subjectNormalized||'Asignatura'))}</strong><span>Configuración anterior · ${escapeHtml(source?programAcronym(source):'')}</span></div>
      <div class="transversal-rule-targets">${targets.map(p=>`<span>${escapeHtml(programAcronym(p))}</span>`).join('')}</div>
      <button type="button" onclick="deleteTransversalRule('${rule.id}')">Quitar</button>
    </div>`;
  }).join('');
}






function academicProgramLabel(pid){
  const p=allPrograms().find(x=>x.id===pid);
  return p?`${programAcronym(p)} · ${p.name}`:pid;
}
function exactSameNameGroups(){
  const map=new Map();
  allPrograms().forEach(p=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    if(isEnglish(name)||isProjectIntegrator(name))return;
    const exact=strictSubjectKey(name);
    if(!exact)return;
    if(!map.has(exact))map.set(exact,{name,locations:[]});
    map.get(exact).locations.push({pid:p.id,s,c,name});
  })));
  return [...map.values()]
    .filter(x=>x.locations.length>1)
    .sort((a,b)=>subjectCase(a.name).localeCompare(subjectCase(b.name),'es',{sensitivity:'base'}));
}
function renderAcademicRelationsTree(){
  const root=$('academicRelationsTree');
  if(!root)return;


  const commonHtml=commonRules.length
    ?commonRules.map(rule=>{
      const sems=(rule.semesters||[]).map(s=>`${s+1}.°`).join(', ');
      const children=(rule.programIds||[]).map(pid=>`<li><span class="tree-node program">${escapeHtml(academicProgramLabel(pid))}</span></li>`).join('');
      return `<li class="tree-branch common"><div class="tree-line"><span class="tree-type common">Tronco común</span><strong>${escapeHtml(rule.name)}</strong><small>Cuatrimestres ${escapeHtml(sems)}</small></div><ul>${children}</ul></li>`;
    }).join('')
    :'<li class="tree-empty">No hay troncos comunes configurados.</li>';


  const automaticGroups=exactSameNameGroups();
  const automaticHtml=automaticGroups.length
    ?automaticGroups.map(group=>{
      const children=group.locations.map(loc=>`<li><span class="tree-node course">${escapeHtml(academicProgramLabel(loc.pid))}</span><small>${loc.s+1}.° cuatrimestre</small></li>`).join('');
      return `<li class="tree-branch automatic"><div class="tree-line"><span class="tree-type automatic">Mismo nombre</span><strong>${escapeHtml(subjectCase(group.name))}</strong><small>${group.locations.length} apariciones vinculables</small></div><ul>${children}</ul></li>`;
    }).join('')
    :'<li class="tree-empty">No hay materias repetidas por nombre exacto.</li>';


  const explicitHtml=transversalRules.length
    ?transversalRules.map(rule=>{
      if(rule.source&&rule.target){
        const a=normalizeTransversalEndpoint(rule.source),b=normalizeTransversalEndpoint(rule.target);
        if(!a||!b)return '';
        return `<li class="tree-branch explicit"><div class="tree-line"><span class="tree-type explicit">Transversal 1 a 1</span><strong>${escapeHtml(subjectCase(a.name))}</strong></div><ul><li><span class="tree-node origin">Origen · ${escapeHtml(academicProgramLabel(a.pid))}</span><small>${a.s+1}.° cuatrimestre</small></li><li><span class="tree-link-arrow">↓</span></li><li><span class="tree-node target">Destino · ${escapeHtml(subjectCase(b.name))} · ${escapeHtml(academicProgramLabel(b.pid))}</span><small>${b.s+1}.° cuatrimestre</small></li></ul></li>`;
      }
      const source=allPrograms().find(x=>x.id===rule.sourceProgramId);
      const targetLabels=(rule.targetProgramIds||[]).map(academicProgramLabel);
      return `<li class="tree-branch explicit"><div class="tree-line"><span class="tree-type explicit">Transversal anterior</span><strong>${escapeHtml(subjectCase(rule.subjectName||rule.subjectNormalized||'Asignatura'))}</strong></div><ul><li><span class="tree-node origin">${escapeHtml(source?academicProgramLabel(source.id):rule.sourceProgramId||'Origen')}</span></li>${targetLabels.map(x=>`<li><span class="tree-node target">${escapeHtml(x)}</span></li>`).join('')}</ul></li>`;
    }).join('')
    :'<li class="tree-empty">No hay relaciones transversales 1 a 1 configuradas.</li>';


  root.innerHTML=`
    <section class="relation-tree-section"><h3>1. Troncos comunes</h3><ul class="relation-tree-root">${commonHtml}</ul></section>
    <section class="relation-tree-section"><h3>2. Materias vinculadas automáticamente por mismo nombre</h3><p class="relation-tree-note">Se excluyen Inglés y Proyecto integrador. Deshabilitar una materia continúa siendo una decisión individual.</p><ul class="relation-tree-root">${automaticHtml}</ul></section>
    <section class="relation-tree-section"><h3>3. Relaciones transversales configuradas</h3><ul class="relation-tree-root">${explicitHtml}</ul></section>`;
}


function renderAdmin(){
  $('jefe').value=cfg.jefe;$('codigo').value=cfg.codigo;$('revisionCal').value=cfg.revision;$('fechaRevision').value=cfg.fechaRevision;$('periodoAdmin').value=cfg.periodo;
  updatePlanningAvailability();
  renderExcelExportOptions();
  if($('captureDeadlineAdmin'))$('captureDeadlineAdmin').value=toLocalDateTimeValue(cfg.captureDeadline);updateCountdownUI();
  const st=$('editModeStatus'),btn=$('editModeBtn');
  if(st){st.textContent=cfg.editingLocked?'Edición desactivada':'Edición activa';st.className='edit-mode-status '+(cfg.editingLocked?'locked':'open')}
  if(btn){btn.textContent=cfg.editingLocked?'Activar edición de perfiles':'Desactivar edición de perfiles';btn.className='edit-mode-btn '+(cfg.editingLocked?'activate':'deactivate')}
  if(!editingProgramId && !$('newProgramSemesters')?.children?.length)renderSemesterEditors();
  renderProgramAdminList();renderCustomPrograms();renderRules();renderTransversalAdmin();renderAcademicRelationsTree();applyEditState();renderTeacherAdminList()
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
  root.innerHTML=commonRules.length?commonRules.map((r,i)=>{
    const programsText=(r.programIds||[]).map(id=>{
      const p=allPrograms().find(x=>x.id===id);
      return p?programAcronym(p):id;
    }).join(' · ');
    const sems=(r.semesters||[]).map(x=>`${x+1}.°`).join(' · ');
    return `<div class="common-rule-summary common-rule-tone-${(i%4)+1}">
      <b>${r.name}</b>
      <span class="common-programs">${programsText}</span>
      <span class="common-semesters">${sems}</span>
    </div>`;
  }).join(''):'<div class="coord-empty">No hay troncos comunes configurados.</div>';
}




function excelCategoryAbbreviation(category){
  const raw=String(category||'').trim();
  const norm=raw.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\s+/g,' ');
  const map=[
    [/profesor de tiempo completo titular c/, 'PTC TC'],
    [/profesor de tiempo completo titular b/, 'PTC TB'],
    [/profesor de tiempo completo titular a/, 'PTC TA'],
    [/profesor de tiempo completo asociado c/, 'PTC AC'],
    [/profesor de tiempo completo asociado b/, 'PTC AB'],
    [/profesor de tiempo completo asociado a/, 'PTC AA'],
    [/tecnico academico c/, 'TA C'],
    [/profesor de asignatura.*honorarios|honorarios/, 'Honorarios'],
    [/profesor de asignatura/, 'PA']
  ];
  for(const [rx,abbr] of map){
    if(rx.test(norm))return abbr;
  }
  return raw;
}




const EXCEL_SHEET_OPTIONS=[
  {id:'concentrado',label:'Concentrado perfiles'},
  {id:'comisiones',label:'Comisiones'},
  {id:'base',label:'Base maestra'},
  {id:'catalogo',label:'Catálogo'},
  {id:'resumen',label:'Resumen por asignatura'}
];
function renderExcelExportOptions(){
  const sheets=$('excelSheetOptions'),quarters=$('excelQuarterOptions');
  if(sheets){
    sheets.innerHTML=EXCEL_SHEET_OPTIONS.map(x=>`<label class="excel-check-chip"><input type="checkbox" data-excel-sheet="${x.id}" checked> <span>${x.label}</span></label>`).join('');
  }
  if(quarters){
    const maxQ=Math.max(1,...allPrograms().map(p=>p.semesters?.length||0));
    quarters.innerHTML=`<label class="excel-check-chip all"><input id="excelQuarterAll" type="checkbox" checked onchange="toggleAllExcelQuarters(this.checked)"> <span>Todos</span></label>`+
      Array.from({length:maxQ},(_,i)=>`<label class="excel-check-chip"><input type="checkbox" data-excel-quarter="${i+1}" checked onchange="syncExcelQuarterAll()"> <span>${i+1}.°</span></label>`).join('');
  }
}
window.toggleAllExcelQuarters=function(checked){
  document.querySelectorAll('[data-excel-quarter]').forEach(x=>x.checked=checked);
}
window.syncExcelQuarterAll=function(){
  const items=[...document.querySelectorAll('[data-excel-quarter]')];
  const all=$('excelQuarterAll');
  if(all)all.checked=items.length>0&&items.every(x=>x.checked);
}
function selectedExcelSheets(){
  const items=[...document.querySelectorAll('[data-excel-sheet]:checked')].map(x=>x.dataset.excelSheet);
  return new Set(items.length?items:EXCEL_SHEET_OPTIONS.map(x=>x.id));
}
function selectedExcelQuarters(){
  const items=[...document.querySelectorAll('[data-excel-quarter]:checked')].map(x=>Number(x.dataset.excelQuarter)).filter(Number.isFinite);
  if(items.length)return new Set(items);
  const maxQ=Math.max(1,...allPrograms().map(p=>p.semesters?.length||0));
  return new Set(Array.from({length:maxQ},(_,i)=>i+1));
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
  const exportSheets=selectedExcelSheets();
  const exportQuarters=selectedExcelQuarters();
  const includeQuarter=(semesterIndex)=>exportQuarters.has(semesterIndex+1);


  // --- Hoja 1: concentrado horizontal similar al archivo operativo ---
  const headerRows=6;
  const aoa=Array.from({length:headerRows+teachers.length},()=>[]);
  aoa[0][0]='PROGRAMA EDUCATIVO';
  aoa[0][1]='Leyenda: ✔ = Coordinó la asignatura · ★ = Favorita · las marcas se muestran en negrita';
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
    pr.semesters.forEach((sem,s)=>{ if(!includeQuarter(s))return; sem.forEach((name,c)=>{
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
        aoa[headerRows+ti][1]=excelCategoryAbbreviation(t.category);
        aoa[headerRows+ti][col]=level?`${level}${coord?' ✔':''}${fav?' ★':''}`:'';
      });
      col++;
    });});
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




  // Formato tipo tabla desde la fila 6 (encabezado) hacia abajo.
  // XLSX-JS-Style no crea el objeto nativo "Tabla" de Excel de forma estable,
  // por lo que se replica visual y funcionalmente: encabezado, filtros,
  // bandas alternas y bordes.
  const tableHeaderRow=5;
  const tableEndRow=aoa.length-1;
  for(let c=0;c<col;c++){
    const addr=XLSX.utils.encode_cell({r:tableHeaderRow,c});
    styleCell(addr,{
      font:{name:'Aptos',sz:10,bold:true,color:{rgb:'FFFFFF'}},
      fill:{patternType:'solid',fgColor:{rgb:'1D5A78'}},
      alignment:{horizontal:'center',vertical:'center',wrapText:true},
      border:{
        top:{style:'thin',color:{rgb:'B5C7D1'}},
        bottom:{style:'thin',color:{rgb:'B5C7D1'}},
        left:{style:'thin',color:{rgb:'B5C7D1'}},
        right:{style:'thin',color:{rgb:'B5C7D1'}}
      }
    });
  }
  for(let r=6;r<=tableEndRow;r++){
    const band=(r%2===0)?'F7FBFC':'FFFFFF';
    for(let c=0;c<col;c++){
      const addr=XLSX.utils.encode_cell({r,c});
      const existing=ws[addr]?.s||{};
      styleCell(addr,{
        ...existing,
        fill:existing.fill||{patternType:'solid',fgColor:{rgb:band}},
        border:{
          top:{style:'thin',color:{rgb:'D8E3E8'}},
          bottom:{style:'thin',color:{rgb:'D8E3E8'}},
          left:{style:'thin',color:{rgb:'D8E3E8'}},
          right:{style:'thin',color:{rgb:'D8E3E8'}}
        }
      });
    }
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
  // ✔ = Coordinó la asignatura; ★ = Favorita.
  // Si existe cualquiera de las marcas, el contenido va en negrita.
  // No se utilizan fondos especiales ni fuente roja.
  for(let r=headerRows;r<aoa.length;r++){
    const t=teachers[r-headerRows];
    let matrixCol=2;
    ps.forEach(pr=>pr.semesters.forEach((sem,s)=>{ if(!includeQuarter(s))return; sem.forEach((name,c)=>{
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
            color:{rgb:'243746'}
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
    });}));
  }


  // --- Hoja 2: Base maestra cruda (se conserva por compatibilidad) ---
  const base=[];
  teachers.forEach(t=>ps.forEach(pr=>pr.semesters.forEach((sem,s)=>{ if(!includeQuarter(s))return; sem.forEach((name,c)=>{
    const a=teacherAnswer(t,pr.id,s,c,name);
    base.push({
      Profesor:t.name,
      Categoria:excelCategoryAbbreviation(t.category),
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
      'Materia favorita':a.ideal?'★':'',
      'Coordinador de academia':teacherCoordinator(t,pr.id,s,c)?'✔':''
    });
  });})));


  const wsBase=XLSX.utils.json_to_sheet(base);
  wsBase['!autofilter']={ref:wsBase['!ref']};
  wsBase['!freeze']={xSplit:2,ySplit:1,topLeftCell:'C2',activePane:'bottomRight',state:'frozen'};
  // Coordinación en Base maestra: ✔ en negrita, sin fuente roja.
  if(base.length){
    const coordHeader='Coordinador de academia';
    const headers=Object.keys(base[0]);
    const coordCol=headers.indexOf(coordHeader);
    if(coordCol>=0){
      for(let r=1;r<=base.length;r++){
        const addr=XLSX.utils.encode_cell({r,c:coordCol});
        if(wsBase[addr] && String(wsBase[addr].v||'')==='✔'){
          wsBase[addr].s={
            font:{name:'Aptos',sz:10,bold:true,color:{rgb:'243746'}},
            fill:{patternType:'solid',fgColor:{rgb:'FFFFFF'}},
            alignment:{horizontal:'center',vertical:'center'}
          };
        }
      }
    }
  }




  // Favorita en Base maestra: ★ en negrita.
  if(base.length){
    const headers=Object.keys(base[0]);
    const favCol=headers.indexOf('Materia favorita');
    if(favCol>=0){
      for(let r=1;r<=base.length;r++){
        const addr=XLSX.utils.encode_cell({r,c:favCol});
        if(wsBase[addr] && String(wsBase[addr].v||'')==='★'){
          wsBase[addr].s={
            font:{name:'Aptos',sz:10,bold:true,color:{rgb:'243746'}},
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
  const catalog=ps.flatMap(pr=>pr.semesters.flatMap((sem,s)=>includeQuarter(s)?sem.map((name,c)=>({
    Programa:pr.name,
    'Acrónimo PE':programAcronym(pr),
    'Salida lateral':pr.exit,
    Cuatrimestre:s+1,
    Asignatura:subjectCase(name),
    'Horas al cuatrimestre':subjectHours(pr.id,s,c)||'',
    'Horas a la semana':weeklyHours(pr.id,s,c)||''
  })):[]));
  const wsCat=XLSX.utils.json_to_sheet(catalog);
  wsCat['!cols']=[{wch:42},{wch:13},{wch:42},{wch:12},{wch:36},{wch:18},{wch:16}];




  // --- Hoja 4: Resumen por asignatura ---
  const summary=[];
  ps.forEach(pr=>pr.semesters.forEach((sem,s)=>{ if(!includeQuarter(s))return; sem.forEach((name,c)=>{
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
  });}));
  const wsSummary=XLSX.utils.json_to_sheet(summary);
  wsSummary['!autofilter']={ref:wsSummary['!ref']};
  wsSummary['!freeze']={ySplit:1,topLeftCell:'A2',activePane:'bottomLeft',state:'frozen'};
  wsSummary['!cols']=[{wch:42},{wch:16},{wch:12},{wch:38},{wch:18},{wch:16},{wch:14},{wch:14},{wch:16},{wch:23}];




  // --- Hoja adicional: Planeación cuatrimestral ---
  // --- Hoja adicional: Comisiones ---
  const planningRows=teachers.map(t=>{
    const rec=migratePlanningRecord(JSON.parse(JSON.stringify((t.planningByPeriod||{})[cfg.periodo]||{})));
    const commissions=rec.commissionMode==='na'
      ?'No aplica'
      :(rec.commissions||[]).map((c,i)=>{
          const base=`${i+1}. ${c.name||'(sin nombre)'} · ${c.authorizedHours||0} h`;
          const schedule=c.scheduleRequired==='yes'?` · ${commissionScheduleSummary(c)}`:' · sin bloque específico';
          return base+schedule;
        }).join(' | ');
    return {
      Profesor:t.name,
      Categoria:excelCategoryAbbreviation(t.category),
      Correo:t.email||'',
      Periodo:cfg.periodo,
      'Comisiones autorizadas':rec.commissionMode==='na'?'No aplica':rec.commissionMode==='yes'?'Sí':'Sin captura',
      'Detalle de comisiones':commissions||'Sin captura',
      'Proyecto avalado':rec.projectMode==='na'?'No aplica':rec.projectMode==='yes'?'Sí':'Sin captura',
      'Nombre del proyecto':rec.projectMode==='yes'?(rec.projectName||''):'',
      'Responsabilidad':rec.projectMode==='yes'?(rec.projectRole||''):'',
      'Horas autorizadas proyecto':rec.projectMode==='yes'?(rec.projectHours||''):'',
      'Referencia / oficio':rec.projectMode==='yes'?(rec.projectReference||''):'',
      'Observaciones':rec.comments||'',
      'Información completa':rec.completedAtMs?'Sí':'',
      'Fecha de guardado':rec.completedAtMs?formatLocalProfileDateTime(rec.completedAtMs):''
    };
  });
  const wsPlanning=XLSX.utils.json_to_sheet(planningRows);
  if(planningRows.length){
    wsPlanning['!autofilter']={ref:wsPlanning['!ref']};
    wsPlanning['!freeze']={ySplit:1,topLeftCell:'A2',activePane:'bottomLeft',state:'frozen'};
    wsPlanning['!cols']=[
      {wch:30},{wch:32},{wch:28},{wch:20},{wch:20},{wch:72},{wch:18},
      {wch:38},{wch:28},{wch:22},{wch:30},{wch:52},{wch:18},{wch:24}
    ];
    const pHeaders=Object.keys(planningRows[0]);
    pHeaders.forEach((_,c)=>{
      const addr=XLSX.utils.encode_cell({r:0,c});
      if(wsPlanning[addr])wsPlanning[addr].s={
        font:{name:'Aptos',sz:10,bold:true,color:{rgb:'FFFFFF'}},
        fill:{patternType:'solid',fgColor:{rgb:'185C6B'}},
        alignment:{horizontal:'center',vertical:'center',wrapText:true},
        border:{
          top:{style:'thin',color:{rgb:'9FB6C2'}},
          bottom:{style:'thin',color:{rgb:'9FB6C2'}},
          left:{style:'thin',color:{rgb:'9FB6C2'}},
          right:{style:'thin',color:{rgb:'9FB6C2'}}
        }
      };
    });
    for(let r=1;r<=planningRows.length;r++){
      pHeaders.forEach((_,c)=>{
        const addr=XLSX.utils.encode_cell({r,c});
        if(wsPlanning[addr])wsPlanning[addr].s={
          font:{name:'Aptos',sz:10,color:{rgb:'243746'}},
          alignment:{vertical:'top',horizontal:'left',wrapText:true},
          border:{
            top:{style:'thin',color:{rgb:'D8E1E6'}},
            bottom:{style:'thin',color:{rgb:'D8E1E6'}},
            left:{style:'thin',color:{rgb:'D8E1E6'}},
            right:{style:'thin',color:{rgb:'D8E1E6'}}
          }
        };
      });
    }
  }


  const wb=XLSX.utils.book_new();
  if(exportSheets.has('concentrado'))XLSX.utils.book_append_sheet(wb,ws,'Concentrado perfiles');
  if(exportSheets.has('comisiones'))XLSX.utils.book_append_sheet(wb,wsPlanning,'Comisiones');
  if(exportSheets.has('base'))XLSX.utils.book_append_sheet(wb,wsBase,'Base maestra');
  if(exportSheets.has('catalogo'))XLSX.utils.book_append_sheet(wb,wsCat,'Catálogo');
  if(exportSheets.has('resumen'))XLSX.utils.book_append_sheet(wb,wsSummary,'Resumen por asignatura');
  if(!wb.SheetNames.length)throw new Error('Seleccione al menos una hoja para exportar.');


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




function setupPlanningAutoSave(){
  let timer=null;
  document.addEventListener('input',e=>{
    if(!planningEnabled()||!planningEditingAllowed())return;
    if(!e.target.matches('#commissionsBlock input,#commissionsBlock textarea'))return;
    clearTimeout(timer);
    timer=setTimeout(()=>{
      collectPlanning();
      persist();
      updateNavState();
    },450);
  });
  document.addEventListener('change',e=>{
    if(!planningEnabled()||!planningEditingAllowed())return;
    if(!e.target.matches('#commissionsBlock input,#commissionsBlock textarea'))return;
    collectPlanning();
    persist();
    updateNavState();
  });
}
function setupResilienceGuards(){
  window.addEventListener('online',()=>{
    if(store.syncPending){
      updateCloudStatus('Conexión recuperada · sincronizando…','warn');
      syncProfileToCloud({reason:'conexión recuperada'});
    }
  });

  window.addEventListener('offline',()=>{
    if(currentUser)updateCloudStatus('Sin conexión · guardado local activo','warn');
  });

  window.addEventListener('pagehide',()=>{
    try{
      if(currentUser)captureProfileLocallyWithoutCloud();
    }catch(_){}
  });

  window.addEventListener('beforeunload',()=>{
    try{
      if(currentUser)captureProfileLocallyWithoutCloud();
    }catch(_){}
  });
}

function init(){
  installLegacyBackupGuard();
  loadProfile();
  resetWorkflowState();
  updatePeriodBadges();
  initAuth();
  renderCurrentProgram();
  renderPlanning();
  updatePlanningAvailability();
  renderAdmin();
  applyEditState();
  lockRevisionNav();
  setupAutoSave();
  setupPlanningAutoSave();
  setupResilienceGuards();
  updateLastSavedUI();
  startCountdown();
  updateNavState();


  let resizeTimer=null;
  window.addEventListener('resize',()=>{
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(adjustSemesterColumnWidths,120);
  });
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