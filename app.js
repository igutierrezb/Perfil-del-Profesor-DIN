const $=id=>document.getElementById(id);
const store=JSON.parse(localStorage.getItem('PAD_UTEQ')||'{}');
const cfg=Object.assign({jefe:'Iván Gutiérrez Bautista',codigo:'EA-F-86',revision:'Rev.01',fechaRevision:'21-sep-2018',periodo:'SEP 2026 - AGO 2027'},store.cfg||{});
let answers=store.answers||{};
let programMeta=store.programMeta||{};
let customPrograms=store.customPrograms||[];
let currentProgramIndex=Number.isInteger(store.currentProgramIndex)?store.currentProgramIndex:0;
let newSemesterCount=5;
const ADMIN_PIN='DIN2026';

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
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2200)}
function persist(){
  cfg.periodo=$('periodo').value.trim()||cfg.periodo;
  store.cfg=cfg;store.answers=answers;store.programMeta=programMeta;store.customPrograms=customPrograms;store.currentProgramIndex=currentProgramIndex;
  localStorage.setItem('PAD_UTEQ',JSON.stringify(store))
}
function statusBox(errors,title){return `<div class="status-box bad"><b>${title}</b><ul>${errors.map(x=>`<li>${x}</li>`).join('')}</ul></div>`}
function go(id,force=false){
  if(id==='captura'&&!force){const p=validateProfile();if(!p.ok){$('profileErrors').innerHTML=statusBox(p.errors,'Complete los datos obligatorios antes de continuar.');toast('Faltan datos obligatorios.');return}}
  if(id==='revision'&&!force){const v=validateAll();if(!v.ok){showCaptureErrors(v.errors);toast('La revisión permanece bloqueada hasta completar toda la captura.');return}}
  if(id==='admin'&&sessionStorage.getItem('PAD_ADMIN')!=='1'){unlockAdmin();return}
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$(id).classList.add('active');
  document.querySelectorAll('.main-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  if(id==='revision')buildPrint();if(id==='admin')renderAdmin();scrollTo(0,0)
}
document.querySelectorAll('.main-nav button').forEach(b=>b.onclick=()=>go(b.dataset.view));

function buildProfileRows(){
  const f=['Licenciatura o TSU','Posgrado 1','Posgrado 2','Posgrado 3','Posgrado 4','Posgrado 5','Posgrado 6'];
  $('formacion').innerHTML=f.map((lab,i)=>`<div class="form-row two"><div class="row-label">${lab}${i===0?' *':''}</div><input placeholder="Grado / estudio" data-g="f${i+1}a"><input placeholder="Institución" data-g="f${i+1}b"></div>`).join('');
  $('docencia').innerHTML=Array.from({length:4},(_,i)=>`<div class="form-row two"><div class="row-label">Institución ${i+1}${i===0?' *':''}</div><input placeholder="Institución" data-g="d${i+1}a"><input placeholder="Periodo" data-g="d${i+1}c"></div>`).join('');
  $('laboral').innerHTML=Array.from({length:5},(_,i)=>`<div class="form-row"><div class="row-label">Organización ${i+1}${i===0?' *':''}</div><input placeholder="Organización" data-g="l${i+1}a"><input placeholder="Cargo" data-g="l${i+1}b"><input placeholder="Periodo" data-g="l${i+1}c"></div>`).join('')
}
function loadProfile(){
  CATEGORIES.forEach(c=>$('categoria').add(new Option(c,c)));buildProfileRows();
  const p=store.profile||{};['apPat','apMat','nombres','categoria'].forEach(x=>{if(p[x])$(x).value=p[x]});
  document.querySelectorAll('[data-g]').forEach(x=>x.value=(p.extra||{})[x.dataset.g]||'')
}
function collectProfile(){
  let extra={};document.querySelectorAll('[data-g]').forEach(x=>extra[x.dataset.g]=x.value.trim());
  store.profile={apPat:$('apPat').value.trim(),apMat:$('apMat').value.trim(),nombres:$('nombres').value.trim(),categoria:$('categoria').value,extra};persist();return store.profile
}
function validateProfile(){
  const p=collectProfile(),e=p.extra||{},errs=[];
  if(!p.apPat)errs.push('Capture el apellido paterno.');if(!p.apMat)errs.push('Capture el apellido materno.');if(!p.nombres)errs.push('Capture los nombres.');if(!p.categoria)errs.push('Seleccione la categoría.');
  if(!e.f1a||!e.f1b)errs.push('Capture la primera línea de Formación profesional.');
  if(!e.d1a||!e.d1c)errs.push('Capture la primera línea de Experiencia docente.');
  if(!e.l1a||!e.l1b||!e.l1c)errs.push('Capture la primera línea de Experiencia laboral.');
  return{ok:!errs.length,errors:errs}
}
function saveSection(x){collectProfile();toast('Sección guardada.')}
function continueToCapture(){const v=validateProfile();$('profileErrors').innerHTML=v.ok?'':statusBox(v.errors,'Complete los datos obligatorios antes de continuar.');if(!v.ok)return;renderProgramNavigator();renderCurrentProgram();go('captura',true)}

function normalizeOrigins(value){return String(value).split('').map(Number)}
function originCode(a){return (a.origins||[]).join('')}
function setEnabled(pid,s,c,name,enabled){
  if(isEnglish(name))return;
  const r=getAns(pid,s,c,name);r.status=enabled?(r.status==='off'?'pending':r.status):'off';
  if(!enabled){r.origins=[];r.ideal=false}
  answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()
}
function setCompetence(pid,s,c,name,level){
  const r=getAns(pid,s,c,name);if(r.status==='off'||r.status==='na')return;
  r.status=level;r.origins=[];answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()
}
function setOriginCode(pid,s,c,name,code){
  const r=getAns(pid,s,c,name);if(!['X','XX'].includes(r.status))return;
  r.origins=normalizeOrigins(code);answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()
}
function toggleIdeal(pid,s,c,name){
  const r=getAns(pid,s,c,name);if(!['X','XX'].includes(r.status)){toast('Primero defina X o XX y el área de conocimiento.');return}
  if(!(r.origins||[]).length){toast('Primero seleccione el área que da el conocimiento.');return}
  r.ideal=!r.ideal;answers[key(pid,s,c)]=r;replicateCommon(pid,s,c,r);persist();renderCurrentProgram()
}
function replicateCommon(pid,s,c,r){
  const p=programs().find(x=>x.id===pid);if(!(s<3&&p&&p.common&&COMMON_GROUPS[p.common]))return;
  COMMON_GROUPS[p.common].forEach(other=>answers[key(other,s,c)]={status:r.status,origins:[...(r.origins||[])],ideal:!!r.ideal})
}
function programStats(p){
  let total=0,done=0,missing=0;p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{if(isEnglish(name))return;total++;const a=getAns(p.id,s,c,name);if(a.status!=='pending')done++;else missing++}));
  return{total,done,missing}
}
function overallStats(){
  let total=0,done=0,invalid=0,pending=[];
  programs().forEach(p=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{if(isEnglish(name))return;total++;const a=getAns(p.id,s,c,name);if(a.status!=='pending')done++;else pending.push(`${p.name} · ${s+1}.° · ${name}`);if(['X','XX'].includes(a.status)&&!(a.origins||[]).length)invalid++})));
  return{total,done,invalid,pending}
}
function idealCount(){const u=new Set();programs().forEach(p=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{if(getAns(p.id,s,c,name).ideal)u.add(name.toUpperCase())})));return u.size}
function updateProgress(){
  const x=overallStats(),pct=x.total?Math.round(x.done/x.total*100):0;$('progressText').textContent=`${x.done} de ${x.total} revisadas (${pct}%)`;$('progressBar').style.width=pct+'%';$('idealCounter').textContent=`Materias ideales: ${idealCount()} / mínimo 3`
}
function renderProgramNavigator(){
  const ps=programs();if(currentProgramIndex>=ps.length)currentProgramIndex=0;
  $('programSelect').innerHTML=ps.map((p,i)=>`<option value="${i}" ${i===currentProgramIndex?'selected':''}>${i+1}. ${p.name} — ${p.exit}</option>`).join('');
  $('programStep').textContent=`Programa ${currentProgramIndex+1} de ${ps.length}`
}
function selectProgram(i){currentProgramIndex=Math.max(0,Math.min(programs().length-1,i));persist();renderProgramNavigator();renderCurrentProgram();scrollTo({top:$('captura').offsetTop-55,behavior:'smooth'})}
function prevProgram(){selectProgram((currentProgramIndex-1+programs().length)%programs().length)}
function nextProgram(){selectProgram((currentProgramIndex+1)%programs().length)}
function eligibleCourses(p){
  const opts=[];p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{const a=getAns(p.id,s,c,name);if(['X','XX'].includes(a.status)&&(a.origins||[]).length)opts.push({id:`${s}|${c}`,text:`${s+1}.° · ${name}`})}));return opts
}
function toggleCoordinator(pid,id,checked){
  programMeta[pid]=programMeta[pid]||{};let arr=programMeta[pid].coordinators||[];
  arr=checked?[...new Set([...arr,id])]:arr.filter(x=>x!==id);programMeta[pid].coordinators=arr;persist()
}
function renderCoordinator(p){
  const eligible=eligibleCourses(p),chosen=(programMeta[p.id]||{}).coordinators||[];
  return `<details class="coordinator-panel"><summary>Coordinación de academia (opcional) · Puede seleccionar más de una materia</summary>
    <div class="coord-options">${eligible.length?eligible.map(o=>`<label class="coord-chip"><input type="checkbox" ${chosen.includes(o.id)?'checked':''} onchange="toggleCoordinator('${p.id}','${o.id}',this.checked)">${o.text}</label>`).join(''):`<span class="coord-empty">Cuando marque materias con X/XX y área de conocimiento, aparecerán aquí para poder seleccionar las que haya coordinado.</span>`}</div></details>`
}
function renderCurrentProgram(){
  const p=programs()[currentProgramIndex];if(!p)return;
  const st=programStats(p);let h=`<article class="program">
  <div class="program-head"><div class="program-title"><strong>${p.name}</strong><span><b>Salida lateral:</b> ${p.exit}</span></div><div class="program-progress">${st.done}/${st.total} revisadas${st.missing?` · ${st.missing} pendientes`:''}</div></div>
  ${p.common?`<div class="common-note">Tronco común: los cuatrimestres 1–3 se sincronizan automáticamente con los demás programas de esta familia. No necesita capturarlos de nuevo.</div>`:''}
  ${renderCoordinator(p)}<div class="semesters-grid">`;
  p.semesters.forEach((sem,s)=>{
    h+=`<div class="semester-card"><h4>${s+1}.° cuatrimestre <span>${sem.length} asignaturas</span></h4>
      <div class="course-columns"><span>Asignatura</span><span>Habilitar</span><span>Competencia</span><span>Área conocimiento</span><span>Materia ideal</span></div>`;
    sem.forEach((name,c)=>{
      const a=getAns(p.id,s,c,name),na=isEnglish(name),enc=encodeURIComponent(name),enabled=!['off','na'].includes(a.status),pending=a.status==='pending';
      h+=`<div class="course ${pending?'pending':''} ${a.status==='off'?'off':''} ${na?'na':''}">
        <div class="name">${name}${na?' · NO APLICA':''}</div>
        <label class="toggle ${na?'locked':''}" title="${na?'Inglés está bloqueado como NO APLICA':enabled?'Deshabilitar asignatura':'Habilitar asignatura'}">
          <input type="checkbox" ${enabled?'checked':''} ${na?'disabled':''} onchange="setEnabled('${p.id}',${s},${c},decodeURIComponent('${enc}'),this.checked)">
          <span class="switch"></span><span class="toggle-text">${na?'Bloqueado':enabled?'Sí':'No'}</span>
        </label>
        <div class="compact-actions">
          <button class="mini ${a.status==='X'?'on':''}" ${!enabled?'disabled':''} onclick="setCompetence('${p.id}',${s},${c},decodeURIComponent('${enc}'),'X')">X</button>
          <button class="mini ${a.status==='XX'?'on':''}" ${!enabled?'disabled':''} onclick="setCompetence('${p.id}',${s},${c},decodeURIComponent('${enc}'),'XX')">XX</button>
        </div>
        <div class="area-options">${['1','2','3','12','13','23','123'].map(code=>`<button class="mini ${originCode(a)===code?'on':''}" ${!['X','XX'].includes(a.status)?'disabled':''} onclick="setOriginCode('${p.id}',${s},${c},decodeURIComponent('${enc}'),'${code}')">${code}</button>`).join('')}</div>
        <button class="ideal-btn ${a.ideal?'on':''}" ${!enabled?'disabled':''} onclick="toggleIdeal('${p.id}',${s},${c},decodeURIComponent('${enc}'))">★ ${a.ideal?'Ideal':'Marcar ideal'}</button>
      </div>`;
    });
    h+='</div>';
  });
  h+=`</div><div class="program-save"><small>${st.missing?`Las filas rojas indican materias pendientes por revisar.`:'Programa completo.'}</small><button class="save-btn" onclick="saveProgram('${p.id}')">Guardar este programa</button></div></article>`;
  $('programs').innerHTML=h;updateProgress();renderProgramNavigator();lockRevisionNav()
}
function saveProgram(){persist();toast('Programa educativo guardado.')}
function validateCapture(){
  const x=overallStats(),errs=[];if(x.done<x.total)errs.push(`Faltan ${x.total-x.done} asignaturas por revisar.`);if(x.invalid)errs.push(`${x.invalid} asignatura(s) tienen X/XX pero no tienen área de conocimiento.`);if(idealCount()<3)errs.push(`Debe seleccionar al menos 3 materias ideales. Actualmente hay ${idealCount()}.`);return{ok:!errs.length,errors:errs}
}
function validateAll(){const p=validateProfile(),c=validateCapture();return{ok:p.ok&&c.ok,errors:[...p.errors,...c.errors]}}
function showCaptureErrors(errs){
  $('captureErrors').innerHTML=statusBox(errs,'No puede pasar a revisión todavía.');
  const pending=overallStats().pending;if(pending.length){
    const first=pending[0],ps=programs();const ix=ps.findIndex(p=>first.startsWith(p.name));
    if(ix>=0&&ix!==currentProgramIndex){currentProgramIndex=ix;renderCurrentProgram()}
  }
}
function validateAndReview(){collectProfile();persist();const v=validateAll();if(!v.ok){showCaptureErrors(v.errors);toast('Complete las materias pendientes resaltadas en rojo.');return}$('captureErrors').innerHTML='';$('validation').innerHTML=`<div class="status-box ok"><b>Perfil completo.</b><br>La información puede formalizarse e imprimirse.</div>`;buildPrint();go('revision',true)}
function lockRevisionNav(){const ok=validateAll().ok;$('navRevision').classList.toggle('locked',!ok)}
function saveAll(show=false){collectProfile();persist();updateProgress();lockRevisionNav();if(show)toast('Perfil guardado.')}

