
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';

const $=id=>document.getElementById(id);
const store=JSON.parse(localStorage.getItem('PAD_UTEQ')||'{}');
const cfg=Object.assign({jefe:'Iván Gutiérrez Bautista',codigo:'EA-F-86',revision:'Rev.01',fechaRevision:'21-sep-2018',periodo:'SEP 2026 - AGO 2027'},store.cfg||{});
let answers=store.answers||{},programMeta=store.programMeta||{},customPrograms=store.customPrograms||[];
let currentProgramIndex=Number.isInteger(store.currentProgramIndex)?store.currentProgramIndex:0;
let newSemesterCount=5,auth=null,currentUser=null,authReady=false;
const allowedDomain=(window.PAD_ALLOWED_DOMAIN||'uteq.edu.mx').toLowerCase();
const adminEmail=(window.PAD_ADMIN_EMAIL||'ivan.gutierrez@uteq.edu.mx').toLowerCase();

function programs(){return [...PROGRAMS,...customPrograms]}
function key(pid,s,c){return `${pid}|${s}|${c}`}
function fullName(){return [$('apPat').value.trim(),$('apMat').value.trim(),$('nombres').value.trim()].filter(Boolean).join(' ')}
function isEnglish(name){return /^INGLÉS\b/i.test(name.trim())}
function getAns(pid,s,c,name){
  const k=key(pid,s,c);
  if(isEnglish(name)){answers[k]={status:'na',origins:[],ideal:false};return answers[k]}
  if(!answers[k])answers[k]={status:'pending',origins:[],ideal:false};
  return answers[k]
}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2400)}
function persist(){cfg.periodo=cfg.periodo||'SEP 2026 - AGO 2027';store.cfg=cfg;store.answers=answers;store.programMeta=programMeta;store.customPrograms=customPrograms;store.currentProgramIndex=currentProgramIndex;localStorage.setItem('PAD_UTEQ',JSON.stringify(store))}
function statusBox(errors,title){return `<div class="status-box bad"><b>${title}</b><ul>${errors.map(x=>`<li>${x}</li>`).join('')}</ul></div>`}
function updatePeriodBadges(){ $('periodBadgeGate').textContent=`Periodo de vigencia · ${cfg.periodo}`; $('periodBadgeInline').textContent=`Periodo de vigencia · ${cfg.periodo}`; }
function authConfigured(){return !!(window.FIREBASE_CONFIG&&window.FIREBASE_CONFIG.apiKey&&window.FIREBASE_CONFIG.authDomain&&window.FIREBASE_CONFIG.projectId&&window.FIREBASE_CONFIG.appId)}
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
  const app=initializeApp(window.FIREBASE_CONFIG);
  auth=getAuth(app);
  onAuthStateChanged(auth,user=>{
    currentUser=user;
    if(user&&!isInstitutional(user.email||'')){signOut(auth);currentUser=null;alert('Solo se permiten cuentas @'+allowedDomain)}
    updateAuthUI();
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

function buildProfileRows(){
  const f=['Licenciatura o TSU','Posgrado 1','Posgrado 2','Posgrado 3','Posgrado 4','Posgrado 5','Posgrado 6'];
  $('formacion').innerHTML=f.map((lab,i)=>`<div class="form-row two"><div class="row-label">${lab}${i===0?' *':''}</div><input placeholder="Grado / estudio" data-g="f${i+1}a"><input placeholder="Institución" data-g="f${i+1}b"></div>`).join('');
  $('docencia').innerHTML=Array.from({length:4},(_,i)=>`<div class="form-row two"><div class="row-label">Institución ${i+1}${i===0?' *':''}</div><input placeholder="Institución" data-g="d${i+1}a"><input placeholder="Periodo" data-g="d${i+1}c"></div>`).join('');
  $('laboral').innerHTML=Array.from({length:5},(_,i)=>`<div class="form-row"><div class="row-label">Organización ${i+1}${i===0?' *':''}</div><input placeholder="Organización" data-g="l${i+1}a"><input placeholder="Cargo" data-g="l${i+1}b"><input placeholder="Periodo" data-g="l${i+1}c"></div>`).join('');
}
function loadProfile(){
  CATEGORIES.forEach(c=>$('categoria').add(new Option(c,c)));buildProfileRows();
  const p=store.profile||{};['apPat','apMat','nombres','categoria'].forEach(x=>{if(p[x])$(x).value=p[x]});
  document.querySelectorAll('[data-g]').forEach(x=>x.value=(p.extra||{})[x.dataset.g]||'');
}
function collectProfile(){let extra={};document.querySelectorAll('[data-g]').forEach(x=>extra[x.dataset.g]=x.value.trim());store.profile={apPat:$('apPat').value.trim(),apMat:$('apMat').value.trim(),nombres:$('nombres').value.trim(),categoria:$('categoria').value,extra};persist();return store.profile}
function validateProfile(){const p=collectProfile(),e=p.extra||{},errs=[];if(!p.apPat)errs.push('Capture el apellido paterno.');if(!p.apMat)errs.push('Capture el apellido materno.');if(!p.nombres)errs.push('Capture los nombres.');if(!p.categoria)errs.push('Seleccione la categoría.');if(!e.f1a||!e.f1b)errs.push('Capture la primera línea de Formación profesional.');if(!e.d1a||!e.d1c)errs.push('Capture la primera línea de Experiencia docente.');if(!e.l1a||!e.l1b||!e.l1c)errs.push('Capture la primera línea de Experiencia laboral.');return{ok:!errs.length,errors:errs}}
window.saveSection=function(){collectProfile();toast('Sección guardada.')}
window.continueToCapture=function(){const v=validateProfile();$('profileErrors').innerHTML=v.ok?'':statusBox(v.errors,'Complete los datos obligatorios antes de continuar.');if(!v.ok)return;renderCurrentProgram();window.go('captura',true)}

function originCode(a){return(a.origins||[]).join('')}
function normalizeOrigins(code){return String(code).split('').map(Number)}
window.setEnabled=function(pid,s,c,name,on){if(isEnglish(name))return;const r=getAns(pid,s,c,name);r.status=on?(r.status==='off'?'pending':r.status):'off';if(!on){r.origins=[];r.ideal=false}answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()}
window.setCompetence=function(pid,s,c,name,level){const r=getAns(pid,s,c,name);if(['off','na'].includes(r.status))return;r.status=level;r.origins=[];answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()}
window.setOriginCode=function(pid,s,c,name,code){const r=getAns(pid,s,c,name);if(!['X','XX'].includes(r.status))return;r.origins=normalizeOrigins(code);answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()}
window.toggleIdeal=function(pid,s,c,name){const r=getAns(pid,s,c,name);if(!['X','XX'].includes(r.status)||(r.origins||[]).length===0){toast('Primero seleccione competencia y área de conocimiento.');return}r.ideal=!r.ideal;answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()}
function replicateCommon(pid,s,c,r){const p=programs().find(x=>x.id===pid);if(!(s<3&&p&&p.common&&COMMON_GROUPS[p.common]))return;COMMON_GROUPS[p.common].forEach(other=>answers[key(other,s,c)]={status:r.status,origins:[...(r.origins||[])],ideal:!!r.ideal})}

function programStats(p){let total=0,done=0,missing=0;p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{if(isEnglish(name))return;total++;const a=getAns(p.id,s,c,name);if(a.status!=='pending')done++;else missing++}));return{total,done,missing}}
function overallStats(){let total=0,done=0,invalid=0,pending=[];programs().forEach((p,pi)=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{if(isEnglish(name))return;total++;const a=getAns(p.id,s,c,name);if(a.status!=='pending')done++;else pending.push({pi,name});if(['X','XX'].includes(a.status)&&!(a.origins||[]).length)invalid++})));return{total,done,invalid,pending}}
function idealCount(){const u=new Set();programs().forEach(p=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{if(getAns(p.id,s,c,name).ideal)u.add(`${p.id}|${s}|${c}`)})));return u.size}
function updateProgress(){const x=overallStats(),pct=x.total?Math.round(x.done/x.total*100):0;$('progressText').textContent=`${x.done} de ${x.total} revisadas (${pct}%)`;$('progressBar').style.width=pct+'%';$('idealCounter').textContent=`Materias ideales: ${idealCount()} / mínimo 3`}
function currentProgram(){return programs()[currentProgramIndex]}
function eligibleCourses(p){const opts=[];p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{const a=getAns(p.id,s,c,name);if(['X','XX'].includes(a.status)&&(a.origins||[]).length)opts.push({id:`${s}|${c}`,text:`${s+1}.° · ${name}`})}));return opts}
window.toggleCoordinator=function(pid,id,checked){programMeta[pid]=programMeta[pid]||{};let arr=programMeta[pid].coordinators||[];arr=checked?[...new Set([...arr,id])]:arr.filter(x=>x!==id);programMeta[pid].coordinators=arr;persist()}
function renderCoordinator(p){const eligible=eligibleCourses(p),chosen=(programMeta[p.id]||{}).coordinators||[];return `<details class="coordinator-panel"><summary>Coordinación de academia (opcional) · Puede seleccionar más de una materia</summary><div class="coord-options">${eligible.length?eligible.map(o=>`<label class="coord-chip"><input type="checkbox" ${chosen.includes(o.id)?'checked':''} onchange="toggleCoordinator('${p.id}','${o.id}',this.checked)">${o.text}</label>`).join(''):`<span class="coord-empty">Se habilita cuando existan materias con competencia capturada.</span>`}</div></details>`}

