import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, getDocs, writeBatch as liteWriteBatch, doc as liteDoc, setDoc as liteSetDoc, updateDoc as liteUpdateDoc, collection as liteCollection, addDoc as liteAddDoc, serverTimestamp as liteServerTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-lite.js';




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
  {jefe:'Iván Gutiérrez Bautista',codigo:'EA-F-87',revision:'Rev.01',fechaRevision:'21-sep-2018',periodo:'SEP 2026 - AGO 2027',editingLocked:false,captureDeadline:null,planningEnabled:true},
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
let newSemesterCount=5,programEditorSemesters=[],auth=null,currentUser=null,authReady=false,db=null,dbLite=null,cloudSettingsUnsub=null,cloudProfileMetaUnsub=null,remoteProfileLoaded=false,cloudAvailable=false,cloudSaveTimer=null,cloudRetryTimer=null,countdownTimer=null,lastSavedAt=store.lastSavedAt||null,editingCommonRuleId=null,editingProgramId=null,teacherAdminCache={},previousTeacherAdminCache={};
let planningCommissionEditorIndex=null;
let planningCommissionEditorOpen=false;
let planningCommissionDraft=emptyCommission();
let cloudSyncInFlight=false;
let manualSaveInFlight=false;
let cloudTeacherFingerprintKnown=false;
let lastCloudTeacherFingerprint='';
let bootstrapComplete=false;
let authPersistenceReady=Promise.resolve();
let remoteProfileShadow=null;
let sessionConflictKnown=false;
let teacherAdminCacheLoaded=false;


/* =========================================================
   V93 · GUARDADO MANUAL Y BAJO CONSUMO
   - Sin sesiones exclusivas por dispositivo.
   - Sin heartbeats, leases, transferencias ni profileSessions.
   - Firestore se usa sólo para lecturas puntuales y acciones manuales.
   ========================================================= */
const CLOUD_READ_TIMEOUT_MS=6000;


function withTimeout(promise,ms,fallbackValue=null){
  let timer=null;
  return Promise.race([
    Promise.resolve(promise).then(
      value=>({kind:'value',value}),
      error=>({kind:'error',error})
    ),
    new Promise(resolve=>{
      timer=setTimeout(()=>resolve({kind:'timeout'}),Math.max(0,Number(ms)||0));
    })
  ]).then(result=>{
    if(timer)clearTimeout(timer);
    if(result.kind==='error')throw result.error;
    return result.kind==='timeout'?fallbackValue:result.value;
  });
}
const externalScriptPromises=new Map();
function loadExternalScriptOnce(src,test){
  if(test?.())return Promise.resolve(true);
  if(externalScriptPromises.has(src))return externalScriptPromises.get(src);
  const promise=new Promise(resolve=>{
    const existing=[...document.scripts].find(x=>x.src===src);
    const done=()=>resolve(!!test?.());
    if(existing){
      existing.addEventListener('load',done,{once:true});
      existing.addEventListener('error',()=>resolve(false),{once:true});
      setTimeout(done,8000);
      return;
    }
    const script=document.createElement('script');
    script.src=src;
    script.async=true;
    script.defer=true;
    script.addEventListener('load',done,{once:true});
    script.addEventListener('error',()=>resolve(false),{once:true});
    document.head.appendChild(script);
  });
  externalScriptPromises.set(src,promise);
  return promise;
}
async function ensureGoogleIdentity(){
  if(window.google?.accounts?.oauth2?.initTokenClient)return true;
  return loadExternalScriptOnce('https://accounts.google.com/gsi/client',()=>!!window.google?.accounts?.oauth2?.initTokenClient);
}
async function ensureExcelLibrary(){
  if(window.XLSX?.utils)return true;
  return loadExternalScriptOnce('https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',()=>!!window.XLSX?.utils);
}
async function ensurePdfLibraries(){
  const canvasOk=window.html2canvas?true:await loadExternalScriptOnce('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',()=>!!window.html2canvas);
  if(!canvasOk)return false;
  if(window.jspdf?.jsPDF)return true;
  return loadExternalScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',()=>!!window.jspdf?.jsPDF);
}


function sessionCanWrite(){
  // V93: no existe candado por dispositivo.
  return !!currentUser;
}
async function releaseSessionIfOwned(){
  // Compatibilidad con el cierre de sesión: no hay nada remoto que liberar.
  return true;
}


const allowedDomain=(window.PAD_ALLOWED_DOMAIN||'uteq.edu.mx').toLowerCase();
const PAD_BUILD_VERSION='V96-2026-10-01';
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
function commissionIsBlank(commission){
  if(!commission||typeof commission!=='object')return true;
  const name=String(commission.name||'').trim();
  const hours=String(commission.authorizedHours??'').trim();
  const hasSchedule=commission.scheduleRequired==='yes';
  const slots=Array.isArray(commission.reservedSlots)?commission.reservedSlots:[];
  return !name && !hours && !hasSchedule && slots.length===0;
}
function defaultPlanningRecord(){
  return {
    commissionMode:'',
    commissions:[],
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
  if(!Array.isArray(raw.commissions))raw.commissions=[];
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
function planningEnabled(){return true}
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
const PROGRAM_ORDER_V82=['ind_procesos','ind_plasticos','mec_auto','mec_ind','mec_moldes','auto_diseno','mantenimiento','nano'];
function programs(){
  const order=new Map(PROGRAM_ORDER_V82.map((id,i)=>[id,i]));
  return allPrograms()
    .filter(p=>!disabledPrograms.includes(p.id))
    .sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999));
}
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
function administrativeEditingAllowed(){
  if(isAdmin())return true;
  if(individualEditBlocked())return false;
  // Una habilitación individual del JUCA es una autorización explícita y prevalece
  // sobre cierre global, fecha límite y finalización del periodo.
  if(individualEditOverride())return true;
  if(deadlinePassed())return false;
  if(cfg.editingLocked)return false;
  if(submissionLockedForCurrentPeriod())return false;
  return true;
}
function editingLockReason(){
  if(isAdmin())return '';
  if(individualEditBlocked())return 'individual-admin';
  if(!individualEditOverride()){
    if(deadlinePassed())return 'deadline';
    if(cfg.editingLocked)return 'global-admin';
    if(submissionLockedForCurrentPeriod())return 'finalized';
  }
  if(currentUser&&!bootstrapComplete)return 'initializing';
  return '';
}
function editingAllowed(){
  if(currentUser&&!bootstrapComplete)return false;
  if(!administrativeEditingAllowed())return false;
  return true;
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
  const editSignature=[
    editingAllowed(),planningEditingAllowed(),deadlinePassed(),submissionLockedForCurrentPeriod(),
    !!cfg.editingLocked,!!store.individualEditEnabled,!!store.individualEditDisabled
  ].join('|');
  if(updateCountdownUI.lastEditSignature!==editSignature){
    updateCountdownUI.lastEditSignature=editSignature;
    applyEditState();
  }
}
function startCountdown(){
  clearInterval(countdownTimer);
  updateCountdownUI();
  countdownTimer=setInterval(updateCountdownUI,1000);
}
function requireEditing(){
  if(editingAllowed())return true;
  const reason=editingLockReason();
  if(reason==='individual-admin') toast('Administración deshabilitó temporalmente la edición de este perfil.');
  else if(reason==='finalized') toast('Este perfil ya fue finalizado. Si requiere corregirlo, solicite al JUCA habilitar su edición.');
  else if(reason==='deadline') toast('La fecha límite de captura ya concluyó. El JUCA puede habilitar individualmente su perfil si corresponde.');
  else if(reason==='global-admin') toast('La edición general está cerrada por Administración.');
  else toast('La edición se está preparando. Intente nuevamente en un momento.');
  return false;
}
function applyPlanningEditState(){
  const commissionsRoot=$('commissionsBlock');
  if(!commissionsRoot)return;
  const planningLocked=!planningEditingAllowed();
  commissionsRoot.querySelectorAll('input,select,textarea,button').forEach(el=>{
    el.disabled=planningLocked;
    el.setAttribute('aria-disabled',planningLocked?'true':'false');
  });
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
      const limitReached=el.classList.contains('profile-add-row-btn')&&el.dataset.limitReached==='1';
      el.disabled=locked||limitReached;
    });
  });
  const banner=$('editingLockedBanner');
  if(banner){
    const reason=editingLockReason();
    banner.classList.toggle('hidden',!locked);
    banner.classList.toggle('finalized-profile-banner',reason==='finalized');
    if(locked){
      if(reason==='individual-admin'){
        banner.textContent='🔒 Administración deshabilitó temporalmente la edición de este perfil. Puede consultar e imprimir la información guardada.';
      }else if(reason==='finalized'){
        banner.innerHTML=`<strong>🔒 Perfil finalizado</strong>
          <ul>
            <li>La edición está bloqueada para el periodo actual.</li>
            <li>Puede consultar e imprimir nuevamente su información cuando lo requiera.</li>
            <li>Si necesita corregir algo, solicite al JUCA la habilitación individual de edición.</li>
          </ul>`;
      }else if(reason==='deadline'){
        banner.textContent='⏱ Captura fuera de tiempo. Puede consultar e imprimir. El JUCA puede habilitar individualmente este perfil cuando proceda.';
      }else if(reason==='global-admin'){
        banner.textContent='🔒 Edición general desactivada por Administración. Puede consultar e imprimir normalmente.';
      }else{
        banner.textContent='Preparando permisos de edición…';
      }
    }
  }


  const planningLocked=!planningEditingAllowed();
  applyPlanningEditState();
  if(!isAdmin()&&individualEditBlocked()){
    clearTimeout(cloudSaveTimer);
    clearTimeout(cloudRetryTimer);
  }
  updateReviewFinalizeUI();


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
    finalizedDataRevision:Number(store.finalizedDataRevision)||0,
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
  const counts=p.rowCounts||{};
  const hasExpandedRows=(Number(counts.formation)||0)>7 || (Number(counts.docencia)||0)>4 || (Number(counts.laboral)||0)>5;
  const hasProfile=!!(p.apPat||p.apMat||p.nombres||p.categoria||p.gradoAcademico||Object.values(p.extra||{}).some(Boolean)||hasExpandedRows);
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