function qualityPlain(){return `<div class="quality-plain"><span>${cfg.codigo}</span><span>${cfg.revision}</span><span>Fecha ${cfg.fechaRevision}</span></div>`}
function printHeader(){return `<div class="sheetHead"><img src="logo-uteq.png" class="print-logo" alt="UTEQ"><div class="sheetTitle"><h2>PERFIL DEL PROFESOR</h2><b>DIVISIÓN: INDUSTRIAL</b><br><span>PERIODO DE VIGENCIA: ${cfg.periodo}</span></div>${qualityPlain()}</div><div class="meta"><b>Nombre:</b> ${fullName()} &nbsp;&nbsp; <b>Categoría:</b> ${store.profile?.categoria||''}</div>`}
function signatures(){return `<div class="sign"><div class="signature-line">${fullName()}<br>Firma del Profesor</div><div class="stamp-box">SELLO</div><div class="signature-line">${cfg.jefe}<br>Jefe de Unidad de Coordinación Académica</div></div>`}
function preambleSheet(){
  const p=store.profile||{},e=p.extra||{},f=['Licenciatura o TSU','Posgrado 1','Posgrado 2','Posgrado 3','Posgrado 4','Posgrado 5','Posgrado 6'];
  return `<div class="sheet">${printHeader()}<table class="profileTable">
  <tr><th colspan="4">1. FORMACIÓN PROFESIONAL</th></tr>${f.map((lab,i)=>`<tr><td><b>${lab}</b></td><td>${e[`f${i+1}a`]||''}</td><td><b>Institución</b></td><td>${e[`f${i+1}b`]||''}</td></tr>`).join('')}
  <tr><th colspan="4">2. EXPERIENCIA DOCENTE</th></tr>${Array.from({length:4},(_,i)=>`<tr><td><b>Institución ${i+1}</b></td><td colspan="2">${e[`d${i+1}a`]||''}</td><td><b>Periodo:</b> ${e[`d${i+1}c`]||''}</td></tr>`).join('')}
  <tr><th colspan="4">3. EXPERIENCIA LABORAL</th></tr>${Array.from({length:5},(_,i)=>`<tr><td><b>Organización ${i+1}</b></td><td>${e[`l${i+1}a`]||''}</td><td><b>Cargo:</b> ${e[`l${i+1}b`]||''}</td><td><b>Periodo:</b> ${e[`l${i+1}c`]||''}</td></tr>`).join('')}
  </table>${signatures()}</div>`
}
function printProgram(pr){
  const max=Math.max(...pr.semesters.map(s=>s.length));
  const th=pr.semesters.map((s,i)=>`<th colspan="3">${i+1}.° CUATRIMESTRE</th>`).join('');
  const sub=pr.semesters.map(()=>`<th>Asignatura</th><th>Nivel</th><th>Área</th>`).join('');
  let rows='';for(let r=0;r<max;r++){rows+='<tr>'+pr.semesters.map((sem,s)=>{const name=sem[r]||'';if(!name)return'<td></td><td></td><td></td>';const a=getAns(pr.id,s,r,name);const comp=['X','XX'].includes(a.status)?a.status:'';const area=['X','XX'].includes(a.status)?originCode(a):'';return `<td>${name}</td><td>${comp}</td><td>${area}</td>`}).join('')+'</tr>'}
  return `<div class="print-program"><div class="print-program-title">${pr.name.toUpperCase()} · SALIDA LATERAL: ${pr.exit.toUpperCase()}</div><table class="currTable"><tr>${th}</tr><tr>${sub}</tr>${rows}</table></div>`
}
function buildPrint(){
  collectProfile();const ps=programs();let html=preambleSheet();
  for(let i=0;i<ps.length;i+=2){html+=`<div class="sheet program-pair">${printHeader()}<div class="meta"><b>COMPETENCIA:</b> X = MEDIO · XX = ALTO &nbsp;&nbsp; <b>ÁREA:</b> 1 Formación · 2 Docencia · 3 Laboral</div>${printProgram(ps[i])}${ps[i+1]?printProgram(ps[i+1]):''}${signatures()}</div>`}
  $('printArea').innerHTML=html
}
function printProfile(){const v=validateAll();if(!v.ok){go('captura',true);showCaptureErrors(v.errors);return}buildPrint();window.print()}

