const $=id=>document.getElementById(id);
const deepCopy=x=>JSON.parse(JSON.stringify(x));
const store=JSON.parse(localStorage.getItem('PAD_UTEQ')||'{}');
const cfg=Object.assign({
  jefe:'Iván Gutiérrez Bautista',
  codigo:'EA-F-86',
  revision:'Rev.01',
  fechaRevision:'21-sep-2018',
  periodo:'SEP 2026 - AGO 2027'
},store.cfg||{});

let answers=store.answers||{};
let programMeta=store.programMeta||{};
let customPrograms=store.customPrograms||[];
let newSemesterCount=5;

function programs(){return [...PROGRAMS,...customPrograms]}
function key(pid,s,c){return `${pid}|${s}|${c}`}
function fullName(){
  return [$('apPat').value.trim(),$('apMat').value.trim(),$('nombres').value.trim()].filter(Boolean).join(' ');
}
function isEnglish(name){return /^INGLÉS\b/i.test(name.trim())}
function getAns(pid,s,c,name){
  const k=key(pid,s,c);
  if(isEnglish(name)){
    if(!answers[k]||answers[k].status!=='na') answers[k]={status:'na',origins:[],ideal:false};
    return answers[k];
  }
  return answers[k]||{status:'pending',origins:[],ideal:false};
}
function toast(msg){
  const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>t.classList.remove('show'),2200);
}
function persist(){
  cfg.periodo=$('periodo').value.trim()||cfg.periodo;
  store.cfg=cfg;store.answers=answers;store.programMeta=programMeta;store.customPrograms=customPrograms;
  localStorage.setItem('PAD_UTEQ',JSON.stringify(store));
}
function go(id,force=false){
  if(id==='captura'&&!force){
    const p=validateProfile();
    if(!p.ok){
      $('profileErrors').innerHTML=statusBox(p.errors,'Complete los datos obligatorios antes de continuar.');
      toast('Faltan datos obligatorios del profesor.');
      return;
    }
  }
  if(id==='revision'&&!force){
    const v=validateAll();
    if(!v.ok){showCaptureErrors(v.errors);toast('La revisión permanece bloqueada hasta completar toda la captura.');return}
  }
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  $(id).classList.add('active');
  document.querySelectorAll('.main-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  if(id==='revision')buildPrint();
  if(id==='admin')renderAdmin();
  scrollTo(0,0);
}
document.querySelectorAll('.main-nav button').forEach(b=>b.onclick=()=>go(b.dataset.view));

function buildProfileRows(){
  const fLabels=['Licenciatura o TSU','Posgrado 1','Posgrado 2','Posgrado 3','Posgrado 4','Posgrado 5','Posgrado 6'];
  $('formacion').innerHTML=fLabels.map((lab,i)=>`
    <div class="form-row two">
      <div class="row-label">${lab}${i===0?' *':''}</div>
      <input placeholder="Grado / estudio" data-g="f${i+1}a">
      <input placeholder="Institución" data-g="f${i+1}b">
    </div>`).join('');
  $('docencia').innerHTML=Array.from({length:4},(_,i)=>`
    <div class="form-row two">
      <div class="row-label">Institución ${i+1}${i===0?' *':''}</div>
      <input placeholder="Institución" data-g="d${i+1}a">
      <input placeholder="Periodo" data-g="d${i+1}c">
    </div>`).join('');
  $('laboral').innerHTML=Array.from({length:5},(_,i)=>`
    <div class="form-row">
      <div class="row-label">Organización ${i+1}${i===0?' *':''}</div>
      <input placeholder="Organización" data-g="l${i+1}a">
      <input placeholder="Cargo" data-g="l${i+1}b">
      <input placeholder="Periodo" data-g="l${i+1}c">
    </div>`).join('');
}
function loadProfile(){
  CATEGORIES.forEach(c=>$('categoria').add(new Option(c,c)));
  buildProfileRows();
  const p=store.profile||{};
  ['apPat','apMat','nombres','categoria'].forEach(x=>{if(p[x])$(x).value=p[x]});
  document.querySelectorAll('[data-g]').forEach(x=>x.value=(p.extra||{})[x.dataset.g]||'');
}
function collectProfile(){
  let extra={};document.querySelectorAll('[data-g]').forEach(x=>extra[x.dataset.g]=x.value.trim());
  store.profile={apPat:$('apPat').value.trim(),apMat:$('apMat').value.trim(),nombres:$('nombres').value.trim(),categoria:$('categoria').value,extra};
  persist();return store.profile;
}
function validateProfile(){
  const p=collectProfile(),e=p.extra||{},errs=[];
  if(!p.apPat)errs.push('Capture el apellido paterno.');
  if(!p.apMat)errs.push('Capture el apellido materno.');
  if(!p.nombres)errs.push('Capture los nombres.');
  if(!p.categoria)errs.push('Seleccione la categoría.');
  if(!e.f1a||!e.f1b)errs.push('Capture la primera línea de Formación profesional: estudio e institución.');
  if(!e.d1a||!e.d1c)errs.push('Capture la primera línea de Experiencia docente: institución y periodo.');
  if(!e.l1a||!e.l1b||!e.l1c)errs.push('Capture la primera línea de Experiencia laboral: organización, cargo y periodo.');
  return{ok:!errs.length,errors:errs};
}
function saveSection(section){
  collectProfile();toast(`Sección guardada: ${section}.`);
}
function continueToCapture(){
  const v=validateProfile();
  $('profileErrors').innerHTML=v.ok?'':statusBox(v.errors,'Complete los datos obligatorios antes de continuar.');
  if(!v.ok){toast('Faltan datos obligatorios.');return}
  renderPrograms();go('captura',true);
}
function statusBox(errors,title){
  return `<div class="status-box bad"><b>${title}</b><ul>${errors.map(x=>`<li>${x}</li>`).join('')}</ul></div>`;
}

function setAns(pid,s,c,name,mode){
  if(isEnglish(name))return;
  const k=key(pid,s,c),r=getAns(pid,s,c,name);
  r.status=(r.status==='off'&&mode==='off')?'pending':mode;
  if(['off','pending'].includes(r.status))r.origins=[];
  answers[k]=r;
  replicateCommon(pid,s,c,r);
  persist();renderPrograms();
}
function toggleOrigin(pid,s,c,name,n){
  const k=key(pid,s,c),r=getAns(pid,s,c,name);
  if(!['X','XX'].includes(r.status))return;
  r.origins=r.origins||[];
  r.origins=r.origins.includes(n)?r.origins.filter(x=>x!==n):[...r.origins,n].sort();
  answers[k]=r;replicateCommon(pid,s,c,r);persist();renderPrograms();
}
function toggleIdeal(pid,s,c,name){
  if(isEnglish(name))return;
  const k=key(pid,s,c),r=getAns(pid,s,c,name);
  if(!['X','XX'].includes(r.status)){toast('Primero marque X o XX para elegirla como materia ideal.');return}
  r.ideal=!r.ideal;answers[k]=r;replicateCommon(pid,s,c,r);persist();renderPrograms();
}
function replicateCommon(pid,s,c,r){
  const prog=programs().find(p=>p.id===pid);
  if(s<3&&prog&&prog.common&&COMMON_GROUPS[prog.common]){
    COMMON_GROUPS[prog.common].forEach(other=>{
      answers[key(other,s,c)]={status:r.status,origins:[...(r.origins||[])],ideal:!!r.ideal};
    });
  }
}
function updateCoordinator(pid,val){
  programMeta[pid]=programMeta[pid]||{};
  programMeta[pid].coordinator=val||'';
  persist();toast('Coordinación de academia guardada.');
}
function eligibleCourses(p){
  const opts=[];
  p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    const a=getAns(p.id,s,c,name);
    if(['X','XX'].includes(a.status))opts.push({value:`${s}|${c}`,text:`${s+1}.° · ${name}`});
  }));
  return opts;
}
function renderPrograms(){
  let html='';
  programs().forEach(p=>{
    const ps=programStats(p);
    const coord=(programMeta[p.id]||{}).coordinator||'';
    const elig=eligibleCourses(p);
    html+=`<article class="program">
      <div class="program-head">
        <div class="program-title"><strong>${p.name}</strong><span><b>Salida lateral:</b> ${p.exit}</span></div>
        <div class="program-progress">${ps.done}/${ps.total} revisadas</div>
      </div>
      <div class="program-tools">
        ${p.common?`<div class="common-note">Tronco común: los cuatrimestres 1–3 se sincronizan únicamente con los programas definidos en esta misma familia.</div>`:''}
        <label>¿Ha sido coordinador de academia de alguna materia?
          <select onchange="updateCoordinator('${p.id}',this.value)">
            <option value="">No / Seleccione una materia</option>
            ${elig.map(o=>`<option value="${o.value}" ${coord===o.value?'selected':''}>${o.text}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="semesters-grid">`;
    p.semesters.forEach((sem,s)=>{
      html+=`<div class="semester-card"><h4>${s+1}.° cuatrimestre <span>${sem.length} asignaturas</span></h4>`;
      sem.forEach((name,c)=>{
        const a=getAns(p.id,s,c,name);
        const na=isEnglish(name);
        const enc=encodeURIComponent(name);
        html+=`<div class="course ${a.status==='off'?'off':''} ${na?'na':''}">
          <div class="name">${name}${na?' <small>· NO APLICA</small>':''}</div>
          <div class="compact-actions">
            ${na?`<button class="mini na-btn" disabled>—</button>`:
            `<button class="mini offbtn ${a.status==='off'?'on':''}" title="${a.status==='off'?'Reactivar asignatura':'Desactivar; se imprimirá vacía'}" onclick="setAns('${p.id}',${s},${c},decodeURIComponent('${enc}'),'off')">${a.status==='off'?'↺':'○'}</button>
             <button class="mini ${a.status==='X'?'on':''}" onclick="setAns('${p.id}',${s},${c},decodeURIComponent('${enc}'),'X')">X</button>
             <button class="mini ${a.status==='XX'?'on':''}" onclick="setAns('${p.id}',${s},${c},decodeURIComponent('${enc}'),'XX')">XX</button>`}
          </div>
          <div class="origins">
            ${[1,2,3].map(n=>`<button class="mini ${(a.origins||[]).includes(n)?'on':''}" ${!['X','XX'].includes(a.status)?'disabled':''} onclick="toggleOrigin('${p.id}',${s},${c},decodeURIComponent('${enc}'),${n})">${n}</button>`).join('')}
          </div>
          ${na?`<span></span>`:`<button class="ideal-btn ${a.ideal?'on':''}" title="Marcar como materia ideal" onclick="toggleIdeal('${p.id}',${s},${c},decodeURIComponent('${enc}'))">★</button>`}
        </div>`;
      });
      html+='</div>';
    });
    html+=`</div><div class="program-save"><button class="save-btn" onclick="saveProgram('${p.id}')">Guardar ${p.name}</button></div></article>`;
  });
  $('programs').innerHTML=html;updateProgress();lockRevisionNav();
}
function saveProgram(pid){persist();toast('Programa educativo guardado.')}
function programStats(p){
  let total=0,done=0;
  p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    if(isEnglish(name))return;
    total++;let a=getAns(p.id,s,c,name);if(a.status!=='pending')done++;
  }));
  return{total,done};
}
function overallStats(){
  let total=0,done=0,invalid=0,pending=[];
  programs().forEach(p=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    if(isEnglish(name))return;
    total++;const a=getAns(p.id,s,c,name);
    if(a.status!=='pending')done++;else pending.push(`${p.name} · ${s+1}.° · ${name}`);
    if(['X','XX'].includes(a.status)&&(!(a.origins||[]).length))invalid++;
  })));
  return{total,done,invalid,pending};
}
function idealCount(){
  const unique=new Set();
  programs().forEach(p=>p.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    const a=getAns(p.id,s,c,name);if(a.ideal)unique.add(name.trim().toUpperCase());
  })));
  return unique.size;
}
function updateProgress(){
  const x=overallStats(),pct=x.total?Math.round(x.done/x.total*100):0;
  $('progressText').textContent=`${x.done} de ${x.total} revisadas (${pct}%)`;
  $('progressBar').style.width=pct+'%';
  $('idealCounter').textContent=`Materias ideales: ${idealCount()} / mínimo 3`;
}
function validateCapture(){
  const x=overallStats(),errs=[];
  if(x.done<x.total)errs.push(`Faltan ${x.total-x.done} asignaturas por revisar.`);
  if(x.invalid)errs.push(`${x.invalid} asignatura(s) tienen X/XX pero no tienen origen del conocimiento.`);
  if(idealCount()<3)errs.push(`Debe seleccionar al menos 3 materias ideales. Actualmente hay ${idealCount()}.`);
  return{ok:!errs.length,errors:errs};
}
function validateAll(){
  const p=validateProfile(),c=validateCapture();
  return{ok:p.ok&&c.ok,errors:[...p.errors,...c.errors]};
}
function showCaptureErrors(errs){
  $('captureErrors').innerHTML=statusBox(errs,'No puede pasar a revisión todavía.');
}
function validateAndReview(){
  collectProfile();persist();
  const v=validateAll();
  if(!v.ok){showCaptureErrors(v.errors);lockRevisionNav();toast('Complete toda la información obligatoria.');return}
  $('captureErrors').innerHTML='';
  $('validation').innerHTML=`<div class="status-box ok"><b>Perfil completo.</b><br>La información ya puede formalizarse e imprimirse.</div>`;
  buildPrint();go('revision',true);
}
function lockRevisionNav(){
  const ok=validateAll().ok;
  $('navRevision').classList.toggle('locked',!ok);
  $('navRevision').title=ok?'Revisión disponible':'Complete toda la captura para habilitar la revisión';
}
function saveAll(show=false){collectProfile();persist();updateProgress();lockRevisionNav();if(show)toast('Perfil completo guardado en este equipo.');}

function quality(){
  return `<table class="quality"><tr><td>${cfg.codigo}</td></tr><tr><td>${cfg.revision}</td></tr><tr><td>Fecha: ${cfg.fechaRevision}</td></tr></table>`;
}
function printHeader(){
  return `<div class="sheetHead">
    <img src="logo-uteq.png" class="print-logo" alt="UTEQ">
    <div class="sheetTitle"><h2>PERFIL DEL PROFESOR</h2><b>DIVISIÓN: INDUSTRIAL</b><br><span>PERIODO DE VIGENCIA: ${cfg.periodo}</span></div>
    ${quality()}
  </div>
  <div class="meta"><b>Nombre del profesor:</b> ${fullName()} &nbsp;&nbsp;&nbsp; <b>Categoría:</b> ${store.profile?.categoria||''}</div>`;
}
function signatures(){
  return `<div class="sign">
    <div class="signature-line">${fullName()}<br>Firma del Profesor</div>
    <div class="stamp-box">SELLO</div>
    <div class="signature-line">${cfg.jefe}<br>Jefe de Unidad de Coordinación Académica</div>
  </div>`;
}
function buildPrint(){
  collectProfile();
  const p=store.profile||{},e=p.extra||{},head=printHeader();
  const fLabels=['Licenciatura o TSU','Posgrado 1','Posgrado 2','Posgrado 3','Posgrado 4','Posgrado 5','Posgrado 6'];
  let pre=`<div class="sheet">${head}
    <table class="profileTable">
      <tr><th colspan="4">1. FORMACIÓN PROFESIONAL</th></tr>
      ${fLabels.map((lab,i)=>`<tr><td style="width:18%"><b>${lab}</b></td><td style="width:36%">${e[`f${i+1}a`]||''}</td><td style="width:14%"><b>Institución</b></td><td>${e[`f${i+1}b`]||''}</td></tr>`).join('')}
      <tr><th colspan="4">2. EXPERIENCIA DOCENTE</th></tr>
      ${Array.from({length:4},(_,i)=>`<tr><td><b>Institución ${i+1}</b></td><td colspan="2">${e[`d${i+1}a`]||''}</td><td><b>Periodo:</b> ${e[`d${i+1}c`]||''}</td></tr>`).join('')}
      <tr><th colspan="4">3. EXPERIENCIA LABORAL</th></tr>
      ${Array.from({length:5},(_,i)=>`<tr><td><b>Organización ${i+1}</b></td><td>${e[`l${i+1}a`]||''}</td><td><b>Cargo:</b> ${e[`l${i+1}b`]||''}</td><td><b>Periodo:</b> ${e[`l${i+1}c`]||''}</td></tr>`).join('')}
    </table>${signatures()}</div>`;

  let pages=programs().map(pr=>{
    const max=Math.max(...pr.semesters.map(s=>s.length));
    const th=pr.semesters.map((s,i)=>`<th colspan="3">${i+1}.° CUATRIMESTRE</th>`).join('');
    const sub=pr.semesters.map(()=>`<th>Asignatura</th><th>Nivel</th><th>Área</th>`).join('');
    let rows='';
    for(let r=0;r<max;r++){
      rows+='<tr>'+pr.semesters.map((sem,s)=>{
        const name=sem[r]||'';if(!name)return '<td></td><td></td><td></td>';
        const a=getAns(pr.id,s,r,name);
        const comp=['X','XX'].includes(a.status)?a.status:'';
        const area=['X','XX'].includes(a.status)?(a.origins||[]).join(''):'';
        return `<td>${name}</td><td>${comp}</td><td>${area}</td>`;
      }).join('')+'</tr>';
    }
    return `<div class="sheet">${head}
      <div class="meta"><b>NIVEL DE COMPETENCIA:</b> X = MEDIO · XX = ALTO &nbsp;&nbsp; <b>ÁREA DEL CONOCIMIENTO:</b> 1 = Formación · 2 = Docencia · 3 = Laboral</div>
      <div class="currTitle">${pr.name.toUpperCase()} · SALIDA LATERAL: ${pr.exit.toUpperCase()}</div>
      <table class="currTable"><tr>${th}</tr><tr>${sub}</tr>${rows}</table>${signatures()}</div>`;
  }).join('');
  $('printArea').innerHTML=pre+pages;
}
function printProfile(){
  const v=validateAll();if(!v.ok){alert('La captura aún no está completa.');go('captura',true);showCaptureErrors(v.errors);return}
  buildPrint();window.print();
}

function saveAdmin(){
  cfg.jefe=$('jefe').value.trim()||cfg.jefe;
  cfg.codigo=$('codigo').value.trim()||cfg.codigo;
  cfg.revision=$('revisionCal').value.trim()||cfg.revision;
  cfg.fechaRevision=$('fechaRevision').value.trim()||cfg.fechaRevision;
  cfg.periodo=$('periodoAdmin').value.trim()||cfg.periodo;
  $('periodo').value=cfg.periodo;persist();toast('Configuración institucional guardada.');
}
function renderAdmin(){
  $('jefe').value=cfg.jefe;$('codigo').value=cfg.codigo;$('revisionCal').value=cfg.revision;
  $('fechaRevision').value=cfg.fechaRevision;$('periodoAdmin').value=cfg.periodo;
  renderSemesterEditors();renderCustomPrograms();renderRules();
}
function renderSemesterEditors(){
  let h='';for(let i=0;i<newSemesterCount;i++)h+=`<div class="semester-editor">
    <div class="semester-editor-head"><b>${i+1}.° cuatrimestre</b>${newSemesterCount>1?`<button onclick="removeSemesterEditor(${i})">Quitar</button>`:''}</div>
    <textarea id="newSem${i}" placeholder="Una asignatura por línea&#10;Ejemplo:&#10;FUNDAMENTOS MATEMÁTICOS&#10;FÍSICA"></textarea>
  </div>`;
  $('newProgramSemesters').innerHTML=h;
}
function addSemesterEditor(){newSemesterCount++;renderSemesterEditors()}
function removeSemesterEditor(i){
  const values=Array.from({length:newSemesterCount},(_,x)=>$(`newSem${x}`)?.value||'');
  values.splice(i,1);newSemesterCount=Math.max(1,newSemesterCount-1);renderSemesterEditors();
  values.forEach((v,x)=>$(`newSem${x}`).value=v);
}
function slug(s){return 'custom_'+s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')+'_'+Date.now()}
function saveNewProgram(){
  const name=$('newProgramName').value.trim(),exit=$('newProgramExit').value.trim();
  const semesters=Array.from({length:newSemesterCount},(_,i)=>($(`newSem${i}`).value||'').split(/\n+/).map(x=>x.trim()).filter(Boolean));
  if(!name||!exit||semesters.some(x=>!x.length)){toast('Capture nombre, salida lateral y al menos una materia en cada cuatrimestre.');return}
  customPrograms.push({id:slug(name),name,exit,common:null,semesters});
  $('newProgramName').value='';$('newProgramExit').value='';newSemesterCount=5;persist();renderAdmin();renderPrograms();toast('Nuevo programa educativo agregado.');
}
function deleteCustomProgram(id){
  if(!confirm('¿Eliminar este programa educativo agregado?'))return;
  customPrograms=customPrograms.filter(p=>p.id!==id);persist();renderAdmin();renderPrograms();
}
function renderCustomPrograms(){
  $('customProgramsList').innerHTML=customPrograms.length?`<h3 style="margin-top:18px">Programas agregados</h3>`+customPrograms.map(p=>`<div class="custom-program-item"><div><b>${p.name}</b><br>${p.exit} · ${p.semesters.length} cuatrimestres</div><button onclick="deleteCustomProgram('${p.id}')">Eliminar</button></div>`).join(''):'';
}
function renderRules(){
  $('commonRules').innerHTML=`<p><b>Ingeniería Industrial:</b> cuatrimestres 1–3 sincronizados exclusivamente entre TSU en Procesos Productivos y TSU en Moldeo de Plásticos.</p>
  <p><b>Ingeniería Mecánica:</b> cuatrimestres 1–3 sincronizados exclusivamente entre TSU en Mecánica Industrial, Mecánica Automotriz y Mecánica Moldes y Troqueles.</p>
  <p><b>Sin tronco común:</b> Ingeniería en Mecánica Automotriz / Diseño y Manufactura Automotriz, Nanotecnología y Mantenimiento Industrial.</p>`;
}
function download(n,t,c){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c],{type:t}));a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function downloadCatalog(){download('catalogo_programas.json','application/json',JSON.stringify(programs(),null,2))}
function exportExcel(){
  if(typeof XLSX==='undefined'){alert('No fue posible cargar el módulo de Excel. Verifique su conexión a internet.');return}
  collectProfile();persist();
  const p=store.profile||{},e=p.extra||{};
  const base=[];
  programs().forEach(pr=>pr.semesters.forEach((sem,s)=>sem.forEach((name,c)=>{
    const a=getAns(pr.id,s,c,name);
    base.push({
      Profesor:fullName(),Categoria:p.categoria||'',Periodo:cfg.periodo,
      Programa:pr.name,'Salida lateral':pr.exit,Cuatrimestre:s+1,Asignatura:name,
      'Estado interno':a.status,'Nivel competencia':['X','XX'].includes(a.status)?a.status:'',
      'Origen 1 Formación':(a.origins||[]).includes(1)?'Sí':'',
      'Origen 2 Docencia':(a.origins||[]).includes(2)?'Sí':'',
      'Origen 3 Laboral':(a.origins||[]).includes(3)?'Sí':'',
      'Materia ideal':a.ideal?'Sí':'',
      'Coordinador de academia':((programMeta[pr.id]||{}).coordinator===`${s}|${c}`)?'Sí':''
    });
  })));
  const resumen=[
    ['Campo','Valor'],['Apellido paterno',p.apPat||''],['Apellido materno',p.apMat||''],['Nombres',p.nombres||''],['Categoría',p.categoria||''],['Periodo de vigencia',cfg.periodo],
    ['Licenciatura o TSU',e.f1a||''],['Institución',e.f1b||''],['Experiencia docente 1',e.d1a||''],['Periodo docente 1',e.d1c||''],
    ['Experiencia laboral 1',e.l1a||''],['Cargo laboral 1',e.l1b||''],['Periodo laboral 1',e.l1c||'']
  ];
  const prefs=base.filter(r=>r['Materia ideal']==='Sí').map(r=>({Programa:r.Programa,Asignatura:r.Asignatura,Cuatrimestre:r.Cuatrimestre}));
  const coords=base.filter(r=>r['Coordinador de academia']==='Sí').map(r=>({Programa:r.Programa,Asignatura:r.Asignatura,Cuatrimestre:r.Cuatrimestre}));
  const catalog=programs().flatMap(pr=>pr.semesters.flatMap((sem,s)=>sem.map(name=>({Programa:pr.name,'Salida lateral':pr.exit,Cuatrimestre:s+1,Asignatura:name}))));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(base),'Base maestra');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(resumen),'Resumen profesor');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(prefs.length?prefs:[{Nota:'Sin materias ideales registradas'}]),'Materias ideales');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(coords.length?coords:[{Nota:'Sin coordinaciones registradas'}]),'Coordinaciones');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(catalog),'Catálogo');
  const safe=fullName().replace(/[^a-záéíóúñ0-9]+/gi,'_')||'perfil_docente';
  XLSX.writeFile(wb,`Base_Maestra_${safe}_${cfg.periodo.replace(/\s+/g,'_')}.xlsx`);
}

function init(){
  loadProfile();
  $('periodo').value=cfg.periodo;
  $('periodo').addEventListener('change',()=>{cfg.periodo=$('periodo').value.trim();persist()});
  renderPrograms();renderAdmin();lockRevisionNav();
}
init();