// =========================================================
// V90 · CONTROL DE CAMBIOS Y GUARDADO MANUAL EN FIRESTORE
// =========================================================
const FINGERPRINT_IGNORED_KEYS=new Set(['updatedAtMs','completedAtMs']);
function canonicalTeacherValue(value,key=''){
  if(FINGERPRINT_IGNORED_KEYS.has(key))return undefined;
  if(Array.isArray(value))return value.map(v=>canonicalTeacherValue(v)).filter(v=>v!==undefined);
  if(value&&typeof value==='object'){
    const out={};
    Object.keys(value).sort().forEach(k=>{
      const normalized=canonicalTeacherValue(value[k],k);
      if(normalized!==undefined)out[k]=normalized;
    });
    return out;
  }
  return value===undefined?null:value;
}
function teacherComparableState(data={}){
  return {
    profile:cloneTeacherData(data.profile||{}),
    answers:cloneTeacherData(data.answers||{}),
    programMeta:cloneTeacherData(data.programMeta||{}),
    planningByPeriod:cloneTeacherData(data.planningByPeriod||{}),
    submittedPeriod:data.submittedPeriod||null,
    finalizedAtMs:Number(data.finalizedAtMs)||null,
    finalizedDataRevision:Number(data.finalizedDataRevision)||0
  };
}
function currentTeacherComparableState(){
  return teacherComparableState({
    profile:store.profile||{},
    answers,
    programMeta,
    planningByPeriod,
    submittedPeriod:store.submittedPeriod||null,
    finalizedAtMs:Number(store.finalizedAtMs)||null,
    finalizedDataRevision:Number(store.finalizedDataRevision)||0
  });
}
function teacherFingerprint(data={}){
  return JSON.stringify(canonicalTeacherValue(teacherComparableState(data)));
}
function currentTeacherFingerprint(){
  return JSON.stringify(canonicalTeacherValue(currentTeacherComparableState()));
}
function setCloudTeacherFingerprint(data={}){
  lastCloudTeacherFingerprint=teacherFingerprint(data);
  cloudTeacherFingerprintKnown=true;
}
function teacherHasUnsavedCloudChanges(){
  if(!cloudTeacherFingerprintKnown)return !!store.syncPending;
  return currentTeacherFingerprint()!==lastCloudTeacherFingerprint;
}
function persistStoreSnapshot(){
  try{
    localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
    saveUserBackup();
  }catch(e){
    console.warn('No fue posible conservar el estado local',e);
  }
}
function refreshManualSaveStatus(){
  const pending=teacherHasUnsavedCloudChanges();
  store.syncPending=pending;
  if(currentUser){
    updateCloudStatus(
      pending?'Cambios locales sin guardar en nube':'Sin cambios pendientes',
      pending?'warn':'ok'
    );
  }
  return pending;
}
let lastCloudErrorCode='';
function normalizedCloudErrorCode(error){
  return String(error?.code||'').replace(/^firestore\//,'');
}
function cloudErrorText(error,prefix='No fue posible completar la operación'){
  const code=normalizedCloudErrorCode(error);
  if(code==='resource-exhausted')return `${prefix} · cuota diaria de Firestore agotada`;
  if(code==='permission-denied')return `${prefix} · permiso rechazado por Firestore`;
  if(code==='unavailable')return `${prefix} · servicio de Firestore no disponible`;
  if(code==='unauthenticated')return `${prefix} · sesión de Firebase no válida`;
  return prefix;
}
function showCloudWriteFailure(error,action='guardar'){
  const code=normalizedCloudErrorCode(error);
  if(code==='resource-exhausted'){
    alert(`No fue posible ${action}.\n\nFirestore agotó la cuota disponible del proyecto. No se perdió la información capturada en este dispositivo y no se realizó ningún borrado.\n\nVuelva a intentarlo cuando la cuota se haya restablecido.`);
    return;
  }
  if(code==='permission-denied'){
    alert(`No fue posible ${action}.\n\nFirestore rechazó la operación por permisos. No se eliminó información académica.`);
    return;
  }
  alert(`No fue posible ${action}.\n\nCódigo: ${code||'sin código'}.\n\nLa información capturada permanece conservada localmente.`);
}


async function saveTeacherChangesNow(reason='guardado manual'){
  if(manualSaveInFlight){
    toast('Ya hay un guardado en curso.');
    return {ok:false,wrote:false,busy:true};
  }
  if(!db||!currentUser||!remoteProfileLoaded){
    updateCloudStatus('Nube no disponible · cambios conservados localmente','warn');
    toast('No se pudo confirmar el guardado en nube. No se avanzó.');
    return {ok:false,wrote:false};
  }
  if(!isAdmin()&&individualEditBlocked()){
    updateCloudStatus('Edición bloqueada por Administración · datos conservados','readonly');
    return {ok:false,wrote:false};
  }
  if(!sessionCanWrite()){
    updateCloudStatus('Sin control de edición · cambios conservados localmente','warn');
    toast('Este dispositivo no tiene el control de edición. No se avanzó.');
    return {ok:false,wrote:false};
  }


  if(cloudTeacherFingerprintKnown&&!teacherHasUnsavedCloudChanges()){
    store.syncPending=false;
    persistStoreSnapshot();
    updateCloudStatus('Sin cambios nuevos · no se realizó escritura','ok');
    return {ok:true,wrote:false};
  }


  manualSaveInFlight=true;
  updateCloudStatus('Guardando cambios…','warn');
  try{
    const before=currentTeacherFingerprint();
    lastCloudErrorCode='';
    const ok=await forceProfileCheckpointToCloud(reason);
    if(!ok){
      if(lastCloudErrorCode==='resource-exhausted')toast('Cuota de Firestore agotada. Tus cambios siguen en este dispositivo.');
      else toast('No se pudo confirmar el guardado en nube. Tus cambios siguen en este dispositivo.');
      return {ok:false,wrote:false};
    }
    // Si algo cambió durante la escritura, no avanzamos con cambios todavía pendientes.
    if(currentTeacherFingerprint()!==before){
      store.syncPending=true;
      persistStoreSnapshot();
      updateCloudStatus('Se guardó una versión, pero hay cambios nuevos pendientes','warn');
      toast('Se detectaron cambios nuevos durante el guardado. Guarda nuevamente para continuar.');
      return {ok:false,wrote:true};
    }
    updateCloudStatus('Cambios guardados en nube','ok');
    return {ok:true,wrote:true};
  }finally{
    manualSaveInFlight=false;
  }
}


function persist(options={}){
  const {touch=true}=options;
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


  const fingerprint=currentTeacherFingerprint();
  const previousLocalFingerprint=String(store.lastLocalTeacherFingerprint||'');
  const teacherDataChanged=!previousLocalFingerprint || fingerprint!==previousLocalFingerprint;
  if(touch&&teacherDataChanged){
    store.localUpdatedAt=now;
    store.dataRevision=(Number(store.dataRevision)||0)+1;
  }
  store.lastLocalTeacherFingerprint=fingerprint;
  store.syncPending=cloudTeacherFingerprintKnown
    ? fingerprint!==lastCloudTeacherFingerprint
    : (!!store.syncPending || (touch&&teacherDataChanged));


  lastSavedAt=store.lastSavedAt;
  try{
    localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
    saveUserBackup();
  }catch(e){
    console.error('No fue posible guardar localmente el perfil',e);
    updateCloudStatus('Error de almacenamiento local','warn');
  }
  updateLastSavedUI();
  // V90: persist() NUNCA escribe en Firestore. La nube se toca sólo desde una acción manual.
  if(currentUser&&store.syncPending){
    updateCloudStatus('Cambios locales sin guardar en nube','warn');
  }
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
  el.textContent=`Borrador local: ${new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit'}).format(new Date(lastSavedAt))}`;
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
    await liteSetDoc(liteDoc(dbLite,'settings','app'),{...globalSettingsPayload(),updatedAt:liteServerTimestamp(),updatedBy:currentUser.email},{merge:true});
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
    await liteAddDoc(liteCollection(dbLite,'audit'),{action,email:currentUser.email||'',uid:currentUser.uid,at:liteServerTimestamp(),period:cfg.periodo});
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
  store.finalizedDataRevision=0;
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
function cloneTeacherData(value){
  try{return JSON.parse(JSON.stringify(value??{}))}catch(_){return {}}
}
function mergeProfilePreservingRemote(remoteProfile={},localProfile={}){
  const out={...cloneTeacherData(remoteProfile),...cloneTeacherData(localProfile)};
  out.extra={...(remoteProfile?.extra||{}),...(localProfile?.extra||{})};
  out.rowCounts={...(remoteProfile?.rowCounts||{}),...(localProfile?.rowCounts||{})};
  return out;
}
function mergeRecordPreservingRemote(remoteRecord={},localRecord={}){
  return {...cloneTeacherData(remoteRecord),...cloneTeacherData(localRecord)};
}
function updateRemoteProfileShadow(data){
  if(!data||typeof data!=='object')return;
  remoteProfileShadow={
    profile:cloneTeacherData(data.profile||remoteProfileShadow?.profile||{}),
    answers:cloneTeacherData(data.answers||remoteProfileShadow?.answers||{}),
    programMeta:cloneTeacherData(data.programMeta||remoteProfileShadow?.programMeta||{}),
    planningByPeriod:cloneTeacherData(data.planningByPeriod||remoteProfileShadow?.planningByPeriod||{}),
    submittedPeriod:Object.prototype.hasOwnProperty.call(data,'submittedPeriod')?(data.submittedPeriod||null):(remoteProfileShadow?.submittedPeriod||null),
    finalizedAtMs:Object.prototype.hasOwnProperty.call(data,'finalizedAtMs')?(Number(data.finalizedAtMs)||null):(Number(remoteProfileShadow?.finalizedAtMs)||null),
    finalizedDataRevision:Object.prototype.hasOwnProperty.call(data,'finalizedDataRevision')?(Number(data.finalizedDataRevision)||0):(Number(remoteProfileShadow?.finalizedDataRevision)||0)
  };
  setCloudTeacherFingerprint(remoteProfileShadow);
}
function preserveUserBackupForRecovery(reason='respaldo preventivo'){
  if(!currentUser)return false;
  const backup=readUserBackup();
  if(!backupHasTeacherData(backup))return false;
  try{
    const key=`PAD_UTEQ_RECOVERY_${currentUser.uid}_${Date.now()}`;
    localStorage.setItem(key,JSON.stringify({reason,savedAt:Date.now(),backup}));
    return true;
  }catch(e){console.warn('No fue posible crear copia local preventiva',e);return false}
}
async function archiveTeacherProfileBeforeChange(uid,reason){
  if(!isAdmin()||!db)throw new Error('Archivo administrativo no disponible.');
  const ref=doc(db,'profiles',uid);
  const snap=await getDoc(ref);
  if(!snap.exists())throw new Error('El perfil seleccionado no existe.');
  const data=snap.data()||{};
  const archiveId=String(Date.now());
  await liteSetDoc(liteDoc(dbLite,'profileArchives',uid,'snapshots',archiveId),{
    ...data,
    archivedUid:uid,
    archiveReason:reason,
    archivedAt:liteServerTimestamp(),
    archivedAtMs:Date.now(),
    archivedBy:currentUser?.email||''
  });
  return data;
}


function profileCloudPayload({releaseEditOverride=false}={}){
  const remote=remoteProfileShadow||{};
  const payload={
    uid:currentUser?.uid||'',
    email:currentUser?.email||'',
    displayName:currentUser?.displayName||'',
    profile:mergeProfilePreservingRemote(remote.profile||{},store.profile||{}),
    answers:mergeRecordPreservingRemote(remote.answers||{},answers),
    programMeta:mergeRecordPreservingRemote(remote.programMeta||{},programMeta),
    period:cfg.periodo,
    submittedPeriod:store.submittedPeriod||null,
    finalizedAtMs:store.finalizedAtMs||null,
    finalizedDataRevision:Number(store.finalizedDataRevision)||0,
    planningByPeriod:mergeRecordPreservingRemote(remote.planningByPeriod||{},planningByPeriod),
    clientUpdatedAt:Number(store.localUpdatedAt)||Date.now(),
    dataRevision:Number(store.dataRevision)||0,
    updatedAt:liteServerTimestamp()
  };
  // Los controles administrativos nunca viajan en el guardado manual del profesor.
  // La única excepción es cerrar una reapertura individual al finalizar de nuevo.
  if(releaseEditOverride)payload.individualEditEnabled=false;
  return payload;
}
function scheduleCloudRetry(){
  // V90: no existen reintentos automáticos de escritura del perfil.
  // Se conserva esta función para compatibilidad con llamadas antiguas, pero sólo informa estado.
  clearTimeout(cloudRetryTimer);
  if(!currentUser||!store.syncPending)return;
  updateCloudStatus(
    navigator.onLine===false
      ?'Sin conexión · cambios conservados localmente'
      :'Cambios locales pendientes · use Guardar y continuar',
    'warn'
  );
}
async function syncProfileToCloud({reason='guardado manual',releaseEditOverride=false,force=false}={}){
  if(!db||!currentUser||cloudSyncInFlight)return false;
  if(!isAdmin()&&individualEditBlocked()){
    updateCloudStatus('Edición bloqueada por Administración · datos conservados','readonly');
    return false;
  }
  if(!sessionCanWrite()){
    updateCloudStatus('Sin control de edición · cambios conservados localmente','warn');
    return false;
  }


  const fingerprintBefore=currentTeacherFingerprint();
  if(!force&&!releaseEditOverride&&cloudTeacherFingerprintKnown&&fingerprintBefore===lastCloudTeacherFingerprint){
    store.syncPending=false;
    persistStoreSnapshot();
    updateCloudStatus('Sin cambios nuevos · no se realizó escritura','ok');
    return true;
  }


  cloudSyncInFlight=true;
  const version=Number(store.localUpdatedAt)||Date.now();
  try{
    const safePayload=profileCloudPayload({releaseEditOverride});
    await liteSetDoc(liteDoc(dbLite,'profiles',currentUser.uid),safePayload,{merge:true});
    updateRemoteProfileShadow(safePayload);
    lastCloudTeacherFingerprint=fingerprintBefore;
    cloudTeacherFingerprintKnown=true;
    store.cloudUpdatedAt=version;
    store.lastCloudSavedAt=Date.now();
    store.syncPending=currentTeacherFingerprint()!==lastCloudTeacherFingerprint;
    store.lastLocalTeacherFingerprint=currentTeacherFingerprint();
    persistStoreSnapshot();
    updateCloudStatus(
      store.syncPending?'Guardado confirmado · hay cambios nuevos pendientes':'Cambios guardados en nube',
      store.syncPending?'warn':'ok'
    );
    return true;
  }catch(e){
    lastCloudErrorCode=normalizedCloudErrorCode(e);
    console.warn(`Guardado en nube no disponible (${reason})`,e);
    store.syncPending=true;
    persistStoreSnapshot();
    updateCloudStatus('Cambios locales sin guardar en nube','warn');
    return false;
  }finally{
    cloudSyncInFlight=false;
  }
}
function scheduleCloudProfileSave(){
  // V90: compatibilidad. Deliberadamente NO programa escrituras automáticas.
  clearTimeout(cloudSaveTimer);
  if(currentUser&&store.syncPending){
    updateCloudStatus('Cambios locales sin guardar en nube','warn');
  }
}
async function forceProfileCheckpointToCloud(reason='guardado manual',options={}){
  const force=!!options.force;
  const releaseEditOverride=!!options.releaseEditOverride;
  if(!db||!currentUser)return false;
  if(!isAdmin()&&individualEditBlocked()){
    updateCloudStatus('Edición bloqueada por Administración · datos conservados','readonly');
    return false;
  }
  if(!sessionCanWrite()){
    updateCloudStatus('Sin control de edición · cambios conservados localmente','warn');
    return false;
  }


  const fingerprintBefore=currentTeacherFingerprint();
  if(!force&&cloudTeacherFingerprintKnown&&fingerprintBefore===lastCloudTeacherFingerprint){
    store.syncPending=false;
    store.lastLocalTeacherFingerprint=fingerprintBefore;
    persistStoreSnapshot();
    updateCloudStatus('Sin cambios nuevos · no se realizó escritura','ok');
    return true;
  }


  try{
    const safePayload=profileCloudPayload({releaseEditOverride});
    await liteSetDoc(liteDoc(dbLite,'profiles',currentUser.uid),safePayload,{merge:true});
    updateRemoteProfileShadow(safePayload);
    lastCloudTeacherFingerprint=fingerprintBefore;
    cloudTeacherFingerprintKnown=true;
    store.cloudUpdatedAt=Number(store.localUpdatedAt)||Date.now();
    store.lastCloudSavedAt=Date.now();
    store.syncPending=currentTeacherFingerprint()!==lastCloudTeacherFingerprint;
    store.lastLocalTeacherFingerprint=currentTeacherFingerprint();
    persistStoreSnapshot();
    updateCloudStatus(
      store.syncPending?'Guardado confirmado · hay cambios nuevos pendientes':'Cambios guardados en nube',
      store.syncPending?'warn':'ok'
    );
    return true;
  }catch(e){
    lastCloudErrorCode=normalizedCloudErrorCode(e);
    console.warn(`No fue posible confirmar ${reason}`,e);
    store.syncPending=true;
    persistStoreSnapshot();
    updateCloudStatus('Cambios locales sin guardar en nube','warn');
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
  store.lastLocalTeacherFingerprint=currentTeacherFingerprint();
  localStorage.setItem('PAD_UTEQ',JSON.stringify({
    ...store,cfg,customPrograms,programOverrides,disabledPrograms,
    programAcronyms,commonRules,transversalRules,currentProgramIndex:0,lastSavedAt
  }));
  saveUserBackup();
  buildProfileRows();
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
  if('finalizedDataRevision' in backup)store.finalizedDataRevision=Number(backup.finalizedDataRevision)||0;
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




async function loadRemoteProfile({preferRemote=false}={}){
  if(!db||!currentUser)return;
  try{
    const snap=await withTimeout(getDoc(doc(db,'profiles',currentUser.uid)),CLOUD_READ_TIMEOUT_MS,null);
    if(!snap)throw new Error('Tiempo de espera agotado al recuperar el perfil');
    if(snap.exists()){
      const d=snap.data()||{};
      updateRemoteProfileShadow(d);
      const backup=readUserBackup();




      // V94 · RESGUARDO NO DESTRUCTIVO.
      // Un perfil resguardado conserva íntegramente sus datos y queda en solo lectura.
      if(d.deletedByAdmin===true){
        updateRemoteProfileShadow(d);
        applyProfileContent(d);
        if('submittedPeriod' in d)store.submittedPeriod=d.submittedPeriod||null;
        if('finalizedAtMs' in d)store.finalizedAtMs=Number(d.finalizedAtMs)||null;
        store.finalizedDataRevision=Number(d.finalizedDataRevision)||0;
        store.individualEditEnabled=false;
        store.individualEditDisabled=true;
        store.profileDeletionToken=d.profileDeletionToken||null;
        store.localUpdatedAt=Number(d.clientUpdatedAt)||timestampToMs(d.updatedAt)||timestampToMs(d.deletedAt)||Date.now();
        store.cloudUpdatedAt=store.localUpdatedAt;
        store.syncPending=false;
        currentProgramIndex=0;
        store.currentProgramIndex=0;
        localStorage.setItem('PAD_UTEQ',JSON.stringify({...store,cfg,answers,programMeta,customPrograms,programOverrides,disabledPrograms,programAcronyms,commonRules,transversalRules,planningByPeriod,currentProgramIndex:0,lastSavedAt}));
        saveUserBackup();
        renderLoadedProfile();
        remoteProfileLoaded=true;
        applyEditState();
        updateNavState();
        updateCloudStatus('Perfil resguardado por Administración · solo lectura','readonly');
        toast('Este perfil está resguardado por Administración. La información permanece conservada y no puede modificarse hasta que sea restaurado.');
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
      const localIsNewer=!preferRemote && !!backup && !explicitResetIsNew && (
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
        store.finalizedDataRevision=Number(d.finalizedDataRevision)||((store.submittedPeriod===cfg.periodo&&store.finalizedAtMs&&!d.individualEditEnabled)?remoteRevision:0);
        store.localUpdatedAt=localUpdatedAt;
        store.dataRevision=localRevision||Number(store.dataRevision)||0;
        store.syncPending=true;
        renderLoadedProfile();
        remoteProfileLoaded=true;
        updateCloudStatus('Cambios locales recuperados · guardado manual pendiente','warn');
        scheduleCloudRetry();
      }else{
        applyProfileContent(d);
        if('submittedPeriod' in d)store.submittedPeriod=d.submittedPeriod||null;
        if('finalizedAtMs' in d)store.finalizedAtMs=Number(d.finalizedAtMs)||null;
        store.finalizedDataRevision=Number(d.finalizedDataRevision)||((store.submittedPeriod===cfg.periodo&&store.finalizedAtMs&&!d.individualEditEnabled)?remoteRevision:0);
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
      setCloudTeacherFingerprint({});
      const backup=readUserBackup();
      if(backupHasTeacherData(backup)){
        // Firestore todavía no contiene el documento, pero existe una copia válida del mismo UID.
        // Se recupera primero y después se intenta reconstruir la copia en nube; nunca se destruye al cerrar sesión.
        applyProfileContent(backup);
        currentProgramIndex=0;
        store.submittedPeriod=backup.submittedPeriod||null;
        store.finalizedAtMs=Number(backup.finalizedAtMs)||null;
        store.finalizedDataRevision=Number(backup.finalizedDataRevision)||0;
        store.profileResetToken=backup.profileResetToken||null;
        store.profileDeletionToken=backup.profileDeletionToken||null;
        store.localUpdatedAt=Number(backup.localUpdatedAt)||Date.now();
        store.cloudUpdatedAt=Number(backup.cloudUpdatedAt)||0;
        store.dataRevision=Number(backup.dataRevision)||Number(store.dataRevision)||0;
        store.syncPending=true;
        renderLoadedProfile();
        remoteProfileLoaded=true;
        updateCloudStatus('Perfil recuperado · guardado manual en nube pendiente','warn');
        scheduleCloudRetry();
      }else{
        resetLocalTeacherData({keepProfile:false});
        remoteProfileLoaded=true;
        updateCloudStatus('Perfil nuevo · guardado manual listo','ok');
      }
    }
  }catch(e){
    remoteProfileLoaded=true;
    cloudTeacherFingerprintKnown=false;
    console.warn('Perfil remoto no disponible',e);
    const backup=readUserBackup();
    if(backup){
      applyProfileContent(backup);
      store.submittedPeriod=backup.submittedPeriod||store.submittedPeriod||null;
      store.finalizedAtMs=Number(backup.finalizedAtMs)||store.finalizedAtMs||null;
      store.finalizedDataRevision=Number(backup.finalizedDataRevision)||Number(store.finalizedDataRevision)||0;
      store.localUpdatedAt=Number(backup.localUpdatedAt)||Number(store.localUpdatedAt)||Date.now();
      store.dataRevision=Number(backup.dataRevision)||Number(store.dataRevision)||0;
      store.syncPending=true;
      renderLoadedProfile();
    }
    updateCloudStatus('Modo local · guardado manual pendiente','warn');
    scheduleCloudRetry();
  }
}
async function initCloud(){
  if(!db||!currentUser)return;
  cloudAvailable=true;


  // V93: una sola lectura de configuración al iniciar. No hay listener permanente.
  try{
    const ref=doc(db,'settings','app');
    const first=await withTimeout(getDoc(ref),CLOUD_READ_TIMEOUT_MS,null);
    if(first?.exists()){
      applyGlobalSettings(first.data());
    }else if(first&&isAdmin()&&dbLite){
      await liteSetDoc(
        liteDoc(dbLite,'settings','app'),
        {...globalSettingsPayload(),updatedAt:liteServerTimestamp(),updatedBy:currentUser.email},
        {merge:true}
      );
    }else if(!first){
      updateCloudStatus('Configuración local disponible · nube no respondió','warn');
    }
  }catch(e){
    console.warn('Configuración remota no disponible',e);
    updateCloudStatus(cloudErrorText(e,'Configuración local disponible'),'warn');
  }


  // V93: una sola lectura del perfil al iniciar. No existe onSnapshot permanente.
  // Los cambios de permiso hechos por Administración se aplican al recargar la página.
  await loadRemoteProfile();
}
async function loadTeachersForExport(){
  if(!db||!isAdmin()){
    return [{name:fullName()||'(Profesor sin nombre)',category:store.profile?.categoria||'',answers,programMeta,planningByPeriod,email:currentUser?.email||''}];
  }
  const snap=await getDocs(collection(db,'profiles'));
  const rows=[];
  snap.forEach(ds=>{
    const d=ds.data()||{};
    if(d.deletedByAdmin===true)return;
    if(!cloudHasTeacherData(d)&&!d.email&&!d.displayName)return;
    const p=d.profile||{};
    const cached=previousTeacherAdminCache[ds.id]||teacherAdminCache[ds.id]||{};
    const name=[p.apPat,p.apMat,p.nombres].filter(Boolean).join(' ')||cached.name||d.displayName||d.email||'(Sin nombre)';
    rows.push({name,category:p.categoria||cached.categoria||'',answers:d.answers||{},programMeta:d.programMeta||{},planningByPeriod:d.planningByPeriod||{},email:d.email||cached.email||'',uid:ds.id,submittedPeriod:d.submittedPeriod||null,finalizedAtMs:Number(d.finalizedAtMs)||null});
  });
  if(!rows.length)throw new Error('Firestore respondió, pero no devolvió perfiles con información. No se generará un Excel vacío.');
  return rows;
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
async function waitForGoogleIdentity(timeoutMs=10000){
  if(googleIdentityReady())return true;
  const loaded=await withTimeout(ensureGoogleIdentity(),timeoutMs,false);
  return !!loaded&&googleIdentityReady();
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
    const loadingAuth=!!currentUser&&!authReady;
    const syncingProfile=!!currentUser&&authReady&&!bootstrapComplete;
    const userLabel=currentUser?`${currentUser.email}${isAdmin()?' · administrador':''}`:`Sin sesión · use una cuenta @${allowedDomain}`;
    gateStatus.textContent=loadingAuth
      ?`${currentUser.email} · preparando acceso…`
      :(syncingProfile?`${currentUser.email} · perfil disponible · sincronizando…`:userLabel);
    topStatus.textContent=loadingAuth
      ?`${currentUser.email} · preparando acceso…`
      :(syncingProfile?`${currentUser.email} · perfil disponible · sincronizando…`:userLabel);
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
  const gateBtn=$('btnLoginGate'),topBtn=$('btnLogin');
  [gateBtn,topBtn].filter(Boolean).forEach(btn=>{btn.disabled=true;btn.dataset.originalText=btn.textContent;btn.textContent='Abriendo Google…'});
  try{
    await authPersistenceReady;
    const googleReady=await ensureGoogleIdentity();
    if(!googleReady){
      alert(googleAuthErrorMessage('No fue posible cargar el servicio de acceso de Google. Revise la conexión y vuelva a intentarlo.'));
      return false;
    }
    return await signInWithGoogleIdentity();
  }finally{
    [gateBtn,topBtn].filter(Boolean).forEach(btn=>{btn.disabled=false;btn.textContent=btn.dataset.originalText||'Ingresar con cuenta institucional';delete btn.dataset.originalText});
  }
}
window.signOutApp=async function(){
  const uid=currentUser?.uid||null;
  try{
    if(uid){
      try{
        if($('apPat'))store.profile=profileFromInputs();
        if(planningEnabled()&&$('commissionsBlock')){
          try{collectPlanning()}catch(_){}
        }
        persist({touch:true,schedule:false});
      }catch(e){
        console.warn('No fue posible capturar el último estado visual antes del cierre',e);
      }
      saveUserBackup();


      // V90: cerrar sesión NO escribe automáticamente el perfil en Firestore.
      if(teacherHasUnsavedCloudChanges()){
        const closeAnyway=confirm(
          'Hay cambios que todavía no se han guardado en la nube. Permanecerán respaldados en este dispositivo, pero no estarán disponibles en otro dispositivo hasta que use “Guardar y continuar”.\n\n¿Desea cerrar sesión de todos modos?'
        );
        if(!closeAnyway){
          updateCloudStatus('Cambios locales pendientes · sesión conservada','warn');
          return false;
        }
      }
    }


    await releaseSessionIfOwned();
    if(auth)await signOut(auth);


    // Se elimina sólo la copia de trabajo compartida por privacidad.
    // Se conservan PAD_UTEQ_PROFILE_<UID> y PAD_UTEQ_GLOBAL_SETTINGS.
    localStorage.removeItem('PAD_UTEQ');
    try{
      [...Object.keys(sessionStorage)]
        .filter(k=>k.startsWith('PAD_CAPTURE_ORIENTATION_'))
        .forEach(k=>sessionStorage.removeItem(k));
    }catch(_){}
    location.reload();
    return true;
  }catch(e){
    console.error('No fue posible cerrar la sesión',e);
    toast('No fue posible cerrar la sesión. Intente nuevamente.');
    return false;
  }
}




function initAuth(){
  if(!authConfigured()){updateAuthUI();return}
  const fbApp=initializeApp(window.FIREBASE_CONFIG);
  auth=getAuth(fbApp);
  db=getFirestore(fbApp);
  dbLite=db;




  // Se configura al iniciar la aplicación. Así el clic de acceso queda
  // libre para abrir Google inmediatamente, algo importante en Safari/iOS.
  authPersistenceReady=setPersistence(auth,browserLocalPersistence).catch(e=>{
    console.warn('No fue posible establecer persistencia local de Auth',e);
  });




  onAuthStateChanged(auth,async user=>{
    currentUser=user;
    remoteProfileLoaded=false;
    remoteProfileShadow=null;
    cloudTeacherFingerprintKnown=false;
    lastCloudTeacherFingerprint='';
    bootstrapComplete=false;
    authReady=false;


    if(user&&!isInstitutional(user.email||'')){
      await signOut(auth);
      currentUser=null;
      updateAuthUI();
      showInstitutionalAccessMessage(`La cuenta seleccionada no pertenece al dominio autorizado @${allowedDomain}.`);
      return;
    }


    if(!currentUser){
      bootstrapComplete=true;
      updateAuthUI();
      updateCountdownUI();
      return;
    }


    // V87.1: una copia local dañada o un error de render nunca puede bloquear el acceso.
    try{
      restoreUserBackupBeforeCloud();
    }catch(e){
      console.error('No fue posible restaurar la copia local; se continuará con la sesión autenticada.',e);
      updateCloudStatus('Sesión iniciada · recuperación local pendiente','warn');
    }
    authReady=true;
    updateAuthUI();
    applyEditState();
    updateNavState();


    try{
      await initCloud();
    }catch(e){
      console.warn('El arranque en nube quedó pendiente; se conserva el modo local',e);
      updateCloudStatus('Modo local · guardado manual pendiente','warn');
      scheduleCloudRetry();
    }finally{
      bootstrapComplete=true;
      updateAuthUI();
      updateCountdownUI();
      applyEditState();
      updateNavState();
    }
  });
}








function updateStepLabels(){
  if($('profileStepBadge'))$('profileStepBadge').textContent='Paso 1 de 3';
  if($('captureStepKicker'))$('captureStepKicker').textContent='Paso 2 de 3';
  if($('reviewStepKicker'))$('reviewStepKicker').textContent='Paso 3 de 3';
}
function updatePlanningAvailability(){
  cfg.planningEnabled=true;
  const block=$('commissionsBlock');
  if(block){
    block.classList.remove('hidden');
    block.style.display='';
  }
  updateStepLabels();
}
window.togglePlanningPage=async function(){
  cfg.planningEnabled=true;
  updatePlanningAvailability();
  toast('El apartado de Comisiones permanece habilitado.');
}




function renderCommissionScheduleGrid(commission){
  const selected=new Set(commission.reservedSlots||[]);
  return `<div id="commissionEditorSchedule" class="commission-schedule-grid ${commission.scheduleRequired==='yes'?'':'hidden'}">
    <div class="commission-schedule-caption">Horario que debe bloquearse para atender esta comisión</div>
    <div class="compact-schedule">
      ${PLANNING_DAYS.map(day=>`<div class="compact-day">
        <b>${day.label}</b>
        <div class="compact-slots">
          ${PLANNING_SLOTS.map(([start,end],slotIndex)=>{
            const slot=planningSlotKey(day.key,start,end);
            return `<label class="compact-slot ${slotIndex===PLANNING_SLOTS.length-1?'late':''}" title="${day.label} ${start}-${end}">
              <input type="checkbox" data-commission-editor-slot="${slot}" ${selected.has(slot)?'checked':''}>
              <span>${start.replace(':00','')} a ${end.replace(':00','')}</span>
            </label>`;
          }).join('')}
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}
function renderCommissionSummary(c,i){
  const schedule=commissionScheduleSummary(c);
  const safeSchedule=c.scheduleRequired==='yes'&&schedule?schedule:'Sin bloqueo horario específico';
  return `<div class="commission-summary-card" data-commission-summary="${i}">
    <div class="commission-summary-cell commission-summary-name">
      <span>Comisión</span>
      <strong>${escapeHtml(c.name||`Comisión ${i+1}`)}</strong>
    </div>
    <div class="commission-summary-cell commission-summary-hours">
      <span>Horas</span>
      <strong>${escapeHtml(String(c.authorizedHours||'0'))} h</strong>
    </div>
    <div class="commission-summary-cell commission-summary-schedule" title="${escapeHtml(safeSchedule)}">
      <span>Horario bloqueado</span>
      <strong>${escapeHtml(safeSchedule)}</strong>
    </div>
    <div class="commission-summary-actions">
      <button type="button" class="commission-summary-edit" onclick="editPlanningCommission(${i})">Editar</button>
      <button type="button" class="commission-summary-delete" onclick="removePlanningCommission(${i})">Eliminar</button>
    </div>
  </div>`;
}
function renderCommissionEditor(){
  if(!planningCommissionEditorOpen)return '';
  const c=planningCommissionDraft||emptyCommission();
  const editing=Number.isInteger(planningCommissionEditorIndex);
  return `<div id="commissionEditor" class="commission-entry commission-editor" data-commission-editor="1">
    <div class="commission-editor-head">
      <div>
        <div class="commission-editor-title">${editing?'Editar comisión':'Agregar comisión'}</div>
        <div class="commission-editor-subtitle">Capture nombre, horas autorizadas y, solo si corresponde, el horario que debe bloquearse.</div>
      </div>
    </div>
    <div class="commission-entry-top commission-editor-fields">
      <label class="commission-name-field">Nombre de la comisión
        <input id="commissionEditorName" value="${escapeHtml(c.name||'')}" placeholder="Ej. Enlace de calidad, tutoría, visitas..." autocomplete="off">
      </label>
      <label class="commission-hours-field">Horas autorizadas
        <input id="commissionEditorHours" type="number" min="0" step="0.5" inputmode="decimal" value="${escapeHtml(String(c.authorizedHours||''))}" placeholder="Ej. 3">
      </label>
    </div>
    <div class="commission-schedule-question">
      <span>¿Requiere un <b>horario específico que deba bloquearse</b>?</span>
      <label class="mini-choice yes"><input type="radio" name="commissionEditorSchedule" value="yes" ${c.scheduleRequired==='yes'?'checked':''} onchange="commissionScheduleChanged('yes')"> Sí</label>
      <label class="mini-choice no"><input type="radio" name="commissionEditorSchedule" value="no" ${c.scheduleRequired!=='yes'?'checked':''} onchange="commissionScheduleChanged('no')"> No</label>
    </div>
    ${renderCommissionScheduleGrid(c)}
    <div class="commission-editor-actions">
      <button type="button" class="commission-inline-save-btn" onclick="savePlanningCommission()">✓ ${editing?'Actualizar comisión':'Agregar comisión'}</button>
      <button type="button" class="commission-editor-cancel" onclick="cancelPlanningCommissionEdit()">Cancelar</button>
    </div>
  </div>`;
}
function renderPlanningCommissions(){
  const root=$('planningCommissionList');
  if(!root)return;
  const record=currentPlanningRecord(true);
  record.commissions=(record.commissions||[]).filter(c=>!commissionIsBlank(c));
  root.innerHTML=`
    <div class="commission-list-toolbar">
      <div class="commission-list-toolbar-copy">
        <strong>Comisiones registradas</strong>
        <span>${record.commissions.length?`${record.commissions.length} registrada${record.commissions.length===1?'':'s'}`:'Aún no ha agregado ninguna comisión.'}</span>
      </div>
      <button type="button" class="commission-inline-add-btn commission-toolbar-add" onclick="addPlanningCommission()">＋ Agregar comisión</button>
    </div>
    <div class="commission-summary-list">
      ${record.commissions.length
        ?record.commissions.map((c,i)=>renderCommissionSummary(c,i)).join('')
        :'<div class="commission-summary-empty">Seleccione “Agregar comisión” para capturar nombre, horas y, si aplica, el horario que debe bloquearse.</div>'}
    </div>
    ${renderCommissionEditor()}`;
  requestAnimationFrame(applyPlanningEditState);
}
function renderPlanning(){
  const root=$('commissionsBlock');
  if(!root)return;
  const record=currentPlanningRecord(true);
  cfg.planningEnabled=true;


  root.querySelectorAll('input[name="planningCommissionMode"]').forEach(x=>x.checked=x.value===record.commissionMode);
  root.querySelectorAll('input[name="planningProjectMode"]').forEach(x=>x.checked=x.value===record.projectMode);


  planningCommissionEditorIndex=null;
  planningCommissionEditorOpen=false;
  planningCommissionDraft=emptyCommission();
  renderPlanningCommissions();
  if($('planningProjectName'))$('planningProjectName').value=record.projectName||'';
  if($('planningProjectRole'))$('planningProjectRole').value=record.projectRole||'';
  if($('planningProjectHours'))$('planningProjectHours').value=record.projectHours||'';
  if($('planningProjectReference'))$('planningProjectReference').value=record.projectReference||'';
  if($('planningComments'))$('planningComments').value=record.comments||'';


  updatePlanningConditionalUI();
  updatePlanningAvailability();
  applyPlanningEditState();
}
function updatePlanningConditionalUI(){
  const record=currentPlanningRecord(true);
  if($('planningCommissionsFields'))$('planningCommissionsFields').classList.toggle('hidden',record.commissionMode!=='yes');
  if($('planningProjectFields'))$('planningProjectFields').classList.toggle('hidden',record.projectMode!=='yes');
}
function collectCommissionEditorFromDom(){
  if(!planningCommissionEditorOpen)return planningCommissionDraft||emptyCommission();
  const name=$('commissionEditorName')?.value.trim()||'';
  const authorizedHours=$('commissionEditorHours')?.value.trim()||'';
  const scheduleRequired=document.querySelector('input[name="commissionEditorSchedule"]:checked')?.value||'no';
  const reservedSlots=[...document.querySelectorAll('[data-commission-editor-slot]:checked')].map(x=>x.dataset.commissionEditorSlot);
  planningCommissionDraft={name,authorizedHours,scheduleRequired,reservedSlots};
  return planningCommissionDraft;
}
function collectPlanning(){
  const record=currentPlanningRecord(true);
  record.commissionMode=document.querySelector('input[name="planningCommissionMode"]:checked')?.value||record.commissionMode||'';
  record.projectMode=document.querySelector('input[name="planningProjectMode"]:checked')?.value||record.projectMode||'';
  record.commissions=(record.commissions||[]).filter(c=>!commissionIsBlank(c));


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
  const record=collectPlanning();
  updatePlanningConditionalUI();
  persist({schedule:false});
  updateNavState();
  applyPlanningEditState();
  if(record.commissionMode==='yes'&&!planningCommissionEditorOpen){
    requestAnimationFrame(()=>$('planningCommissionList')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
  }
}
window.commissionScheduleChanged=function(value){
  if(!planningCommissionEditorOpen)return;
  collectCommissionEditorFromDom();
  planningCommissionDraft.scheduleRequired=value;
  if(value!=='yes'){
    planningCommissionDraft.reservedSlots=[];
    document.querySelectorAll('[data-commission-editor-slot]').forEach(x=>x.checked=false);
  }
  $('commissionEditorSchedule')?.classList.toggle('hidden',value!=='yes');
}
window.savePlanningCommission=function(){
  if(!planningEditingAllowed()){toast('La edición está cerrada.');return false}
  if(!planningCommissionEditorOpen){toast('Seleccione “Agregar comisión”.');return false}
  const draft=collectCommissionEditorFromDom();
  if(!String(draft.name||'').trim()){
    $('commissionEditorName')?.focus();
    toast('Capture el nombre de la comisión.');
    return false;
  }
  if(String(draft.authorizedHours||'').trim()===''){
    $('commissionEditorHours')?.focus();
    toast('Capture las horas autorizadas.');
    return false;
  }
  const numericHours=Number(draft.authorizedHours);
  if(!Number.isFinite(numericHours)||numericHours<0){
    $('commissionEditorHours')?.focus();
    toast('Capture una cantidad válida de horas autorizadas.');
    return false;
  }
  if(draft.scheduleRequired==='yes'&&!draft.reservedSlots.length){
    toast('Seleccione al menos un día y horario para el bloqueo específico.');
    return false;
  }
  const record=currentPlanningRecord(true);
  record.commissionMode='yes';
  record.commissions=(record.commissions||[]).filter(c=>!commissionIsBlank(c));
  if(Number.isInteger(planningCommissionEditorIndex) && record.commissions[planningCommissionEditorIndex]){
    record.commissions[planningCommissionEditorIndex]=JSON.parse(JSON.stringify(draft));
  }else{
    record.commissions.push(JSON.parse(JSON.stringify(draft)));
  }
  record.updatedAtMs=Date.now();
  planningByPeriod[cfg.periodo]=record;
  planningCommissionEditorIndex=null;
  planningCommissionEditorOpen=false;
  planningCommissionDraft=emptyCommission();
  persist({schedule:false});
  renderPlanningCommissions();
  updateNavState();
  toast('Comisión guardada.');
  return true;
}
window.addPlanningCommission=function(){
  if(!planningEditingAllowed()){toast('La edición está cerrada.');return false}
  if(planningCommissionEditorOpen){
    const draft=collectCommissionEditorFromDom();
    if(!commissionIsBlank(draft)){
      const discard=confirm('Hay datos sin guardar. ¿Desea descartarlos y capturar una nueva comisión?');
      if(!discard)return false;
    }
  }
  planningCommissionEditorIndex=null;
  planningCommissionEditorOpen=true;
  planningCommissionDraft=emptyCommission();
  renderPlanningCommissions();
  requestAnimationFrame(()=>{
    $('commissionEditor')?.scrollIntoView({behavior:'smooth',block:'nearest'});
    $('commissionEditorName')?.focus({preventScroll:true});
  });
  return true;
}
window.editPlanningCommission=function(index){
  if(!planningEditingAllowed()){toast('La edición está cerrada.');return false}
  const record=currentPlanningRecord(true);
  const c=record.commissions?.[index];
  if(!c)return false;
  planningCommissionEditorIndex=Number(index);
  planningCommissionEditorOpen=true;
  planningCommissionDraft=JSON.parse(JSON.stringify(c));
  renderPlanningCommissions();
  requestAnimationFrame(()=>{
    $('commissionEditor')?.scrollIntoView({behavior:'smooth',block:'nearest'});
    $('commissionEditorName')?.focus({preventScroll:true});
  });
  return true;
}
window.cancelPlanningCommissionEdit=function(){
  planningCommissionEditorIndex=null;
  planningCommissionEditorOpen=false;
  planningCommissionDraft=emptyCommission();
  renderPlanningCommissions();
}
window.removePlanningCommission=function(index){
  if(!planningEditingAllowed()){toast('La edición está cerrada.');return false}
  const record=currentPlanningRecord(true);
  const c=record.commissions?.[index];
  if(!c)return false;
  if(!confirm(`¿Eliminar la comisión “${c.name||'seleccionada'}”?`))return false;
  record.commissions.splice(index,1);
  // Mantener commissionMode='yes' preserva la elección del profesor y permite agregar otra
  // sin cambiar el radio. La validación impedirá continuar mientras no exista al menos una.
  record.updatedAtMs=Date.now();
  planningByPeriod[cfg.periodo]=record;
  planningCommissionEditorIndex=null;
  planningCommissionEditorOpen=false;
  planningCommissionDraft=emptyCommission();
  persist({schedule:false});
  renderPlanningCommissions();
  updateNavState();
  toast('Comisión eliminada. Puede agregar otra cuando lo requiera.');
  return true;
}
function clearPlanningValidation(){
  document.querySelectorAll('#commissionsBlock .planning-question-error').forEach(x=>x.classList.remove('planning-question-error'));
}
function commissionHasCapturedData(record){
  const commissions=Array.isArray(record?.commissions)?record.commissions:[];
  return record?.commissionMode==='yes' && commissions.some(c=>
    String(c?.name||'').trim() ||
    String(c?.authorizedHours??'').trim() ||
    (Array.isArray(c?.reservedSlots)&&c.reservedSlots.length)
  );
}
function validatePlanningForAdvance(opts={}){
  if(!planningEnabled())return {ok:true,errors:[],firstCard:null,record:currentPlanningRecord(true)};
  const record=opts.record||collectPlanning();
  const errors=[];
  let firstCard=null;
  const mark=(id,msg)=>{
    errors.push(msg);
    if(!firstCard)firstCard=$(id);
    if(opts.visual&&$(id))$(id).classList.add('planning-question-error');
  };
  if(opts.visual)clearPlanningValidation();


  // Comisiones son opcionales. Solo se validan como bloque obligatorio si el profesor indicó que sí tiene.
  if(record.commissionMode==='yes'){
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


  // El proyecto conserva las reglas vigentes de V80/V81.
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
  return {ok:!errors.length,errors,firstCard,record};
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
  persist({schedule:false});


  const saved=await saveTeacherChangesNow('guardado manual de Comisiones');
  if(!saved.ok){
    if($('planningErrors'))$('planningErrors').innerHTML='<div class="status-box bad"><b>No se confirmó el guardado en nube.</b><br>La información permanece conservada en este dispositivo. Inténtelo nuevamente antes de avanzar.</div>';
    return false;
  }


  if($('planningErrors'))$('planningErrors').innerHTML='<div class="status-box ok"><b>Comisiones guardadas.</b><br>La información queda disponible para consulta y para el concentrado administrativo.</div>';
  updateNavState();
  if(show)toast(saved.wrote?'Comisiones guardadas en nube.':'Sin cambios nuevos; no fue necesaria otra escritura.');
  return true;
}








function captureOrientationSessionKey(){
  return `PAD_CAPTURE_ORIENTATION_${currentUser?.uid||'guest'}_${String(cfg.periodo||'').replace(/\s+/g,'_')}`;
}
function shouldShowCaptureOrientation(){
  if(isAdmin()||(submissionLockedForCurrentPeriod()&&!individualEditOverride()))return false;
  try{return sessionStorage.getItem(captureOrientationSessionKey())!=='1'}catch(_){return true}
}
function showCaptureOrientationIfNeeded(force=false){
  if(!force&&!shouldShowCaptureOrientation())return;
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
  if(id==='revision'){buildPrint();updateReviewFinalizeUI();}
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
  return validateProfile().ok;
}
function updateReviewReadiness(metrics=null){
  const el=$('reviewReadiness');if(!el)return;
  let m=metrics;
  if(!m){
    const profile=validateProfile();
    const stats=overallStats();
    const capture=validateCapture(stats);
    const all=validateAll(profile,capture);
    const ps=programs();
    m={profile,capture,all,stats,completePrograms:ps.filter(pr=>programStats(pr).missing===0).length,totalPrograms:ps.length};
  }
  const resolvedSubjects=Math.max(0,m.stats.total-m.stats.remainingUnique-m.stats.invalid);
  el.innerHTML=`<div class="readiness-title">Verificación previa</div>
    <div class="readiness-grid">
      <span class="${m.profile.ok?'ok':'pending'}">${m.profile.ok?'✓':'○'} Datos generales</span>
      <span class="${m.completePrograms===m.totalPrograms?'ok':'pending'}">${m.completePrograms===m.totalPrograms?'✓':'○'} Programas ${m.completePrograms}/${m.totalPrograms}</span>
      <span class="${m.capture.ok?'ok':'pending'}">${m.capture.ok?'✓':'○'} Materias ${resolvedSubjects}/${m.stats.total}</span>
      <span class="${m.all.ok?'ok':'pending'}">${m.all.ok?'✓':'○'} ${m.all.ok?'Sin pendientes':'Pendientes por resolver'}</span>
    </div>`;
}
function updateNavState(){
  const pBtn=document.querySelector('.main-nav button[data-view="perfil"]');
  const cBtn=document.querySelector('.main-nav button[data-view="captura"]');
  const rBtn=document.querySelector('.main-nav button[data-view="revision"]');


  // Un solo recorrido global por actualización de etapa.
  const profile=validateProfile();
  const stats=overallStats();
  const capture=validateCapture(stats);
  const all=validateAll(profile,capture);
  const ps=programs();
  const completePrograms=ps.filter(pr=>programStats(pr).missing===0).length;


  if(pBtn)pBtn.classList.toggle('complete',profile.ok);
  if(cBtn)cBtn.classList.toggle('complete',capture.ok);
  if(rBtn){
    rBtn.classList.toggle('complete',all.ok);
    rBtn.classList.toggle('readable',reviewAvailable(all.ok)&&!all.ok);
  }


  const sequential=sequentialProfessorMode();
  const bootstrapLocked=!!currentUser&&!bootstrapComplete;
  const indicatorOnly=sequential||bootstrapLocked;
  updateReviewReadiness({profile,capture,all,stats,completePrograms,totalPrograms:ps.length});
  [pBtn,cBtn,rBtn].forEach(btn=>{
    if(!btn)return;
    btn.disabled=indicatorOnly;
    btn.classList.toggle('flow-indicator-only',indicatorOnly);
    btn.classList.toggle('locked',indicatorOnly);
    btn.setAttribute('aria-disabled',indicatorOnly?'true':'false');
    btn.title=indicatorOnly
      ?'Indicador de avance. Durante la edición use los botones inferiores.'
      :'';
  });
}


const PROFILE_ROW_CONFIG={
  formation:{base:7,max:11,prefix:'f',suffixes:['a','b']},
  docencia:{base:4,max:10,prefix:'d',suffixes:['a','c']},
  laboral:{base:5,max:10,prefix:'l',suffixes:['a','b','c']}
};
function clampProfileRowCount(value,base,max){
  return Math.max(base,Math.min(max,Number(value)||base));
}
function lastUsedProfileRow(extra,prefix,suffixes,max){
  let last=0;
  for(let i=1;i<=max;i++){
    if(suffixes.some(s=>String(extra?.[`${prefix}${i}${s}`]||'').trim()))last=i;
  }
  return last;
}
function normalizedProfileRowCounts(profile=store.profile||{}){
  const extra=profile.extra||{};
  const saved=profile.rowCounts||{};
  const out={};
  Object.entries(PROFILE_ROW_CONFIG).forEach(([kind,cfgRow])=>{
    const used=lastUsedProfileRow(extra,cfgRow.prefix,cfgRow.suffixes,cfgRow.max);
    out[kind]=clampProfileRowCount(Math.max(Number(saved[kind])||0,used,cfgRow.base),cfgRow.base,cfgRow.max);
  });
  return out;
}
function visibleProfileRowCounts(){
  const fallback=normalizedProfileRowCounts();
  return {
    formation:document.querySelectorAll('#formacion [data-profile-row-kind="formation"]').length||fallback.formation,
    docencia:document.querySelectorAll('#docencia [data-profile-row-kind="docencia"]').length||fallback.docencia,
    laboral:document.querySelectorAll('#laboral [data-profile-row-kind="laboral"]').length||fallback.laboral
  };
}
function profileRowDeleteButton(kind,index){
  const cfgRow=PROFILE_ROW_CONFIG[kind];
  if(!cfgRow||index<=cfgRow.base)return '';
  return `<button type="button" class="profile-row-delete" onclick="removeProfileRow('${kind}',${index})" aria-label="Eliminar este renglón">Eliminar</button>`;
}
function buildProfileRows(){
  const counts=normalizedProfileRowCounts();
  store.profile=store.profile||{};
  store.profile.rowCounts=counts;


  $('formacion').innerHTML=Array.from({length:counts.formation},(_,n)=>{
    const i=n+1;
    const label=i===1?'Licenciatura o TSU':`Posgrado ${i-1}`;
    const added=i>PROFILE_ROW_CONFIG.formation.base;
    return `<div class="form-row two profile-data-row ${added?'profile-added-row':''}" data-profile-row-kind="formation" data-profile-row-index="${i}">
      <div class="row-label">${label}${i===1?' *':''}</div>
      <input placeholder="${i===1?'Ej. Licenciatura en Ingeniería Industrial':'Ej. Maestría en Educación'}" data-g="f${i}a">
      <input placeholder="Ej. Universidad Tecnológica de Querétaro" data-g="f${i}b">
      ${profileRowDeleteButton('formation',i)}
    </div>`;
  }).join('');


  $('docencia').innerHTML=Array.from({length:counts.docencia},(_,n)=>{
    const i=n+1;
    const added=i>PROFILE_ROW_CONFIG.docencia.base;
    return `<div class="form-row two profile-data-row ${added?'profile-added-row':''}" data-profile-row-kind="docencia" data-profile-row-index="${i}">
      <div class="row-label">Institución ${i}${i===1?' *':''}</div>
      <input placeholder="Ej. UTEQ" data-g="d${i}a">
      <input placeholder="Ej. 2023 - 2025" data-g="d${i}c">
      ${profileRowDeleteButton('docencia',i)}
    </div>`;
  }).join('');


  $('laboral').innerHTML=Array.from({length:counts.laboral},(_,n)=>{
    const i=n+1;
    const added=i>PROFILE_ROW_CONFIG.laboral.base;
    return `<div class="form-row profile-data-row ${added?'profile-added-row':''}" data-profile-row-kind="laboral" data-profile-row-index="${i}">
      <div class="row-label">Organización ${i}${i===1?' *':''}</div>
      <input placeholder="Ej. Empresa / institución" data-g="l${i}a">
      <input placeholder="Ej. Jefe de área" data-g="l${i}b">
      <input placeholder="Ej. 2020 - 2023" data-g="l${i}c">
      ${profileRowDeleteButton('laboral',i)}
    </div>`;
  }).join('');
  updateProfileRowControls();
}
function updateProfileRowControls(){
  const counts=normalizedProfileRowCounts();
  const formBtn=$('addFormationRowBtn');
  const teachBtn=$('addTeachingRowBtn');
  const workBtn=$('addWorkRowBtn');
  if(formBtn){
    const atMax=counts.formation>=PROFILE_ROW_CONFIG.formation.max;
    formBtn.dataset.limitReached=atMax?'1':'0';
    formBtn.disabled=atMax||!editingAllowed();
    formBtn.textContent=atMax?'Máximo de 10 posgrados alcanzado':`＋ Agregar Posgrado ${counts.formation}`;
  }
  if(teachBtn){
    const atMax=counts.docencia>=PROFILE_ROW_CONFIG.docencia.max;
    teachBtn.dataset.limitReached=atMax?'1':'0';
    teachBtn.disabled=atMax||!editingAllowed();
    teachBtn.textContent=atMax?'Máximo de 10 instituciones alcanzado':`＋ Agregar experiencia docente ${counts.docencia+1}`;
  }
  if(workBtn){
    const atMax=counts.laboral>=PROFILE_ROW_CONFIG.laboral.max;
    workBtn.dataset.limitReached=atMax?'1':'0';
    workBtn.disabled=atMax||!editingAllowed();
    workBtn.textContent=atMax?'Máximo de 10 organizaciones alcanzado':`＋ Agregar experiencia laboral ${counts.laboral+1}`;
  }
}
function loadProfileValuesOnly(){
  if($('gradoAcademico'))$('gradoAcademico').value=store.profile?.gradoAcademico||'';
  const p=store.profile||{};
  ['apPat','apMat','nombres','categoria'].forEach(x=>{if($(x))$(x).value=p[x]||''});
  document.querySelectorAll('[data-g]').forEach(x=>x.value=(p.extra||{})[x.dataset.g]||'');
  updateProfileRowControls();
}
function loadProfile(){
  if(!$('categoria').options.length)CATEGORIES.forEach(c=>$('categoria').add(new Option(c,c)));
  buildProfileRows();
  loadProfileValuesOnly();
}
function profileFromInputs(){
  const extra={};
  document.querySelectorAll('[data-g]').forEach(x=>extra[x.dataset.g]=x.value.trim());
  // Conserva campos superiores heredados que no forman parte de la interfaz actual.
  // Los campos visibles y extra se reemplazan de forma controlada con lo capturado.
  return {
    ...cloneTeacherData(store.profile||{}),
    apPat:$('apPat')?.value.trim()||'',
    apMat:$('apMat')?.value.trim()||'',
    nombres:$('nombres')?.value.trim()||'',
    categoria:$('categoria')?.value||'',
    gradoAcademico:$('gradoAcademico')?.value||'',
    rowCounts:visibleProfileRowCounts(),
    extra
  };
}
function collectProfile(){
  store.profile=profileFromInputs();
  persist();
  return store.profile;
}
window.addProfileRow=function(kind){
  if(!requireEditing())return false;
  const cfgRow=PROFILE_ROW_CONFIG[kind];
  if(!cfgRow)return false;
  const profile=profileFromInputs();
  const counts=normalizedProfileRowCounts(profile);
  if(counts[kind]>=cfgRow.max){
    toast('Ya alcanzó el máximo permitido para este apartado.');
    return false;
  }
  counts[kind]++;
  profile.rowCounts=counts;
  store.profile=profile;
  buildProfileRows();
  loadProfileValuesOnly();
  persist();
  requestAnimationFrame(()=>{
    const row=document.querySelector(`[data-profile-row-kind="${kind}"][data-profile-row-index="${counts[kind]}"]`);
    row?.scrollIntoView({behavior:'smooth',block:'center'});
    row?.querySelector('input')?.focus({preventScroll:true});
  });
  return true;
};
window.removeProfileRow=function(kind,index){
  if(!requireEditing())return false;
  const cfgRow=PROFILE_ROW_CONFIG[kind];
  if(!cfgRow||index<=cfgRow.base)return false;
  const profile=profileFromInputs();
  const counts=normalizedProfileRowCounts(profile);
  if(index>counts[kind])return false;
  const keys=cfgRow.suffixes.map(s=>`${cfgRow.prefix}${index}${s}`);
  const hasData=keys.some(k=>String(profile.extra?.[k]||'').trim());
  if(hasData&&!confirm('Este renglón contiene información. ¿Desea eliminarlo?'))return false;


  for(let i=index;i<counts[kind];i++){
    cfgRow.suffixes.forEach(s=>{
      const to=`${cfgRow.prefix}${i}${s}`;
      const from=`${cfgRow.prefix}${i+1}${s}`;
      profile.extra[to]=profile.extra[from]||'';
    });
  }
  cfgRow.suffixes.forEach(s=>delete profile.extra[`${cfgRow.prefix}${counts[kind]}${s}`]);
  counts[kind]--;
  profile.rowCounts=counts;
  store.profile=profile;
  buildProfileRows();
  loadProfileValuesOnly();
  persist();
  toast('Renglón eliminado.');
  return true;
};
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
  const counts=normalizedProfileRowCounts(p);
  const checks=[
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


  for(let i=2;i<=counts.formation;i++){
    const study=String(e[`f${i}a`]||'').trim();
    const institution=String(e[`f${i}b`]||'').trim();
    const explicitlyAdded=i>PROFILE_ROW_CONFIG.formation.base;
    if(!explicitlyAdded&&!(study||institution))continue;
    checks.push(
      {el:document.querySelector(`[data-g="f${i}a"]`),missing:!study,msg:`Posgrado ${i-1}: capture el nombre del estudio o posgrado.`},
      {el:document.querySelector(`[data-g="f${i}b"]`),missing:!institution,msg:`Posgrado ${i-1}: capture la institución.`}
    );
  }


  for(let i=2;i<=counts.docencia;i++){
    const institution=String(e[`d${i}a`]||'').trim();
    const period=String(e[`d${i}c`]||'').trim();
    const explicitlyAdded=i>PROFILE_ROW_CONFIG.docencia.base;
    if(!explicitlyAdded&&!(institution||period))continue;
    checks.push(
      {el:document.querySelector(`[data-g="d${i}a"]`),missing:!institution,msg:`Experiencia docente ${i}: capture la institución.`},
      {el:document.querySelector(`[data-g="d${i}c"]`),missing:!period,msg:`Experiencia docente ${i}: capture el periodo.`}
    );
  }


  for(let i=2;i<=counts.laboral;i++){
    const a=String(e[`l${i}a`]||'').trim();
    const b=String(e[`l${i}b`]||'').trim();
    const c=String(e[`l${i}c`]||'').trim();
    const explicitlyAdded=i>PROFILE_ROW_CONFIG.laboral.base;
    if(!explicitlyAdded&&!(a||b||c))continue;
    checks.push(
      {el:document.querySelector(`[data-g="l${i}a"]`),missing:!a,msg:`Experiencia laboral ${i}: capture la organización.`},
      {el:document.querySelector(`[data-g="l${i}b"]`),missing:!b,msg:`Experiencia laboral ${i}: capture el puesto o cargo.`},
      {el:document.querySelector(`[data-g="l${i}c"]`),missing:!c,msg:`Experiencia laboral ${i}: capture el periodo.`}
    );
  }
  return checks;
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


window.saveSection=async function(){
  if(!requireEditing())return false;
  collectProfile();
  const saved=await saveTeacherChangesNow('guardado manual de Datos del profesor');
  if(!saved.ok)return false;
  toast(saved.wrote?'Datos guardados en nube.':'Sin cambios nuevos; no fue necesaria otra escritura.');
  return true;
}
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
          setTimeout(()=>{try{first.focus({preventScroll:true})}catch(_){try{first.focus()}catch(__){}}},420);
        });
      }else{
        first.scrollIntoView({behavior:'smooth',block:'center'});
        setTimeout(()=>{try{first.focus({preventScroll:true})}catch(_){first.focus()}},320);
      }
    }
    toast('Hay datos pendientes. Se marcó en rojo exactamente dónde falta información.');
    return false;
  }


  if(planningEnabled()){
    const record=collectPlanning();
    const hasCommission=commissionHasCapturedData(record);
    if(record.commissionMode!=='yes'&&!hasCommission){
      const proceed=confirm('No tiene ninguna comisión capturada. ¿Está seguro de continuar al Perfil por programa sin registrar alguna comisión?');
      if(!proceed){
        $('planningCommissionsCard')?.scrollIntoView({behavior:'smooth',block:'center'});
        return false;
      }
      if(!record.commissionMode){
        record.commissionMode='na';
        const noCommission=document.querySelector('input[name="planningCommissionMode"][value="na"]');
        if(noCommission)noCommission.checked=true;
        updatePlanningConditionalUI();
      }
    }


    const planningCheck=validatePlanningForAdvance({visual:true,record});
    if(!planningCheck.ok){
      if($('planningErrors'))$('planningErrors').innerHTML=statusBox(
        planningCheck.errors,
        'Complete únicamente la información que haya indicado como aplicable antes de continuar.'
      );
      toast('Hay información iniciada que todavía está incompleta.');
      return false;
    }


    record.completedAtMs=Date.now();
    record.updatedAtMs=Date.now();
    planningByPeriod[cfg.periodo]=record;
    if($('planningErrors'))$('planningErrors').innerHTML='';
  }


  // V90: consolidar el estado local; todavía NO se cambia de pantalla.
  store.profile=profileFromInputs();
  persist({schedule:false});


  // Guardado manual obligatorio. Si no hubo cambios reales, se omite la escritura.
  const saved=await saveTeacherChangesNow('Guardar y continuar: Datos del profesor');
  if(!saved.ok)return false;


  clearRequiredHighlights();
  document.querySelectorAll('#perfil .mobile-required-focus').forEach(el=>el.classList.remove('mobile-required-focus'));
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
    showCaptureOrientationIfNeeded(true);
  });  toast(saved.wrote?'Cambios guardados. Continúe con Programa 1.':'Sin cambios nuevos. Continúe con Programa 1.');
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
function courseRowElement(pid,s,c){
  return document.querySelector(`[data-course-key="${pid}|${s}|${c}"]`);
}
function refreshCourseRowDom(pid,s,c,name){
  const row=courseRowElement(pid,s,c);
  if(!row)return false;
  const a=getAns(pid,s,c,name);
  const off=a.status==='off';
  const pending=a.status==='pending';
  const enabled=!['off','na'].includes(a.status);
  const needsArea=enabled&&['X','XX'].includes(a.status)&&!(a.origins||[]).length;
  row.classList.toggle('off',off);
  row.classList.toggle('pending',pending);
  row.classList.toggle('reviewed',enabled&&!pending&&!needsArea);
  row.classList.toggle('needs-attention',enabled&&(pending||needsArea));
  row.classList.toggle('fast-off',off);
  const toggle=row.querySelector('.toggle input');
  if(toggle)toggle.checked=enabled;
  const toggleText=row.querySelector('.toggle span:last-child');
  if(toggleText)toggleText.textContent=enabled?'Sí':'No';
  const comp=[...row.querySelectorAll('.comp-buttons .mini')];
  if(enabled&&!comp.length)return false;
  comp.forEach(btn=>btn.classList.toggle('on',btn.textContent.trim()===a.status));
  row.querySelectorAll('.area-buttons .mini.area').forEach(btn=>{
    btn.disabled=!['X','XX'].includes(a.status);
    btn.classList.toggle('on',btn.textContent.trim()===originCode(a));
  });
  const coord=row.querySelector('.coord-row-check');
  const coordInput=coord?.querySelector('input');
  if(coordInput){
    coordInput.disabled=!rowCoordinatorEnabled(pid,s,c,name);
    coordInput.checked=rowCoordinatorChecked(pid,s,c);
  }
  if(coord)coord.classList.toggle('on',rowCoordinatorChecked(pid,s,c));
  const fav=row.querySelector('.ideal-btn');
  if(fav){
    fav.classList.toggle('on',!!a.ideal);
    fav.textContent=a.ideal?'★':'☆';
    fav.setAttribute('aria-label',a.ideal?'Quitar de favoritas':'Marcar como favorita');
  }
  return true;
}
function refreshVisibleLinkedCourseRows(pid,s,c,name){
  const seen=new Set([`${pid}|${s}|${c}`]);
  const locs=[{pid,s,c,name},...linkedCourseLocations(pid,s,c,name)];
  locs.forEach(loc=>{
    const id=`${loc.pid}|${loc.s}|${loc.c}`;
    if(seen.has(id)&&id!==`${pid}|${s}|${c}`)return;
    seen.add(id);
    refreshCourseRowDom(loc.pid,loc.s,loc.c,loc.name);
  });
  updateProgress();
  if(captureErrorModeActive)refreshCaptureErrorState();
}
window.setEnabled=function(pid,s,c,name,on){
  if(!requireEditing())return;
  if(isEnglish(name))return;
  let r=getAns(pid,s,c,name);
  if(!on){
    r.status='off';r.origins=[];r.ideal=false;
    answers[key(pid,s,c)]=r;
    setCoordinatorValue(pid,s,c,false);
    persist();
    if(!refreshCourseRowDom(pid,s,c,name))renderCurrentProgram();
    else updateProgress();
    return;
  }
  if(r.status==='off'){
    const peer=bestLinkedAnswer(pid,s,c,name);
    if(peer){
      const source=getAns(peer.pid,peer.s,peer.c,peer.name);
      r={status:source.status==='off'?'pending':source.status,origins:[...(source.origins||[])],ideal:!!source.ideal};
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
  // Una fila renderizada como apagada contiene placeholders; al reactivarla se reconstruye una sola vez.
  if(!refreshCourseRowDom(pid,s,c,name))renderCurrentProgram();
  else refreshVisibleLinkedCourseRows(pid,s,c,name);
}
window.setCompetence=function(pid,s,c,name,level){
  if(!requireEditing())return;
  const r=getAns(pid,s,c,name);if(['off','na'].includes(r.status))return;
  r.status=level;r.origins=[];answers[key(pid,s,c)]=r;
  replicateCommon(pid,s,c,r);replicateLinkedAnswer(pid,s,c,name,r);persist();
  refreshVisibleLinkedCourseRows(pid,s,c,name);
}
window.setOriginCode=function(pid,s,c,name,code){
  if(!requireEditing())return;
  const r=getAns(pid,s,c,name);if(!['X','XX'].includes(r.status))return;
  r.origins=normalizeOrigins(code);answers[key(pid,s,c)]=r;
  replicateCommon(pid,s,c,r);replicateLinkedAnswer(pid,s,c,name,r);persist();
  refreshVisibleLinkedCourseRows(pid,s,c,name);
}
window.toggleIdeal=function(pid,s,c,name){
  if(!requireEditing())return;
  const r=getAns(pid,s,c,name);
  if(!['X','XX'].includes(r.status)||(r.origins||[]).length===0){toast('Primero seleccione competencia y área de conocimiento.');return}
  r.ideal=!r.ideal;answers[key(pid,s,c)]=r;
  replicateCommon(pid,s,c,r);replicateLinkedAnswer(pid,s,c,name,r);persist();
  refreshVisibleLinkedCourseRows(pid,s,c,name);
}
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




function programStats(p){
  let total=0,resolved=0,selected=0,disabled=0,missing=0;
  p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    total++;
    if(isEnglish(name)){
      disabled++;
      resolved++;
      return;
    }
    const a=getAns(p.id,s,c,name);
    if(['off','na'].includes(a.status)){
      disabled++;
      resolved++;
      return;
    }
    if(['X','XX'].includes(a.status)&&(a.origins||[]).length){
      selected++;
      resolved++;
      return;
    }
    missing++;
  }));
  return {total,done:resolved,resolved,selected,disabled,missing,pct:total?Math.round(resolved/total*100):0};
}
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
  return{total,done,invalid,pending,pendingUnique:[...pendingLogical.values()],remainingUnique:pendingLogical.size};
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
let captureValidationEmphasis=false;




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
function clearCaptureAttention(){
  document.querySelectorAll('.attention-target').forEach(x=>x.classList.remove('attention-target'));
  document.querySelectorAll('.course.needs-attention').forEach(x=>x.classList.remove('needs-attention'));
}
function focusExactCaptureIssue(issue){
  if(!issue)return;
  const row=document.querySelector(`[data-course-loc="${issue.pi}|${issue.s}|${issue.c}"]`);
  if(!row)return;
  row.scrollIntoView({behavior:'smooth',block:'center'});
  const target=issue.type==='area'?row.querySelector('.area-buttons'):row.querySelector('.comp-buttons');
  target?.classList.add('attention-target');
  row.classList.add('needs-attention');
}
window.goToCaptureIssue=function(pi,s,c,type='competence'){
  currentProgramIndex=pi;
  workflowState.expectedProgramIndex=pi;
  workflowState.reviewUnlocked=false;
  persist({touch:false,schedule:false});
  activateViewDirect('captura');
  renderCurrentProgram();
  requestAnimationFrame(()=>focusExactCaptureIssue({pi,s,c,type}));
};
function refreshCaptureErrorState(){
  if(!captureErrorModeActive)return;
  const root=$('captureErrors');
  if(!root)return;
  const issues=captureIssues();
  const profileCheck=validateProfile();
  if(!issues.length&&profileCheck.ok){
    root.innerHTML='';
    captureErrorModeActive=false;
    captureValidationEmphasis=false;
    toast('Captura corregida. Ya puede continuar a revisión.');
    return;
  }
  if(issues.length){
    root.innerHTML=captureIssuePanel(issues);
  }else{
    root.innerHTML=statusBox(profileCheck.errors,'Complete los datos del profesor.');
  }
}
function currentProgramFavoriteCount(p){
  let total=0;
  p?.semesters?.forEach((sem,s)=>sem.forEach((name,c)=>{
    if(getAns(p.id,s,c,name).ideal)total++;
  }));
  return total;
}
function updateProgress(){
  const p=currentProgram();
  if(!p)return;
  const x=programStats(p);
  $('progressText').textContent=`${x.resolved} de ${x.total} asignaturas revisadas (${x.pct}%)`;
  $('progressBar').style.width=x.pct+'%';
  $('idealCounter').textContent=`Seleccionadas/configuradas: ${x.selected} · Deshabilitadas o No aplica: ${x.disabled} · Favoritas: ${currentProgramFavoriteCount(p)}`;
  if($('programCounter'))$('programCounter').textContent=x.missing
    ?`Pendientes en este programa: ${x.missing}`
    :'Programa completo · puede continuar';
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
  refreshVisibleLinkedCourseRows(pid,s,c,name);
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
  captureValidationEmphasis=true;
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




const PROGRAM_CAPTURE_THEMES={
  ind_procesos:{bg:'#fff0ea',border:'#efb6a5',accent:'#d05e43',strong:'#9d3f2b'},
  ind_plasticos:{bg:'#f4efff',border:'#cdbdeb',accent:'#8a67c3',strong:'#624395'},
  mec_auto:{bg:'#edf6ff',border:'#b9d7ef',accent:'#4a8fc4',strong:'#2c6794'},
  mec_ind:{bg:'#eaf7f4',border:'#afd9d1',accent:'#3b9185',strong:'#276a62'},
  mec_moldes:{bg:'#fff6df',border:'#e9cf8e',accent:'#c18a2b',strong:'#8a611d'},
  auto_diseno:{bg:'#eaf8fb',border:'#acd9e2',accent:'#3f95a5',strong:'#2b6d79'},
  mantenimiento:{bg:'#eef8e8',border:'#bfddb0',accent:'#6e9f4f',strong:'#4f7538'},
  nano:{bg:'#fff0f5',border:'#e7bdd0',accent:'#c56f90',strong:'#914e68'}
};
const PROGRAM_CAPTURE_FALLBACKS=[
  {bg:'#eef4f9',border:'#bfd2e0',accent:'#5685a5',strong:'#38617e'},
  {bg:'#f7efe7',border:'#dfc8b0',accent:'#a97a50',strong:'#7e5837'},
  {bg:'#edf6f0',border:'#bddbc7',accent:'#5f9872',strong:'#467253'},
  {bg:'#f2effa',border:'#cec3e4',accent:'#7c69aa',strong:'#5d4d84'}
];
function captureThemeForProgram(p,index=currentProgramIndex){
  return PROGRAM_CAPTURE_THEMES[p?.id]||PROGRAM_CAPTURE_FALLBACKS[Math.abs(index)%PROGRAM_CAPTURE_FALLBACKS.length];
}
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
        <span>De forma <strong>opcional</strong>, marque <strong class="help-check">✓</strong> solo si <strong>ha coordinado previamente esa asignatura</strong>. <strong>No aparece en la impresión</strong>; es una referencia para el coordinador.</span>
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
  $('programFlowName').innerHTML=`<span class="program-focus-label">Salida lateral / TSU que está capturando</span><strong class="program-exit-focus">${escapeHtml(p.exit||p.name)}</strong><span class="program-degree-context">${p.exit?`Programa educativo de referencia · ${escapeHtml(p.name)}`:escapeHtml(p.name)}</span>`;
  const st=programStats(p);
  const theme=captureThemeForProgram(p,currentProgramIndex);
  const header=document.querySelector('.program-header-flow');
  if(header){
    header.style.setProperty('--program-bg',theme.bg);
    header.style.setProperty('--program-border',theme.border);
    header.style.setProperty('--program-accent',theme.accent);
    header.style.setProperty('--program-strong',theme.strong);
  }
  const prevBtn=$('flowPrevBtn');
  if(prevBtn)prevBtn.textContent=currentProgramIndex===0?'← Volver a Datos del profesor':'← Anterior';




  const guideSteps=[
    '1. Habilita la asignatura que puedes impartir',
    '2. Selecciona tu nivel de competencia: X = media · XX = alta',
    '3. Señala el origen del conocimiento: 1 formación · 2 experiencia docente · 3 experiencia laboral · o sus combinaciones 12, 13, 23, 123',
    '4. Opcional: marca ✓ si ya has coordinado esa asignatura',
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




      h+=`<div class="course ${pending?'pending':''} ${a.status==='off'?'off':''} ${reviewed&&a.status!=='off'?'reviewed':''} ${na?'na na-clean':''} ${needsAttention?'needs-attention':''} ${captureValidationEmphasis&&needsAttention?'validation-pending':''}" data-course-loc="${loc}" data-course-key="${p.id}|${s}|${c}">
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
      <div class="program-save-actions">
        <button class="save-btn" onclick="saveAndNextProgram()">${lastProgram?'Guardar y continuar a revisión →':'Guardar y continuar →'}</button>
      </div>
    </div>
  </article>`;




  $('programs').innerHTML=h;
  const flowBtn=$('flowNextBtn');
  if(flowBtn){
    flowBtn.textContent=lastProgram?'Guardar y continuar a revisión →':'Guardar y continuar →';
    flowBtn.onclick=()=>saveAndNextProgram();
  }
  requestAnimationFrame(adjustSemesterColumnWidths);
  // En cada clic académico actualizamos solo el programa visible; las validaciones globales
  // quedan para los cambios de etapa. Esto evita recorridos repetidos de todos los programas.
  updateProgress();
  applyEditState();
  refreshCaptureErrorState();
}
window.backToProgramProfile=function(){
  currentProgramIndex=0;
  store.currentProgramIndex=0;
  if(sequentialProfessorMode()){
    workflowState.profileConfirmed=profileLooksComplete();
    workflowState.expectedProgramIndex=0;
    workflowState.reviewUnlocked=false;
  }
  persist({touch:false,schedule:false});
  renderCurrentProgram();
  activateViewDirect('captura');
  updateNavState();
  requestAnimationFrame(()=>window.scrollTo({top:Math.max(0,($('captura')?.offsetTop||0)-55),behavior:'smooth'}));
  return true;
};


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
  updateNavState();
  scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'});
}


window.saveCurrentProgramProgress=async function(show=true){
  if(!requireEditing())return false;
  persist({schedule:false});
  const saved=await saveTeacherChangesNow('guardado manual del Perfil por programa');
  if(!saved.ok)return false;
  updateProgress();
  lockRevisionNav();
  if(show)toast(saved.wrote?'Avances guardados en nube.':'Sin cambios nuevos; no fue necesaria otra escritura.');
  return true;
}


window.saveAndNextProgram=async function(){
  if(sequentialProfessorMode()){
    if(!workflowState.profileConfirmed){
      window.go('perfil',true);
      toast('Confirme primero Datos del profesor.');
      return false;
    }


    if(currentProgramIndex!==workflowState.expectedProgramIndex){
      currentProgramIndex=Math.max(0,Math.min(workflowState.expectedProgramIndex,programs().length-1));
      renderCurrentProgram();
      toast('La revisión debe continuar en el programa que corresponde al orden de captura.');
      return false;
    }
  }


  if(!canLeaveCurrentProgram())return false;


  captureValidationEmphasis=false;
  persist({schedule:false});
  const saved=await saveTeacherChangesNow(`Guardar y continuar: Programa ${currentProgramIndex+1}`);
  if(!saved.ok)return false;


  toast(saved.wrote?'Programa guardado en nube.':'Programa sin cambios nuevos; no fue necesaria otra escritura.');


  if(currentProgramIndex>=programs().length-1){
    const v=validateAll();


    if(!v.ok){
      workflowState.reviewUnlocked=false;
      showCaptureErrors(v.errors);
      toast('Todavía existen datos o materias pendientes.');
      return false;
    }


    workflowState.expectedProgramIndex=programs().length;
    workflowState.reviewUnlocked=true;
    validateAndReview(true);
    return true;
  }


  currentProgramIndex++;
  workflowState.expectedProgramIndex=currentProgramIndex;
  workflowState.reviewUnlocked=false;
  persist({touch:false,schedule:false});
  renderCurrentProgram();
  updateNavState();
  scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'});
  return true;
}


function validateCapture(stats=null){
  const x=stats||overallStats(),errs=[];
  if(x.remainingUnique){
    const names=(x.pendingUnique||[]).slice(0,4).map(item=>subjectCase(item.name));
    errs.push(`Falta${x.remainingUnique===1?'':'n'} ${x.remainingUnique} asignatura${x.remainingUnique===1?'':'s'} por revisar${names.length?`: ${names.join(', ')}${x.remainingUnique>names.length?'…':''}`:'.'}`);
  }
  if(x.invalid)errs.push(`${x.invalid} asignatura(s) tienen X/XX pero no tienen área de conocimiento.`);
  return{ok:!errs.length,errors:errs};
}
function validateAll(profileResult=null,captureResult=null){
  const p=profileResult||validateProfile();
  const c=captureResult||validateCapture();
  return{ok:p.ok&&c.ok,errors:[...p.errors,...c.errors]};
}
function reviewAvailable(completeOverride=null){
  const complete=typeof completeOverride==='boolean'?completeOverride:validateAll().ok;


  if(sequentialProfessorMode()){
    return workflowState.reviewUnlocked && complete;
  }


  return complete || cfg.editingLocked || deadlinePassed() || individualEditBlocked() || submissionLockedForCurrentPeriod();
}


function profileFormallyFinalized(){
  if(store.submittedPeriod!==cfg.periodo || !Number(store.finalizedAtMs))return false;
  const finalizedRevision=Number(store.finalizedDataRevision)||0;
  const currentRevision=Number(store.dataRevision)||0;
  if(finalizedRevision>0)return finalizedRevision===currentRevision;
  // Compatibilidad con perfiles finalizados antes de V93.
  return !individualEditOverride();
}
function profileFinalizedReadOnly(){
  return profileFormallyFinalized()&&!individualEditOverride();
}
function reviewActionMode(){
  if(profileFinalizedReadOnly())return 'finalized';
  if(!editingAllowed())return 'draft';
  return 'finalize';
}
function updateReviewFinalizeUI(){
  const mode=reviewActionMode();
  document.querySelectorAll('.final-print-btn').forEach(btn=>{
    btn.textContent=mode==='finalized'
      ?'Imprimir / guardar PDF'
      :mode==='draft'
        ?'Imprimir borrador / guardar PDF'
        :'Finalizar e imprimir / guardar PDF';
  });
  const cue=$('reviewFinalizeCue');
  if(!cue)return;
  cue.className=`review-finalize-cue no-print ${mode}`;
  cue.innerHTML=mode==='finalized'
    ?'<strong>✓ Perfil concluido</strong><span>Puede revisar el documento y volver a imprimirlo o guardarlo en PDF cuando lo necesite.</span>'
    :mode==='draft'
      ?'<strong>⚠ Perfil no concluido</strong><span>La edición está bloqueada. Cualquier impresión llevará la marca de agua <b>DOCUMENTO NO FINALIZADO</b>.</span>'
      :'<strong>➜ Último paso</strong><span>Revise cuidadosamente el contenido. Cuando todo sea correcto, pulse <b>Finalizar e imprimir / guardar PDF</b> para concluir formalmente el perfil.</span>';
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
    captureValidationEmphasis=true;
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


window.saveAll=function(show=false){if(!requireEditing())return;collectProfile();persist({schedule:false});updateProgress();lockRevisionNav();if(show)toast('Borrador conservado localmente.')}




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
    <div class="sheetTitle">
  <h2>PERFIL DEL PROFESOR</h2>
  <b>DIVISIÓN: INDUSTRIAL</b>
  ${closedAt?`<span style="display:block;text-align:center;font-size:10px;font-weight:400;margin-top:2px;">Finalización: ${closedAt}</span>`:''}
  <span style="font-size:12px;font-weight:700;">PERIODO DE VIGENCIA: ${cfg.periodo}</span>
</div>
<div class="quality-plain"><span>${cfg.codigo}</span><span>${cfg.revision}</span><span>Fecha ${cfg.fechaRevision}</span></div>
  </div>`;
}
function metaCentered(){return `<div class="meta center compactline"><span><b>Nombre:</b> ${printedProfessorName()}</span><span><b>Categoría:</b> ${store.profile?.categoria||''}</span><span><b>Competencia:</b> X = Medio · XX = Alto</span><span><b>Área de conocimiento:</b> 1 Formación · 2 Docencia · 3 Laboral</span></div>`}
function signatures(){return `<div class="sign"><div class="signature-line">${printedProfessorName()}<br>Firma del Profesor</div><div class="stamp-box">SELLO</div><div class="signature-line">${cfg.jefe}<br>Jefe de Unidad de Coordinación Académica</div></div>`}
function preambleSheet(){
  const p=store.profile||{},e=p.extra||{},counts=normalizedProfileRowCounts(p);
  const formation=Array.from({length:counts.formation},(_,n)=>n+1);
  const teaching=Array.from({length:counts.docencia},(_,n)=>n+1);
  const work=Array.from({length:counts.laboral},(_,n)=>n+1);
  const expanded=(formation.length+teaching.length+work.length)>18?' expanded-profile':'';
  return `<div class="sheet profile-first-sheet${expanded}">${printHeader()}<div class="meta center compactline first-profile-meta"><span class="first-meta-item"><b class="first-meta-label">Nombre:</b><strong class="first-meta-value">${printedProfessorName()}</strong></span><span class="first-meta-item"><b class="first-meta-label">Categoría:</b><strong class="first-meta-value">${store.profile?.categoria||''}</strong></span></div><table class="profileTable"><tr><th colspan="4">1. FORMACIÓN PROFESIONAL</th></tr>${formation.map(i=>`<tr><td><b>${i===1?'Licenciatura o TSU':`Posgrado ${i-1}`}</b></td><td>${e[`f${i}a`]||''}</td><td><b>Institución</b></td><td>${e[`f${i}b`]||''}</td></tr>`).join('')}<tr><th colspan="4">2. EXPERIENCIA DOCENTE</th></tr>${teaching.map(i=>`<tr><td><b>Institución ${i}</b></td><td colspan="2">${e[`d${i}a`]||''}</td><td><b>Periodo:</b> ${e[`d${i}c`]||''}</td></tr>`).join('')}<tr><th colspan="4">3. EXPERIENCIA LABORAL</th></tr>${work.map(i=>`<tr><td><b>Organización ${i}</b></td><td>${e[`l${i}a`]||''}</td><td><b>Cargo:</b> ${e[`l${i}b`]||''}</td><td><b>Periodo:</b> ${e[`l${i}c`]||''}</td></tr>`).join('')}</table>${signatures()}</div>`;
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
 $('printArea').innerHTML=html;

const sheets=[...document.querySelectorAll('#printArea .sheet')];
const totalPages=sheets.length;

sheets.forEach((sheet,index)=>{
  sheet.style.position='relative';

  sheet.querySelector('.page-number')?.remove();

  const pageNumber=document.createElement('div');
  pageNumber.className='page-number';
  pageNumber.textContent=`${index+1} de ${totalPages}`;
  pageNumber.style.cssText=
    'position:absolute;left:0;right:0;bottom:3mm;text-align:center;font-size:9px;font-weight:400;color:#444;';

  sheet.appendChild(pageNumber);
});

const draft=!profileFormallyFinalized();
sheets.forEach(sheet=>{
    sheet.classList.toggle('draft-document',draft);
    sheet.querySelector('.draft-watermark')?.remove();
    if(draft){
      const mark=document.createElement('div');
      mark.className='draft-watermark';
      mark.innerHTML='<strong>DOCUMENTO NO FINALIZADO</strong><span>BORRADOR</span>';
      sheet.prepend(mark);
    }
  });
  updateReviewFinalizeUI();
}
async function finalizeCurrentProfile(){
  collectProfile();


  const finalCheck=validateAll();
  if(!finalCheck.ok)throw new Error('No se puede finalizar un perfil con información pendiente.');
  if(sequentialProfessorMode()&&!workflowState.reviewUnlocked){
    throw new Error('No se puede finalizar sin concluir el recorrido secuencial.');
  }


  // V93: guardar + finalizar ocurre en UNA sola escritura del documento del profesor.
  persist({schedule:false});
  const previousFinalState={
    submittedPeriod:store.submittedPeriod||null,
    finalizedAtMs:Number(store.finalizedAtMs)||null,
    finalizedDataRevision:Number(store.finalizedDataRevision)||0,
    individualEditEnabled:!!store.individualEditEnabled,
    individualEditDisabled:!!store.individualEditDisabled
  };


  const releaseEditOverride=individualEditOverride();
  store.submittedPeriod=cfg.periodo;
  store.finalizedAtMs=Date.now();
  store.finalizedDataRevision=Number(store.dataRevision)||0;
  store.individualEditEnabled=false;
  store.individualEditDisabled=false;
  persist({touch:false,schedule:false});


  lastCloudErrorCode='';
  const finalSyncOk=await forceProfileCheckpointToCloud(
    'finalización formal del perfil',
    {force:true,releaseEditOverride}
  );


  if(!finalSyncOk){
    store.submittedPeriod=previousFinalState.submittedPeriod;
    store.finalizedAtMs=previousFinalState.finalizedAtMs;
    store.finalizedDataRevision=previousFinalState.finalizedDataRevision;
    store.individualEditEnabled=previousFinalState.individualEditEnabled;
    store.individualEditDisabled=previousFinalState.individualEditDisabled;
    store.finalizationCloudConfirmed=false;
    store.syncPending=true;
    persist({touch:false,schedule:false});
    updateCloudStatus(
      lastCloudErrorCode==='resource-exhausted'
        ?'Cuota de Firestore agotada · el perfil NO fue finalizado'
        :'No se confirmó la finalización en nube · vuelva a intentarlo',
      'warn'
    );
    applyEditState();updateNavState();
    return {preSyncOk:false,finalSyncOk:false,finalized:false};
  }


  store.finalizationCloudConfirmed=true;
  store.syncPending=false;
  persistStoreSnapshot();
  updateCloudStatus('Perfil finalizado y sincronizado','ok');


  // Sólo se conserva auditoría para el evento formal.
  Promise.resolve(writeAudit('Perfil finalizado y sincronizado para impresión/guardado PDF'))
    .catch(e=>console.warn('Auditoría de finalización no disponible',e));


  applyEditState();updateNavState();
  return {preSyncOk:true,finalSyncOk:true,finalized:true};
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
  const libsReady=await ensurePdfLibraries();
  if(!libsReady||!window.html2canvas||!window.jspdf?.jsPDF)return false;
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
  if(!editingAllowed()){
    buildPrint();
    toast('Documento en modo consulta. La impresión llevará marca de agua porque el perfil no está finalizado.');
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
  if(!result.finalized){
    toast('No se confirmó la finalización en nube. El perfil permanece editable y sus datos están conservados localmente.');
    return;
  }
  buildPrint();
  updateReviewFinalizeUI();
  toast('Perfil concluido. La edición quedó bloqueada. Para cualquier modificación posterior, consulte a su JUCA.');
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




  cfg.planningEnabled=true;




  // El cambio de periodo nunca borra profile, answers, programMeta ni planeaciones de periodos anteriores.
  updatePeriodBadges();cacheGlobalSettings();persist();updatePlanningAvailability();renderPlanning();
  saveGlobalSettings(previousPeriod===cfg.periodo?'Configuración institucional actualizada':`Periodo actualizado de ${previousPeriod} a ${cfg.periodo} sin borrar perfiles`);
  toast(previousPeriod===cfg.periodo?'Configuración guardada.':'Periodo actualizado. El apartado de Comisiones permanece habilitado.');
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
    previousTeacherAdminCache={...teacherAdminCache};
    teacherAdminCache={};
    snap.forEach(ds=>{
      const d=ds.data()||{};
      if(!cloudHasTeacherData(d)&&!d.email&&!d.displayName)return;
      const p=d.profile||{};
      const cached=previousTeacherAdminCache[ds.id]||{};
      const name=[p.apPat,p.apMat,p.nombres].filter(Boolean).join(' ')||cached.name||d.displayName||d.email||'(Sin nombre)';
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
        deletedByAdmin:d.deletedByAdmin===true,
        deletedAt:d.deletedAt||null,
        deletedBy:d.deletedBy||'',
        updatedAt:d.updatedAt,
        profileResetToken:d.profileResetToken||null,
        captureProgress
      };
      rows.push(row);teacherAdminCache[row.uid]=row;
    });
    teacherAdminCacheLoaded=true;
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
      const retired=!!r.deletedByAdmin;
      const override=!!r.individualEditEnabled;
      const individuallyDisabled=!!r.individualEditDisabled;
      const statusTitle=retired
        ?'Perfil resguardado'
        :individuallyDisabled
          ?'Edición individual deshabilitada'
          :override
            ?'Edición individual habilitada'
            :(doneNow?'Concluido':'En captura / sin concluir');
      const lastCompletion=doneNow?formatTeacherCompletion(r):'';
      const lastEdit=formatTeacherUpdatedAt(r.updatedAt);
      const statusText=retired
        ?`Última edición: ${lastEdit} · Resguardado por Administración · datos conservados`
        :individuallyDisabled
          ?`Última edición: ${lastEdit} · Edición deshabilitada por Administración`
          :override
            ?(doneNow
              ?`Última edición: ${lastEdit} · Última finalización: ${lastCompletion} · Edición individual habilitada`
              :`Última edición: ${lastEdit} · Edición individual habilitada`)
            :(doneNow
              ?`Última edición: ${lastEdit} · Finalizó y envió: ${lastCompletion}`
              :`Última edición: ${lastEdit}`);
      return `<div class="teacher-admin-row ${retired?'individual-disabled':individuallyDisabled?'individual-disabled':override?'individual-open':doneNow?'finished':'open'}" data-teacher-uid="${escapeHtml(r.uid)}">
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
        <div class="teacher-admin-status ${retired?'individual-disabled':individuallyDisabled?'individual-disabled':override?'individual-open':doneNow?'finished':'open'}">
          <strong>${escapeHtml(statusTitle)}</strong>
          <span>${escapeHtml(statusText)}</span>
        </div>
        <div class="teacher-admin-actions">
          ${retired
            ? `<button class="teacher-reopen-btn" onclick="restoreTeacherProfile('${r.uid}')">Restaurar perfil</button>`
            : (()=>{
                const enableNext=individuallyDisabled || (doneNow && !override);
                const label=enableNext?'Habilitar edición':'Deshabilitar edición';
                return `<button class="teacher-reopen-btn ${enableNext?'':'active'}" onclick="setTeacherEditAccess('${r.uid}',${enableNext?'true':'false'})">${label}</button>`;
              })()}
          <button class="teacher-print-profile-btn" onclick="printTeacherProfile('${r.uid}')">Imprimir perfil</button>
          ${retired?'':`<button class="teacher-reset-program-btn" onclick="resetTeacherProgramProfile('${r.uid}')">🔒 Eliminar asignaturas capturadas</button>
          <button class="teacher-delete-btn" onclick="deleteTeacherProfile('${r.uid}')">🔒 Resguardar perfil</button>`}
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
    const previousSubmittedPeriod=store.submittedPeriod;
    const previousFinalizedDataRevision=store.finalizedDataRevision;
    const previousDataRevision=store.dataRevision;
    const previousIndividualEditEnabled=store.individualEditEnabled;
    const previousIndividualEditDisabled=store.individualEditDisabled;




    try{
      store.profile=JSON.parse(JSON.stringify(d.profile||{}));
      answers=JSON.parse(JSON.stringify(d.answers||{}));
      programMeta=JSON.parse(JSON.stringify(d.programMeta||{}));
      store.finalizedAtMs=Number(d.finalizedAtMs)||null;
      store.submittedPeriod=d.submittedPeriod||null;
      // V96: la impresión administrativa debe evaluar el estado de finalización
      // del profesor seleccionado, no las revisiones del perfil del administrador.
      store.finalizedDataRevision=Number(d.finalizedDataRevision)||0;
      store.dataRevision=Number(d.dataRevision)||0;
      store.individualEditEnabled=!!d.individualEditEnabled;
      store.individualEditDisabled=!!d.individualEditDisabled;




      buildPrint(false);
      await openProfilePrintDialog();
    }finally{
      store.profile=previousProfile;
      answers=previousAnswers;
      programMeta=previousProgramMeta;
      store.finalizedAtMs=previousFinalizedAtMs;
      store.submittedPeriod=previousSubmittedPeriod;
      store.finalizedDataRevision=previousFinalizedDataRevision;
      store.dataRevision=previousDataRevision;
      store.individualEditEnabled=previousIndividualEditEnabled;
      store.individualEditDisabled=previousIndividualEditDisabled;
    }
  }catch(e){
    console.error('No fue posible imprimir el perfil del profesor',e);
    alert('No fue posible preparar el perfil para impresión. Revise la conexión con Firestore.');
  }
}




function updateTeacherAdminRowVisual(uid){
  const r=teacherAdminCache[uid];
  if(!r)return;
  const row=document.querySelector(`[data-teacher-uid="${CSS.escape(uid)}"]`);
  if(!row)return;
  const doneNow=r.submittedPeriod===cfg.periodo;
  const retired=!!r.deletedByAdmin;
  const override=!!r.individualEditEnabled;
  const individuallyDisabled=!!r.individualEditDisabled;
  row.classList.remove('individual-disabled','individual-open','finished','open');
  row.classList.add(retired?'individual-disabled':individuallyDisabled?'individual-disabled':override?'individual-open':doneNow?'finished':'open');


  const status=row.querySelector('.teacher-admin-status');
  if(status){
    status.className=`teacher-admin-status ${retired?'individual-disabled':individuallyDisabled?'individual-disabled':override?'individual-open':doneNow?'finished':'open'}`;
    const strong=status.querySelector('strong');
    const span=status.querySelector('span');
    if(strong)strong.textContent=retired?'Perfil resguardado':individuallyDisabled?'Edición individual deshabilitada':override?'Edición individual habilitada':doneNow?'Concluido':'En captura / sin concluir';
    if(span){
      const lastEdit=formatTeacherUpdatedAt(r.updatedAt);
      span.textContent=retired
        ?`Última edición: ${lastEdit} · Resguardado por Administración · datos conservados`
        :individuallyDisabled
          ?`Última edición: ${lastEdit} · Edición deshabilitada por Administración`
          :override
            ?`Última edición: ${lastEdit} · Edición individual habilitada`
            :doneNow?`Última edición: ${lastEdit} · Perfil concluido`:`Última edición: ${lastEdit}`;
    }
  }


  const btn=row.querySelector('.teacher-reopen-btn');
  if(btn){
    if(retired){
      btn.textContent='Restaurar perfil';
      btn.classList.remove('active');
      btn.disabled=false;
      btn.classList.remove('is-busy');
      btn.onclick=()=>window.restoreTeacherProfile(uid);
    }else{
      const enableNext=individuallyDisabled || (doneNow && !override);
      btn.textContent=enableNext?'Habilitar edición':'Deshabilitar edición';
      btn.classList.toggle('active',!enableNext);
      btn.disabled=false;
      btn.classList.remove('is-busy');
      btn.onclick=()=>window.setTeacherEditAccess(uid,enableNext);
    }
  }
}



function updateTeacherAdminProgressVisual(uid){
  const r=teacherAdminCache[uid];
  if(!r)return;
  const row=document.querySelector(`[data-teacher-uid="${CSS.escape(uid)}"]`);
  const root=row?.querySelector('.teacher-admin-progress');
  if(!root)return;
  const p=r.captureProgress||teacherCaptureProgress({});
  root.title=`${p.completedSubjects} de ${p.totalSubjects} asignaturas revisadas`;
  root.innerHTML=`<div class="teacher-progress-top">
    <strong>${p.pct}%</strong>
    <span>${p.completedSubjects}/${p.totalSubjects} asignaturas</span>
  </div>
  <div class="teacher-progress-track"><i style="width:${p.pct}%"></i></div>
  <small>${p.completedPrograms}/${p.totalPrograms} programas completos</small>`;
}

window.setTeacherEditAccess=async function(uid,enable){
  if(!isAdmin()||!dbLite)return;
  const r=teacherAdminCache[uid]||{};
  const who=r.name||r.email||'este profesor';
  const question=enable
    ?`¿Habilitar la edición para ${who}?\n\nNo se modificará ni eliminará ningún dato académico.`
    :`¿Deshabilitar la edición para ${who}?\n\nNo se modificará ni eliminará ningún dato académico. El profesor conservará su perfil para consulta e impresión.`;
  if(!confirm(question))return;
  if(navigator.onLine===false){
    alert('No hay conexión a Internet. El permiso no se modificó.');
    return;
  }


  const row=document.querySelector(`[data-teacher-uid="${CSS.escape(uid)}"]`);
  const btn=row?.querySelector('.teacher-reopen-btn');
  if(btn){
    btn.disabled=true;
    btn.classList.add('is-busy');
    btn.textContent=enable?'Habilitando…':'Deshabilitando…';
  }


  try{
    await liteSetDoc(liteDoc(dbLite,'profiles',uid),{
      individualEditEnabled:!!enable,
      individualEditDisabled:!enable,
      reopenedAt:enable?liteServerTimestamp():null,
      reopenedBy:enable?(currentUser.email||''):null,
      individualEditUpdatedAt:liteServerTimestamp()
    },{merge:true});


    r.individualEditEnabled=!!enable;
    r.individualEditDisabled=!enable;
    r.updatedAt=new Date();
    teacherAdminCache[uid]=r;
    updateTeacherAdminRowVisual(uid);
    toast(enable?'Edición habilitada. El profesor debe recargar la página si ya la tenía abierta.':'Edición deshabilitada. El profesor debe recargar la página si ya la tenía abierta.');
  }catch(e){
    console.error('Error de edición individual',e);
    showCloudWriteFailure(e,enable?'habilitar la edición individual':'deshabilitar la edición individual');
  }finally{
    if(btn){
      btn.disabled=false;
      btn.classList.remove('is-busy');
    }
    updateTeacherAdminRowVisual(uid);
  }
}
window.restoreTeacherProfile=async function(uid){
  if(!isAdmin()||!dbLite)return false;
  const r=teacherAdminCache[uid]||{};
  const who=r.name||r.email||'este profesor';
  const ok=confirm(
    `¿Restaurar el perfil de ${who}?\n\n`+
    `Toda la información académica resguardada se conservará.\n\n`+
    `Esta operación únicamente retirará el estado administrativo de resguardo y volverá a habilitar el perfil.\n\n`+
    `No se borrará ni sustituirá información.`
  );
  if(!ok)return false;
  if(navigator.onLine===false){
    alert('No hay conexión a Internet. El perfil no se modificó.');
    return false;
  }
  try{
    // V95: restauración atómica. Estado + auditoría se confirman juntos.
    const profileRef=liteDoc(dbLite,'profiles',uid);
    const auditRef=liteDoc(liteCollection(dbLite,'audit'));
    const batch=liteWriteBatch(dbLite);
    batch.update(profileRef,{
      deletedByAdmin:false,
      individualEditDisabled:false,
      individualEditEnabled:true,
      reopenedAt:liteServerTimestamp(),
      reopenedBy:currentUser?.email||'',
      individualEditUpdatedAt:liteServerTimestamp(),
      updatedAt:liteServerTimestamp()
    });
    batch.set(auditRef,{
      action:`Perfil restaurado por Administración: ${r.email||uid}`,
      email:currentUser?.email||'',
      uid:currentUser?.uid||'',
      targetUid:uid,
      at:liteServerTimestamp(),
      period:cfg.periodo
    });
    await batch.commit();

    r.deletedByAdmin=false;
    r.individualEditDisabled=false;
    r.individualEditEnabled=true;
    r.updatedAt=new Date();
    teacherAdminCache[uid]=r;
    toast('Perfil restaurado. Todos los datos anteriores permanecen conservados.');
    const row=document.querySelector(`[data-teacher-uid="${CSS.escape(uid)}"]`);
    if(row){
      const actions=row.querySelector('.teacher-admin-actions');
      if(actions){
        const doneNow=r.submittedPeriod===cfg.periodo;
        const enableNext=!!r.individualEditDisabled || (doneNow && !r.individualEditEnabled);
        actions.innerHTML=`<button class="teacher-reopen-btn ${enableNext?'':'active'}" onclick="setTeacherEditAccess('${r.uid}',${enableNext?'true':'false'})">${enableNext?'Habilitar edición':'Deshabilitar edición'}</button>`+
          `<button class="teacher-print-profile-btn" onclick="printTeacherProfile('${r.uid}')">Imprimir perfil</button>`+
          `<button class="teacher-reset-program-btn" onclick="resetTeacherProgramProfile('${r.uid}')">🔒 Eliminar asignaturas capturadas</button>`+
          `<button class="teacher-delete-btn" onclick="deleteTeacherProfile('${r.uid}')">🔒 Resguardar perfil</button>`;
      }
      updateTeacherAdminRowVisual(uid);
    }
    return true;
  }catch(e){
    console.error('No fue posible restaurar el perfil',e);
    alert('No fue posible restaurar el perfil. La operación completa se canceló y no se eliminó ni sustituyó información académica.');
    return false;
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
  if(!isAdmin()||!db||!dbLite)return;
  const r=teacherAdminCache[uid]||{};
  const who=r.name||r.email||'este profesor';

  const ok=confirmAdministrativeDeletion(
    `¿CONFIRMAR eliminación de las asignaturas capturadas de ${who}?\n\n`+
    `Se borrarán respuestas por asignatura, niveles X/XX, áreas de conocimiento, coordinaciones, favoritas y el estado de finalización.\n\n`+
    `Se conservarán los datos del profesor, pero la edición quedará habilitada para corregirlos y comenzar desde cero el Perfil por programa.\n\n`+
    `Antes del cambio se guardará una copia íntegra en profileArchives. Esta acción no se puede deshacer desde esta pantalla.`,
    'la eliminación de las asignaturas capturadas'
  );
  if(!ok)return;
  if(navigator.onLine===false){
    alert('No hay conexión a Internet. No se realizó ningún cambio.');
    return;
  }

  try{
    // V95: una sola lectura y un commit atómico: respaldo + reinicio + auditoría.
    const profileRef=liteDoc(dbLite,'profiles',uid);
    const snap=await getDoc(doc(db,'profiles',uid));
    if(!snap.exists())throw new Error('El perfil seleccionado no existe.');
    const data=snap.data()||{};
    if(data.deletedByAdmin===true){
      alert('El perfil está resguardado. Restáurelo antes de reiniciar sus asignaturas.');
      return;
    }

    const now=Date.now();
    const resetToken=`${now}-${uid}`;
    const archiveRef=liteDoc(dbLite,'profileArchives',uid,'snapshots',String(now));
    const auditRef=liteDoc(liteCollection(dbLite,'audit'));
    const batch=liteWriteBatch(dbLite);

    batch.set(archiveRef,{
      ...data,
      archivedUid:uid,
      archiveReason:'Antes de reiniciar asignaturas capturadas',
      archivedAt:liteServerTimestamp(),
      archivedAtMs:now,
      archivedBy:currentUser?.email||''
    });
    batch.update(profileRef,{
      answers:{},
      programMeta:{},
      submittedPeriod:null,
      finalizedAtMs:null,
      finalizedDataRevision:0,
      individualEditEnabled:true,
      individualEditDisabled:false,
      profileResetToken:resetToken,
      programProfileResetAt:liteServerTimestamp(),
      programProfileResetBy:currentUser?.email||'',
      updatedAt:liteServerTimestamp()
    });
    batch.set(auditRef,{
      action:`Asignaturas capturadas eliminadas por Administración: ${r.email||uid}`,
      email:currentUser?.email||'',
      uid:currentUser?.uid||'',
      targetUid:uid,
      at:liteServerTimestamp(),
      period:cfg.periodo
    });
    await batch.commit();

    // Actualización local de una sola fila; no vuelve a leer toda /profiles.
    r.submittedPeriod=null;
    r.finalizedAtMs=0;
    r.individualEditEnabled=true;
    r.individualEditDisabled=false;
    r.profileResetToken=resetToken;
    r.updatedAt=new Date();
    r.captureProgress=teacherCaptureProgress({});
    teacherAdminCache[uid]=r;
    updateTeacherAdminRowVisual(uid);
    updateTeacherAdminProgressVisual(uid);
    toast('Asignaturas eliminadas y respaldo confirmado. El profesor iniciará nuevamente el Perfil por programa.');
  }catch(e){
    console.error(e);
    alert('No fue posible eliminar las asignaturas capturadas. La operación completa se canceló; verifique la conexión y las reglas de Firestore.');
  }
}
window.deleteTeacherProfile=async function(uid){
  if(!isAdmin()||!db||!dbLite)return;
  const r=teacherAdminCache[uid]||{};
  const who=r.name||r.email||'este profesor';


  const first=confirm(
    `¿RESGUARDAR el perfil de ${who}?\n\n`+
    `La información académica NO se borrará ni se vaciará. Se conservará íntegramente y el perfil quedará en solo lectura hasta que Administración lo restaure.\n\n`+
    `Antes del cambio se guardará una copia íntegra en profileArchives.`
  );
  if(!first)return;
  const typed=prompt(
    `SEGUNDO CANDADO DE SEGURIDAD\n\nPara confirmar el resguardo, escriba exactamente:\n\nRESGUARDAR`
  );
  if(String(typed||'').trim().toUpperCase()!=='RESGUARDAR'){
    if(typed!==null)toast('Resguardo cancelado: no se escribió RESGUARDAR.');
    return;
  }
  if(navigator.onLine===false){
    alert('No hay conexión a Internet. El perfil no se modificó.');
    return;
  }


  try{
    // Una sola lectura puntual del perfil afectado.
    const profileRef=liteDoc(dbLite,'profiles',uid);
    const snap=await getDoc(doc(db,'profiles',uid));
    if(!snap.exists())throw new Error('El perfil seleccionado no existe.');
    const data=snap.data()||{};
    if(data.deletedByAdmin===true){
      toast('El perfil ya se encuentra resguardado.');
      return;
    }


    const now=Date.now();
    const archiveId=String(now);
    const archiveRef=liteDoc(dbLite,'profileArchives',uid,'snapshots',archiveId);
    const auditRef=liteDoc(liteCollection(dbLite,'audit'));
    const deletionToken=`SAFE-${now}-${uid}`;
    const batch=liteWriteBatch(dbLite);


    batch.set(archiveRef,{
      ...data,
      archivedUid:uid,
      archiveReason:'Antes de resguardar perfil',
      archivedAt:liteServerTimestamp(),
      archivedAtMs:now,
      archivedBy:currentUser?.email||''
    });
    batch.update(profileRef,{
      deletedByAdmin:true,
      profileDeletionToken:deletionToken,
      deletedAt:liteServerTimestamp(),
      deletedBy:currentUser?.email||'',
      individualEditEnabled:false,
      individualEditDisabled:true,
      updatedAt:liteServerTimestamp()
    });
    batch.set(auditRef,{
      action:`Perfil resguardado sin borrar datos: ${r.email||uid}`,
      email:currentUser?.email||'',
      uid:currentUser?.uid||'',
      targetUid:uid,
      at:liteServerTimestamp(),
      period:cfg.periodo
    });
    await batch.commit();


    // Actualización visual local: no vuelve a leer toda la colección de perfiles.
    r.deletedByAdmin=true;
    r.individualEditEnabled=false;
    r.individualEditDisabled=true;
    r.updatedAt=new Date();
    teacherAdminCache[uid]=r;
    const row=document.querySelector(`[data-teacher-uid="${CSS.escape(uid)}"]`);
    if(row){
      const actions=row.querySelector('.teacher-admin-actions');
      if(actions){
        actions.innerHTML=`<button class="teacher-reopen-btn" onclick="restoreTeacherProfile('${r.uid}')">Restaurar perfil</button>`+
          `<button class="teacher-print-profile-btn" onclick="printTeacherProfile('${r.uid}')">Imprimir perfil</button>`;
      }
      updateTeacherAdminRowVisual(uid);
    }
    toast('Perfil resguardado. Todos los datos permanecen conservados y existe una copia administrativa.');
  }catch(e){
    console.error(e);
    alert('No fue posible resguardar el perfil. La operación se canceló y no se vació información académica.');
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
  renderProgramAdminList();renderCustomPrograms();renderRules();renderTransversalAdmin();renderAcademicRelationsTree();applyEditState();if(!teacherAdminCacheLoaded)renderTeacherAdminList()
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
  const ready=await ensureExcelLibrary();
  const XLSX=window.XLSX;
  if(!ready||!XLSX||!XLSX.utils){
    throw new Error('No fue posible cargar el módulo de Excel. Revise la conexión e intente nuevamente.');
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








function updateProfileStepIndicator(){
  const pBtn=document.querySelector('.main-nav button[data-view="perfil"]');
  if(pBtn)pBtn.classList.toggle('complete',profileLooksComplete());
}
function setupAutoSave(){
  let timer=null;
  const isProfileField=target=>target.matches('#perfil input,#perfil select,#perfil textarea')&&!target.closest('#commissionsBlock');
  document.addEventListener('input',e=>{
    if(!editingAllowed()||!isProfileField(e.target))return;
    e.target.classList.remove('required-field-error');
    const wrap=e.target.closest('label,.form-row');if(wrap)wrap.classList.remove('required-wrap-error');
    clearTimeout(timer);
    timer=setTimeout(()=>{
      store.profile=profileFromInputs();
      persist({schedule:false});
      updateProfileStepIndicator();
    },550);
  });
  document.addEventListener('change',e=>{
    if(!editingAllowed()||!isProfileField(e.target))return;
    clearTimeout(timer);
    store.profile=profileFromInputs();
    persist({schedule:false});
    updateProfileStepIndicator();
  });
}


function setupPlanningAutoSave(){
  let timer=null;
  const isPlanningField=target=>target.matches('#commissionsBlock input,#commissionsBlock textarea');
  const saveLocalDraft=()=>{
    try{
      if($('commissionEditor'))collectCommissionEditorFromDom();
      collectPlanning();
      persist({schedule:false});
    }catch(e){
      console.warn('No fue posible conservar el borrador local de Comisiones',e);
    }
  };
  document.addEventListener('input',e=>{
    if(!planningEditingAllowed()||!isPlanningField(e.target))return;
    if(e.target.closest('#commissionEditor')){
      try{collectCommissionEditorFromDom()}catch(_){}
    }
    clearTimeout(timer);
    timer=setTimeout(saveLocalDraft,1200);
  });
  document.addEventListener('change',e=>{
    if(!planningEditingAllowed()||!isPlanningField(e.target))return;
    if(e.target.closest('#commissionEditor')){
      try{collectCommissionEditorFromDom()}catch(_){}
    }
    clearTimeout(timer);
    timer=setTimeout(saveLocalDraft,700);
  });
}
function setupResilienceGuards(){
  window.addEventListener('online',()=>{
    if(store.syncPending){
      updateCloudStatus('Conexión recuperada · cambios pendientes de guardado manual','warn');
    }
  });


  window.addEventListener('offline',()=>{
    if(currentUser)updateCloudStatus('Sin conexión · guardado local activo','warn');
  });


  window.addEventListener('beforeprint',()=>{
    if($('revision')?.classList.contains('active'))buildPrint(false);
  });


  window.addEventListener('pagehide',()=>{
    try{
      if(currentUser)captureProfileLocallyWithoutCloud();
    }catch(_){}
  });


  window.addEventListener('beforeunload',e=>{
    try{
      if(currentUser)captureProfileLocallyWithoutCloud();
      if(currentUser&&teacherHasUnsavedCloudChanges()){
        e.preventDefault();
        e.returnValue='';
      }
    }catch(_){}
  });
}


function mobileClientBlocked(){
  const ua=navigator.userAgent||'';
  const uaMobile=!!navigator.userAgentData?.mobile;
  const classic=/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Windows Phone/i.test(ua);
  const ipadOs=navigator.platform==='MacIntel' && Number(navigator.maxTouchPoints||0)>1;
  const coarseSmall=window.matchMedia?.('(pointer: coarse) and (max-width: 1100px)')?.matches===true;
  return uaMobile || classic || ipadOs || coarseSmall;
}
function showDesktopOnlyGate(){
  document.body.classList.add('desktop-only-active');
  const gate=$('desktopOnlyGate');
  if(gate)gate.classList.remove('hidden');
}
function init(){
  if(mobileClientBlocked()){showDesktopOnlyGate();return;}
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