function saveAdmin(){cfg.jefe=$('jefe').value.trim()||cfg.jefe;cfg.codigo=$('codigo').value.trim()||cfg.codigo;cfg.revision=$('revisionCal').value.trim()||cfg.revision;cfg.fechaRevision=$('fechaRevision').value.trim()||cfg.fechaRevision;cfg.periodo=$('periodoAdmin').value.trim()||cfg.periodo;$('periodo').value=cfg.periodo;persist();toast('Configuración guardada.')}
function renderAdmin(){$('jefe').value=cfg.jefe;$('codigo').value=cfg.codigo;$('revisionCal').value=cfg.revision;$('fechaRevision').value=cfg.fechaRevision;$('periodoAdmin').value=cfg.periodo;renderSemesterEditors();renderCustomPrograms();renderRules()}
function renderSemesterEditors(){let h='';for(let i=0;i<newSemesterCount;i++)h+=`<div class="semester-editor"><div class="semester-editor-head"><b>${i+1}.° cuatrimestre</b>${newSemesterCount>1?`<button onclick="removeSemesterEditor(${i})">Quitar</button>`:''}</div><textarea id="newSem${i}" placeholder="Una asignatura por línea"></textarea></div>`;$('newProgramSemesters').innerHTML=h}
function addSemesterEditor(){newSemesterCount++;renderSemesterEditors()}
function removeSemesterEditor(i){const vals=Array.from({length:newSemesterCount},(_,x)=>$(`newSem${x}`)?.value||'');vals.splice(i,1);newSemesterCount=Math.max(1,newSemesterCount-1);renderSemesterEditors();vals.forEach((v,x)=>$(`newSem${x}`).value=v)}
function slug(s){return'custom_'+s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_')+'_'+Date.now()}
function saveNewProgram(){const name=$('newProgramName').value.trim(),exit=$('newProgramExit').value.trim(),semesters=Array.from({length:newSemesterCount},(_,i)=>($(`newSem${i}`).value||'').split(/\n+/).map(x=>x.trim()).filter(Boolean));if(!name||!exit||semesters.some(x=>!x.length)){toast('Complete nombre, salida lateral y materias.');return}customPrograms.push({id:slug(name),name,exit,common:null,semesters});$('newProgramName').value='';$('newProgramExit').value='';newSemesterCount=5;persist();renderAdmin();renderProgramNavigator();renderCurrentProgram();toast('Programa agregado.')}
function deleteCustomProgram(id){if(!confirm('¿Eliminar este programa?'))return;customPrograms=customPrograms.filter(p=>p.id!==id);persist();renderAdmin();renderProgramNavigator();renderCurrentProgram()}
function renderCustomPrograms(){$('customProgramsList').innerHTML=customPrograms.length?`<h3 style="margin-top:16px">Programas agregados</h3>`+customPrograms.map(p=>`<div class="custom-program-item"><div><b>${p.name}</b><br>${p.exit}</div><button onclick="deleteCustomProgram('${p.id}')">Eliminar</button></div>`).join(''):''}
function renderRules(){$('commonRules').innerHTML=`<p><b>Ingeniería Industrial:</b> cuatrimestres 1–3 sincronizados entre Procesos Productivos y Moldeo de Plásticos.</p><p><b>Ingeniería Mecánica:</b> cuatrimestres 1–3 sincronizados entre Mecánica Industrial, Mecánica Automotriz y Mecánica Moldes y Troqueles.</p><p><b>Sin tronco común:</b> Mecánica Automotriz / Diseño y Manufactura Automotriz, Nanotecnología y Mantenimiento Industrial.</p>`}
function exportExcel(){
  if(typeof XLSX==='undefined'){alert('No fue posible cargar el módulo de Excel.');return}
  collectProfile();const p=store.profile||{},e=p.extra||{},base=[];
  programs().forEach(pr=>pr.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{const a=getAns(pr.id,s,c,name);base.push({Profesor:fullName(),Categoria:p.categoria||'',Periodo:cfg.periodo,Programa:pr.name,'Salida lateral':pr.exit,Cuatrimestre:s+1,Asignatura:name,'Estado interno':a.status,'Nivel competencia':['X','XX'].includes(a.status)?a.status:'','Área conocimiento':originCode(a),'Materia ideal':a.ideal?'Sí':'','Coordinador de academia':((programMeta[pr.id]||{}).coordinators||[]).includes(`${s}|${c}`)?'Sí':''})})));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(base),'Base maestra');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Campo','Valor'],['Apellido paterno',p.apPat||''],['Apellido materno',p.apMat||''],['Nombres',p.nombres||''],['Categoría',p.categoria||''],['Periodo',cfg.periodo],['Licenciatura o TSU',e.f1a||''],['Institución',e.f1b||'']]),'Resumen profesor');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(programs().flatMap(pr=>pr.semesters.flatMap((sem,s)=>sem.map(name=>({Programa:pr.name,'Salida lateral':pr.exit,Cuatrimestre:s+1,Asignatura:name}))))),'Catálogo');
  XLSX.writeFile(wb,`Base_Maestra_${fullName().replace(/[^a-záéíóúñ0-9]+/gi,'_')||'perfil'}.xlsx`)
}
function unlockAdmin(){
  if(sessionStorage.getItem('PAD_ADMIN')==='1'){$('adminTab').classList.remove('hidden');go('admin',true);return}
  const pin=prompt('Acceso administrativo temporal. Ingrese el PIN:');if(pin===ADMIN_PIN){sessionStorage.setItem('PAD_ADMIN','1');$('adminTab').classList.remove('hidden');go('admin',true)}else if(pin!==null)alert('PIN incorrecto.')
}
function init(){
  loadProfile();$('periodo').value=cfg.periodo;$('periodo').addEventListener('change',()=>{cfg.periodo=$('periodo').value.trim();persist()});
  if(sessionStorage.getItem('PAD_ADMIN')==='1')$('adminTab').classList.remove('hidden');
  renderProgramNavigator();renderCurrentProgram();renderAdmin();lockRevisionNav()
}
init();