const pastelTitles=['#eef4f9','#f7efe7','#edf6f0','#f2effa','#fff4ea','#ecf6f8','#f8eef1','#eef5e9'];
function renderCurrentProgram(){
  const p=currentProgram();if(!p)return;
  $('programStep').textContent=`Programa ${currentProgramIndex+1} de ${programs().length}`;
  $('programFlowName').textContent=`${p.name} — ${p.exit}`;
  const st=programStats(p);
  let bg = pastelTitles[currentProgramIndex % pastelTitles.length];
  let h=`<article class="program"><div class="program-head" style="background:${bg}"><div class="program-title"><strong>${p.name}</strong><span><b>Salida lateral:</b> ${p.exit}</span></div><div class="program-progress">${st.done}/${st.total} revisadas${st.missing?` · ${st.missing} pendientes`:''}</div></div>${p.common?`<div class="common-note">Tronco común: los cuatrimestres 1–3 se sincronizan automáticamente con los demás programas de esta familia.</div>`:''}${renderCoordinator(p)}<div class="semesters-grid">`;
  p.semesters.forEach((sem,s)=>{
    h+=`<div class="semester-card"><h4>${s+1}.° cuatrimestre <span>${sem.length} asignaturas</span></h4><div class="course-columns"><span>Asignatura</span><span>Habilitar</span><span>Competencia</span><span>Área conocimiento</span><span>Materia ideal</span></div>`;
    sem.forEach((name,c)=>{
      const a=getAns(p.id,s,c,name),na=isEnglish(name),enc=encodeURIComponent(name),enabled=!['off','na'].includes(a.status),pending=a.status==='pending';
      h+=`<div class="course ${pending?'pending':''} ${a.status==='off'?'off':''} ${na?'na':''}">
      <div class="name">${name}${na?' · NO APLICA':''}</div>
      <label class="toggle ${na?'locked':''}"><input type="checkbox" ${enabled?'checked':''} ${na?'disabled':''} onchange="setEnabled('${p.id}',${s},${c},decodeURIComponent('${enc}'),this.checked)"><span class="switch"></span><span>${na?'Bloqueado':enabled?'Sí':'No'}</span></label>
      <div class="comp-buttons"><button class="mini ${a.status==='X'?'on':''}" ${!enabled?'disabled':''} onclick="setCompetence('${p.id}',${s},${c},decodeURIComponent('${enc}'),'X')">X</button><button class="mini ${a.status==='XX'?'on':''}" ${!enabled?'disabled':''} onclick="setCompetence('${p.id}',${s},${c},decodeURIComponent('${enc}'),'XX')">XX</button></div>
      <div class="area-buttons">${['1','2','3','12','13','23','123'].map(code=>`<button class="mini area ${originCode(a)===code?'on':''}" ${!['X','XX'].includes(a.status)?'disabled':''} onclick="setOriginCode('${p.id}',${s},${c},decodeURIComponent('${enc}'),'${code}')">${code}</button>`).join('')}</div>
      <button class="ideal-btn ${a.ideal?'on':''}" ${!enabled?'disabled':''} onclick="toggleIdeal('${p.id}',${s},${c},decodeURIComponent('${enc}'))">★ ${a.ideal?'Ideal':'Marcar ideal'}</button></div>`
    });
    h+='</div>';
  });
  h+=`</div><div class="program-save"><small>${st.missing?'Las filas rojizas indican materias pendientes.':'Programa completo.'}</small><button class="save-btn" onclick="saveAndNextProgram()">Guardar y seguir al siguiente programa →</button></div></article>`;
  $('programs').innerHTML=h;updateProgress();lockRevisionNav();
}
window.prevProgram=function(){currentProgramIndex=(currentProgramIndex-1+programs().length)%programs().length;persist();renderCurrentProgram();scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'})}
window.saveAndNextProgram=function(){persist();toast('Programa guardado.');currentProgramIndex=(currentProgramIndex+1)%programs().length;persist();renderCurrentProgram();scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'})}

function validateCapture(){const x=overallStats(),errs=[];if(x.done<x.total)errs.push(`Faltan ${x.total-x.done} asignaturas por revisar.`);if(x.invalid)errs.push(`${x.invalid} asignatura(s) tienen X/XX pero no tienen área de conocimiento.`);if(idealCount()<3)errs.push(`Debe seleccionar al menos 3 materias ideales. Actualmente hay ${idealCount()}.`);return{ok:!errs.length,errors:errs}}
function validateAll(){const p=validateProfile(),c=validateCapture();return{ok:p.ok&&c.ok,errors:[...p.errors,...c.errors]}}
function showCaptureErrors(errs){$('captureErrors').innerHTML=statusBox(errs,'No puede pasar a revisión todavía.');const p=overallStats().pending;if(p.length){currentProgramIndex=p[0].pi;renderCurrentProgram()}}
window.validateAndReview=function(){collectProfile();persist();const v=validateAll();if(!v.ok){showCaptureErrors(v.errors);toast('Complete las materias pendientes.');return}$('captureErrors').innerHTML='';$('validation').innerHTML=`<div class="status-box ok"><b>Perfil completo.</b><br>La información puede formalizarse e imprimirse.</div>`;buildPrint();window.go('revision',true)}
function lockRevisionNav(){$('navRevision').classList.toggle('locked',!validateAll().ok)}
window.saveAll=function(show=false){collectProfile();persist();updateProgress();lockRevisionNav();if(show)toast('Perfil guardado.')}

function printHeader(){
  return `<div class="sheetHead">
    <div class="brandPrint">
      <img src="logo-uteq-blue.png" class="print-logo">
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
  return `<div class="sheet">${printHeader()}<div class="meta center compactline"><span><b>Nombre:</b> ${fullName()}</span><span><b>Categoría:</b> ${store.profile?.categoria||''}</span></div><table class="profileTable"><tr><th colspan="4">1. FORMACIÓN PROFESIONAL</th></tr>${f.map((lab,i)=>`<tr><td><b>${lab}</b></td><td>${e[`f${i+1}a`]||''}</td><td><b>Institución</b></td><td>${e[`f${i+1}b`]||''}</td></tr>`).join('')}<tr><th colspan="4">2. EXPERIENCIA DOCENTE</th></tr>${[1,2,3,4].map(i=>`<tr><td><b>Institución ${i}</b></td><td colspan="2">${e[`d${i}a`]||''}</td><td><b>Periodo:</b> ${e[`d${i}c`]||''}</td></tr>`).join('')}<tr><th colspan="4">3. EXPERIENCIA LABORAL</th></tr>${[1,2,3,4,5].map(i=>`<tr><td><b>Organización ${i}</b></td><td>${e[`l${i}a`]||''}</td><td><b>Cargo:</b> ${e[`l${i}b`]||''}</td><td><b>Periodo:</b> ${e[`l${i}c`]||''}</td></tr>`).join('')}</table>${signatures()}</div>`
}
function pastelColor(index){
  return ['#edf3f9','#f8f0e8','#edf7f1','#f3effa','#fff3ea','#ebf6f8','#f9edf1','#eef6ea'][index % 8]
}
function printProgram(pr, idx){
  const max=Math.max(...pr.semesters.map(s=>s.length));
  const pastel=pastelColor(idx);
  const colgroup=`<colgroup>${Array.from({length:pr.semesters.length},()=>`<col class="subject"><col class="level"><col class="area">`).join('')}</colgroup>`;
  const th=pr.semesters.map((s,i)=>`<th colspan="3" style="background:${pastel}">${i+1}.° CUATRIMESTRE</th>`).join('');
  const sub=pr.semesters.map(()=>`<th style="background:${pastel}">Asignatura</th><th class="vhead" style="background:${pastel}">Nivel</th><th class="vhead" style="background:${pastel}">Área de competencia</th>`).join('');
  let rows='';
  for(let r=0;r<max;r++){
    rows+='<tr>'+pr.semesters.map((sem,s)=>{
      const name=sem[r]||'';
      if(!name)return '<td></td><td class="level"></td><td class="area"></td>';
      const a=getAns(pr.id,s,r,name),comp=['X','XX'].includes(a.status)?a.status:'',area=['X','XX'].includes(a.status)?originCode(a):'';
      return `<td class="subject">${name}</td><td class="level">${comp}</td><td class="area">${area}</td>`
    }).join('')+'</tr>'
  }
  return `<div class="print-program" style="--program-pastel:${pastel}"><div class="print-program-title" style="background:${pastel}">${pr.name.toUpperCase()} · SALIDA LATERAL: ${pr.exit.toUpperCase()}</div><table class="currTable">${colgroup}<tr>${th}</tr><tr>${sub}</tr>${rows}</table></div>`
}
function buildPrint(){
  collectProfile();
  const ps=programs();
  let html=preambleSheet();
  for(let i=0;i<ps.length;i+=2){
    html+=`<div class="sheet program-pair">${printHeader()}${metaCentered()}${printProgram(ps[i],i)}${ps[i+1]?printProgram(ps[i+1],i+1):''}${signatures()}</div>`
  }
  $('printArea').innerHTML=html
}
window.printProfile=function(){const v=validateAll();if(!v.ok){window.go('captura',true);showCaptureErrors(v.errors);return}buildPrint();window.print()}

window.saveAdmin=function(){cfg.jefe=$('jefe').value.trim()||cfg.jefe;cfg.codigo=$('codigo').value.trim()||cfg.codigo;cfg.revision=$('revisionCal').value.trim()||cfg.revision;cfg.fechaRevision=$('fechaRevision').value.trim()||cfg.fechaRevision;cfg.periodo=$('periodoAdmin').value.trim()||cfg.periodo;updatePeriodBadges();persist();toast('Configuración guardada.')}
function renderAdmin(){$('jefe').value=cfg.jefe;$('codigo').value=cfg.codigo;$('revisionCal').value=cfg.revision;$('fechaRevision').value=cfg.fechaRevision;$('periodoAdmin').value=cfg.periodo;renderSemesterEditors();renderCustomPrograms();renderRules()}
function renderSemesterEditors(){let h='';for(let i=0;i<newSemesterCount;i++)h+=`<div class="semester-editor"><div class="semester-editor-head"><b>${i+1}.° cuatrimestre</b>${newSemesterCount>1?`<button onclick="removeSemesterEditor(${i})">Quitar</button>`:''}</div><textarea id="newSem${i}" placeholder="Una asignatura por línea"></textarea></div>`;$('newProgramSemesters').innerHTML=h}
window.addSemesterEditor=function(){newSemesterCount++;renderSemesterEditors()}
window.removeSemesterEditor=function(i){const vals=Array.from({length:newSemesterCount},(_,x)=>$(`newSem${x}`)?.value||'');vals.splice(i,1);newSemesterCount=Math.max(1,newSemesterCount-1);renderSemesterEditors();vals.forEach((v,x)=>$(`newSem${x}`).value=v)}
function slug(s){return 'custom_'+s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_')+'_'+Date.now()}
window.saveNewProgram=function(){
  const name=$('newProgramName').value.trim(),exit=$('newProgramExit').value.trim(),semesters=Array.from({length:newSemesterCount},(_,i)=>($(`newSem${i}`).value||'').split(/\n+/).map(x=>x.trim()).filter(Boolean));
  if(!name||!exit||semesters.some(x=>!x.length)){toast('Complete nombre, salida lateral y materias.');return}
  customPrograms.push({id:slug(name),name,exit,common:null,semesters});$('newProgramName').value='';$('newProgramExit').value='';newSemesterCount=5;persist();renderAdmin();renderCurrentProgram();toast('Programa educativo agregado.');
}
window.deleteCustomProgram=function(id){if(!confirm('¿Eliminar este programa?'))return;customPrograms=customPrograms.filter(p=>p.id!==id);persist();renderAdmin();renderCurrentProgram()}
function renderCustomPrograms(){$('customProgramsList').innerHTML=customPrograms.length?`<h3 style="margin-top:16px">Programas agregados</h3>`+customPrograms.map(p=>`<div class="custom-program-item"><div><b>${p.name}</b><br>${p.exit}</div><button onclick="deleteCustomProgram('${p.id}')">Eliminar</button></div>`).join(''):''}
function renderRules(){$('commonRules').innerHTML=`<p><b>Ingeniería Industrial:</b> cuatrimestres 1–3 sincronizados entre Procesos Productivos y Moldeo de Plásticos.</p><p><b>Ingeniería Mecánica:</b> cuatrimestres 1–3 sincronizados entre Mecánica Industrial, Mecánica Automotriz y Mecánica Moldes y Troqueles.</p><p><b>Sin tronco común:</b> Mecánica Automotriz / Diseño y Manufactura Automotriz, Nanotecnología y Mantenimiento Industrial.</p>`}

async function exportWorkbook(){
  const XLSX=await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  collectProfile();const p=store.profile||{},base=[];
  programs().forEach(pr=>pr.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{const a=getAns(pr.id,s,c,name);base.push({Profesor:fullName(),Categoria:p.categoria||'',Periodo:cfg.periodo,Programa:pr.name,'Salida lateral':pr.exit,Cuatrimestre:s+1,Asignatura:name,'Estado interno':a.status,'Nivel competencia':['X','XX'].includes(a.status)?a.status:'','Área conocimiento':originCode(a),'Materia ideal':a.ideal?'Sí':'','Coordinador de academia':((programMeta[pr.id]||{}).coordinators||[]).includes(`${s}|${c}`)?'Sí':''})})));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(base),'Base maestra');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(programs().flatMap(pr=>pr.semesters.flatMap((sem,s)=>sem.map(name=>({Programa:pr.name,'Salida lateral':pr.exit,Cuatrimestre:s+1,Asignatura:name}))))),'Catálogo');
  XLSX.writeFile(wb,`Base_Maestra_${fullName().replace(/[^a-záéíóúñ0-9]+/gi,'_')||'perfil'}.xlsx`);
}
window.exportExcel=function(){if(!isAdmin()){toast('Solo el administrador puede exportar la base maestra.');return}exportWorkbook().catch(e=>alert('No fue posible generar Excel: '+e.message))}

function init(){
  loadProfile();
  updatePeriodBadges();
  initAuth();
  renderCurrentProgram();
  renderAdmin();
  lockRevisionNav();
}
init();
