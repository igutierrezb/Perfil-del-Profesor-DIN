/*
  Perfil Académico Docente DIN
  Respaldo / restauración integral V3
  2026-09-29

  PRINCIPIOS DE SEGURIDAD
  - El módulo solo se muestra a la cuenta administradora.
  - El respaldo incluye configuración, perfiles completos y auditoría.
  - La restauración nunca borra documentos.
  - Antes de restaurar se descarga automáticamente un respaldo preventivo.
  - Se puede restaurar todo o únicamente profesores seleccionados.
  - Los documentos se restauran por ID original y con merge:true.
*/

import {
  initializeApp,
  getApps,
  getApp
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';

import {
  getAuth,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';

import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  writeBatch,
  addDoc,
  serverTimestamp,
  Timestamp,
  GeoPoint
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const BACKUP_FORMAT = 'PAD_DIN_FIRESTORE_BACKUP';
const BACKUP_VERSION = 3;
const MAX_BATCH_WRITES = 400;

let loadedBackup = null;
let authUnsubscribe = null;

function adminEmail() {
  return String(window.PAD_ADMIN_EMAIL || 'ivan.gutierrez@uteq.edu.mx')
    .trim()
    .toLowerCase();
}

function firebaseConfigured() {
  const c = window.FIREBASE_CONFIG || {};
  return Boolean(c.apiKey && c.projectId && c.appId);
}

function getFirebaseApp() {
  if (!firebaseConfigured()) {
    throw new Error('Firebase no está configurado correctamente.');
  }
  return getApps().length ? getApp() : initializeApp(window.FIREBASE_CONFIG);
}

function currentAdmin() {
  const app = getFirebaseApp();
  const auth = getAuth(app);
  const user = auth.currentUser;
  if (!user) throw new Error('Debe iniciar sesión.');
  const email = String(user.email || '').trim().toLowerCase();
  if (email !== adminEmail()) {
    throw new Error('Esta función está disponible únicamente para Administración.');
  }
  return { app, user };
}

function deepEncode(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(deepEncode);
  if (typeof value !== 'object') return value;

  if (typeof value.toDate === 'function' && typeof value.seconds === 'number') {
    return {
      __firestoreType: 'Timestamp',
      seconds: Number(value.seconds),
      nanoseconds: Number(value.nanoseconds || 0),
      iso: value.toDate().toISOString()
    };
  }

  if (
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    value.constructor?.name === 'GeoPoint'
  ) {
    return {
      __firestoreType: 'GeoPoint',
      latitude: value.latitude,
      longitude: value.longitude
    };
  }

  if (
    typeof value.path === 'string' &&
    value.constructor?.name === 'DocumentReference'
  ) {
    return {
      __firestoreType: 'DocumentReference',
      path: value.path
    };
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = deepEncode(v);
  return out;
}

function deepDecode(value, db) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => deepDecode(v, db));
  if (typeof value !== 'object') return value;

  if (value.__firestoreType === 'Timestamp') {
    if (Number.isFinite(Number(value.seconds))) {
      return new Timestamp(Number(value.seconds), Number(value.nanoseconds || 0));
    }
    if (value.iso) return Timestamp.fromDate(new Date(value.iso));
  }

  if (value.__firestoreType === 'GeoPoint') {
    return new GeoPoint(Number(value.latitude), Number(value.longitude));
  }

  if (value.__firestoreType === 'DocumentReference' && value.path) {
    return doc(db, String(value.path));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = deepDecode(v, db);
  return out;
}

async function readCollection(db, name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => ({
    id: d.id,
    path: d.ref.path,
    data: deepEncode(d.data())
  }));
}

async function readSettings(db) {
  const ref = doc(db, 'settings', 'app');
  const snap = await getDoc(ref);
  return snap.exists()
    ? [{ id: 'app', path: ref.path, data: deepEncode(snap.data()) }]
    : [];
}

function teacherSummary(entry) {
  const d = entry?.data || {};
  const p = d.profile || {};
  const name = [p.apPat, p.apMat, p.nombres]
    .map(x => String(x || '').trim())
    .filter(Boolean)
    .join(' ') || d.displayName || d.email || entry.id;

  return {
    uid: entry.id,
    name,
    email: String(d.email || ''),
    period: String(d.period || d.submittedPeriod || ''),
    submittedPeriod: String(d.submittedPeriod || ''),
    finalizedAtMs: Number(d.finalizedAtMs || 0),
    deletedByAdmin: d.deletedByAdmin === true
  };
}

async function buildBackupData() {
  const { app, user } = currentAdmin();
  const db = getFirestore(app);

  const [settings, profiles, audit] = await Promise.all([
    readSettings(db),
    readCollection(db, 'profiles'),
    readCollection(db, 'audit')
  ]);

  const exportedAt = new Date();

  return {
    backupFormat: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    source: {
      projectId: String(window.FIREBASE_CONFIG?.projectId || ''),
      application: 'Perfil Académico Docente DIN',
      administrator: String(user.email || '')
    },
    summary: {
      settingsDocuments: settings.length,
      profileDocuments: profiles.length,
      auditDocuments: audit.length,
      totalDocuments: settings.length + profiles.length + audit.length
    },
    manifest: {
      teachers: profiles.map(teacherSummary)
    },
    collections: {
      settings,
      profiles,
      audit
    }
  };
}

function safeStamp(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

function downloadJson(data, filename) {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: 'application/json;charset=utf-8' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function setStatus(message, kind = '') {
  const el = document.getElementById('backupRestoreStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
}

function setBusy(busy) {
  ['btnFullBackup','btnRestoreSelected','btnRestoreAll'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  });
}

window.exportFullBackup = async function exportFullBackup() {
  try {
    setBusy(true);
    setStatus('Preparando respaldo integral…', 'working');
    const backup = await buildBackupData();
    downloadJson(backup, `respaldo-perfil-din_${safeStamp()}.json`);
    setStatus(
      `Respaldo completo generado: ${backup.summary.profileDocuments} perfiles, ` +
      `${backup.summary.settingsDocuments} configuración y ` +
      `${backup.summary.auditDocuments} registros de auditoría.`,
      'ok'
    );
  } catch (e) {
    console.error(e);
    setStatus(e?.message || 'No fue posible generar el respaldo.', 'error');
    alert(e?.message || 'No fue posible generar el respaldo.');
  } finally {
    setBusy(false);
  }
};

function validateBackup(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('El archivo no contiene un respaldo válido.');
  }
  if (data.backupFormat !== BACKUP_FORMAT) {
    throw new Error('El archivo no corresponde a un respaldo de Perfil DIN.');
  }
  const currentProject = String(window.FIREBASE_CONFIG?.projectId || '');
  const sourceProject = String(data.source?.projectId || '');
  if (!sourceProject || sourceProject !== currentProject) {
    throw new Error(
      `El respaldo pertenece a otro proyecto (${sourceProject || 'sin identificar'}). ` +
      `Proyecto actual: ${currentProject}.`
    );
  }
  if (!Array.isArray(data.collections?.profiles)) {
    throw new Error('El respaldo no contiene la colección de perfiles.');
  }
  return true;
}

function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function renderBackupPreview(data) {
  const root = document.getElementById('restorePreview');
  if (!root) return;

  const teachers = Array.isArray(data.manifest?.teachers)
    ? data.manifest.teachers
    : (data.collections?.profiles || []).map(teacherSummary);

  root.innerHTML = `
    <div class="restore-summary">
      <strong>Respaldo válido</strong>
      <span>${escapeHtml(new Date(data.exportedAt).toLocaleString('es-MX'))}</span>
      <span>${teachers.length} perfiles</span>
    </div>

    <div class="restore-options-row">
      <label>
        <input id="restoreSettings" type="checkbox">
        Restaurar configuración institucional
      </label>
      <label>
        <input id="restoreAudit" type="checkbox">
        Restaurar auditoría incluida
      </label>
    </div>

    <div class="restore-select-tools">
      <button type="button" id="selectAllRestoreProfiles">Seleccionar todos</button>
      <button type="button" id="clearRestoreProfiles">Quitar selección</button>
    </div>

    <div class="restore-teacher-list">
      ${teachers.map(t => `
        <label class="restore-teacher-row ${t.deletedByAdmin ? 'is-deleted' : ''}">
          <input type="checkbox"
                 class="restore-profile-check"
                 value="${escapeHtml(t.uid)}"
                 ${t.deletedByAdmin ? '' : 'checked'}>
          <span>
            <strong>${escapeHtml(t.name)}</strong>
            <small>${escapeHtml(t.email || t.uid)}</small>
          </span>
          <em>${t.deletedByAdmin ? 'Marcado como eliminado en el respaldo' : escapeHtml(t.submittedPeriod || t.period || 'Perfil guardado')}</em>
        </label>
      `).join('')}
    </div>

    <div class="restore-warning">
      La restauración es <b>no destructiva</b>: repone los documentos seleccionados
      usando sus IDs originales, pero no elimina documentos adicionales existentes.
      Antes de escribir cualquier dato se descargará automáticamente un respaldo preventivo.
    </div>

    <div class="restore-actions">
      <button id="btnRestoreSelected" type="button" class="restore-selected-btn">
        Restaurar profesores seleccionados
      </button>
      <button id="btnRestoreAll" type="button" class="restore-all-btn">
        Restaurar todo el respaldo
      </button>
    </div>
  `;

  document.getElementById('selectAllRestoreProfiles')?.addEventListener('click', () => {
    root.querySelectorAll('.restore-profile-check').forEach(x => x.checked = true);
  });
  document.getElementById('clearRestoreProfiles')?.addEventListener('click', () => {
    root.querySelectorAll('.restore-profile-check').forEach(x => x.checked = false);
  });
  document.getElementById('btnRestoreSelected')?.addEventListener('click', () => restoreFromLoadedBackup(false));
  document.getElementById('btnRestoreAll')?.addEventListener('click', () => restoreFromLoadedBackup(true));
}

async function loadBackupFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  validateBackup(data);
  loadedBackup = data;
  renderBackupPreview(data);
  setStatus(
    `Respaldo cargado correctamente: ${data.collections.profiles.length} perfiles disponibles para restauración.`,
    'ok'
  );
}

async function commitInBatches(db, writes) {
  let index = 0;
  while (index < writes.length) {
    const group = writes.slice(index, index + MAX_BATCH_WRITES);
    const batch = writeBatch(db);
    group.forEach(item => {
      batch.set(item.ref, item.data, { merge: true });
    });
    await batch.commit();
    index += group.length;
  }
}

async function restoreFromLoadedBackup(all) {
  if (!loadedBackup) {
    alert('Primero seleccione un archivo de respaldo.');
    return;
  }

  try {
    setBusy(true);
    validateBackup(loadedBackup);

    const { app, user } = currentAdmin();
    const db = getFirestore(app);

    const selected = all
      ? new Set((loadedBackup.collections.profiles || []).map(x => x.id))
      : new Set(
          [...document.querySelectorAll('.restore-profile-check:checked')]
            .map(x => x.value)
        );

    const restoreSettings = all || !!document.getElementById('restoreSettings')?.checked;
    const restoreAudit = all || !!document.getElementById('restoreAudit')?.checked;

    if (!selected.size && !restoreSettings && !restoreAudit) {
      throw new Error('No ha seleccionado información para restaurar.');
    }

    const summary = [
      `${selected.size} perfil(es)`,
      restoreSettings ? 'configuración institucional' : null,
      restoreAudit ? 'auditoría' : null
    ].filter(Boolean).join(', ');

    const typed = prompt(
      `Se restaurará: ${summary}.\n\n` +
      `Antes de continuar se descargará un respaldo preventivo del estado ACTUAL.\n` +
      `La operación no elimina documentos existentes.\n\n` +
      `Escriba RESTAURAR para confirmar:`
    );

    if (typed !== 'RESTAURAR') {
      setStatus('Restauración cancelada. No se modificó información.', '');
      return;
    }

    setStatus('Generando respaldo preventivo antes de restaurar…', 'working');
    const emergency = await buildBackupData();
    downloadJson(
      emergency,
      `PRE-RESTAURACION_perfil-din_${safeStamp()}.json`
    );

    // Se deja un breve margen para que el navegador inicie la descarga preventiva.
    await new Promise(resolve => setTimeout(resolve, 700));

    setStatus('Restaurando documentos seleccionados…', 'working');

    const writes = [];

    for (const entry of loadedBackup.collections.profiles || []) {
      if (!selected.has(entry.id)) continue;
      writes.push({
        ref: doc(db, 'profiles', entry.id),
        data: deepDecode(entry.data, db)
      });
    }

    if (restoreSettings) {
      for (const entry of loadedBackup.collections.settings || []) {
        writes.push({
          ref: doc(db, 'settings', entry.id || 'app'),
          data: deepDecode(entry.data, db)
        });
      }
    }

    if (restoreAudit) {
      for (const entry of loadedBackup.collections.audit || []) {
        writes.push({
          ref: doc(db, 'audit', entry.id),
          data: deepDecode(entry.data, db)
        });
      }
    }

    await commitInBatches(db, writes);

    await addDoc(collection(db, 'audit'), {
      action: all
        ? 'Restauración integral desde respaldo'
        : `Restauración selectiva de ${selected.size} perfil(es) desde respaldo`,
      email: String(user.email || ''),
      uid: user.uid,
      at: serverTimestamp(),
      period: '',
      backupExportedAt: String(loadedBackup.exportedAt || '')
    });

    setStatus(
      `Restauración concluida correctamente: ${summary}. ` +
      `Se generó un respaldo preventivo antes de la operación.`,
      'ok'
    );

    alert(
      'Restauración concluida correctamente.\n\n' +
      'Se descargó un respaldo preventivo antes de modificar Firestore.'
    );
  } catch (e) {
    console.error(e);
    setStatus(e?.message || 'No fue posible restaurar el respaldo.', 'error');
    alert(e?.message || 'No fue posible restaurar el respaldo.');
  } finally {
    setBusy(false);
  }
}

function installStyles() {
  if (document.getElementById('backupRestoreStyles')) return;
  const style = document.createElement('style');
  style.id = 'backupRestoreStyles';
  style.textContent = `
    #admin .admin-core-grid {
      align-items: stretch;
    }

    @media (min-width: 1180px) {
      #admin .admin-core-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
      }
      #excelExportCard { order: 1; }
      #captureControlCard { order: 2; }
      #backupRestoreCard { order: 3; }
      #institutionalConfig { order: 4; }
    }

    #backupRestoreCard {
      min-width: 0;
    }

    #backupRestoreCard .backup-admin-badge {
      display:inline-flex;
      align-items:center;
      justify-content:center;
      padding:4px 10px;
      border-radius:999px;
      background:#e4f3ff;
      color:#0b4e79;
      font-size:.72rem;
      font-weight:800;
      white-space:nowrap;
    }

    #backupRestoreCard .backup-intro {
      margin:8px 0 10px;
      padding:9px 10px;
      border:1px solid #d6e5f0;
      border-radius:10px;
      background:#f1f7fb;
      font-size:.82rem;
      line-height:1.35;
    }

    #backupRestoreCard .backup-main-actions {
      display:grid;
      grid-template-columns:1fr;
      gap:8px;
      margin-top:10px;
    }

    #btnFullBackup,
    #backupFileLabel {
      border:0;
      border-radius:10px;
      padding:10px 11px;
      font-weight:800;
      text-align:center;
      cursor:pointer;
    }

    #btnFullBackup {
      background:#0b5c8f;
      color:#fff;
    }

    #backupFileLabel {
      display:block;
      background:#fff;
      color:#0b4e79;
      border:1px solid #92b8d2;
    }

    #backupFileInput {
      display:none;
    }

    #backupRestoreStatus {
      margin-top:9px;
      min-height:38px;
      padding:8px 10px;
      border-radius:9px;
      border:1px solid #d9e3eb;
      background:#fff;
      font-size:.78rem;
      line-height:1.35;
    }

    #backupRestoreStatus[data-kind="ok"] {
      background:#edf8f0;
      border-color:#b9dfc4;
      color:#165c32;
    }

    #backupRestoreStatus[data-kind="error"] {
      background:#fff1ee;
      border-color:#efc3b8;
      color:#8b2d1e;
    }

    #backupRestoreStatus[data-kind="working"] {
      background:#eef6ff;
      border-color:#c9dcf2;
      color:#164e7c;
    }

    #restorePreview {
      margin-top:12px;
    }

    .restore-summary {
      display:flex;
      flex-wrap:wrap;
      gap:7px 10px;
      align-items:center;
      padding:9px 10px;
      border-radius:10px;
      background:#eef6fb;
      font-size:.78rem;
    }

    .restore-options-row {
      display:grid;
      gap:6px;
      margin-top:9px;
      font-size:.78rem;
    }

    .restore-select-tools {
      display:flex;
      gap:6px;
      margin-top:9px;
    }

    .restore-select-tools button {
      padding:6px 8px;
      border-radius:8px;
      border:1px solid #b8ccd9;
      background:#fff;
      cursor:pointer;
      font-size:.74rem;
    }

    .restore-teacher-list {
      max-height:230px;
      overflow:auto;
      margin-top:8px;
      border:1px solid #d9e4eb;
      border-radius:10px;
      background:#fff;
    }

    .restore-teacher-row {
      display:grid;
      grid-template-columns:auto minmax(0,1fr);
      gap:8px;
      padding:8px 9px;
      border-bottom:1px solid #edf1f4;
      cursor:pointer;
    }

    .restore-teacher-row:last-child {
      border-bottom:0;
    }

    .restore-teacher-row span {
      min-width:0;
    }

    .restore-teacher-row strong,
    .restore-teacher-row small,
    .restore-teacher-row em {
      display:block;
      overflow:hidden;
      text-overflow:ellipsis;
    }

    .restore-teacher-row small {
      color:#536b7d;
      margin-top:2px;
    }

    .restore-teacher-row em {
      grid-column:2;
      color:#6c7c88;
      font-size:.68rem;
      font-style:normal;
    }

    .restore-teacher-row.is-deleted {
      opacity:.65;
    }

    .restore-warning {
      margin-top:9px;
      padding:8px 9px;
      border-radius:9px;
      border:1px solid #f0d3a0;
      background:#fff9ee;
      font-size:.74rem;
      line-height:1.35;
    }

    .restore-actions {
      display:grid;
      gap:7px;
      margin-top:9px;
    }

    .restore-actions button {
      border-radius:9px;
      padding:9px 10px;
      font-weight:800;
      cursor:pointer;
    }

    .restore-selected-btn {
      border:1px solid #8fb8d3;
      background:#fff;
      color:#0b4e79;
    }

    .restore-all-btn {
      border:1px solid #b73729;
      background:#fff1ee;
      color:#8b2d1e;
    }

    #commissionsBlock .required-note {
      white-space:normal;
    }

    @media (max-width:1179px) {
      #backupRestoreCard {
        grid-column:1 / -1;
      }
    }
  `;
  document.head.appendChild(style);
}

function buildCard() {
  const card = document.createElement('section');
  card.id = 'backupRestoreCard';
  card.className = 'card admin-core-card';
  card.innerHTML = `
    <div class="admin-core-head">
      <div>
        <h2>Respaldo y restauración</h2>
        <p>Copia integral y recuperación segura de perfiles.</p>
      </div>
      <span class="backup-admin-badge">JSON</span>
    </div>

    <div class="backup-intro">
      El respaldo incluye <b>toda la información capturada por los profesores</b>,
      configuración institucional y auditoría.
    </div>

    <div class="backup-main-actions">
      <button id="btnFullBackup" type="button">
        ↓ Descargar respaldo completo
      </button>

      <label id="backupFileLabel" for="backupFileInput">
        ↑ Cargar archivo de respaldo
      </label>
      <input id="backupFileInput" type="file" accept=".json,application/json">
    </div>

    <div id="backupRestoreStatus">
      Sin operación de respaldo en esta sesión.
    </div>

    <div id="restorePreview"></div>
  `;
  return card;
}

function keepCommissionsAlwaysAvailable() {
  // Cambio únicamente visual / preventivo:
  // la lógica principal V64 debe fijar planningEnabled() = true.
  const block = document.getElementById('commissionsBlock');
  if (block) {
    block.classList.remove('hidden');
    block.style.display = '';
    const note = block.querySelector('.required-note');
    if (note) note.textContent = 'Opcional · referencia para planeación';
  }

  // Ya no se necesita la tarjeta de encendido/apagado en Administración.
  document.getElementById('commissionsAdminCard')?.remove();

  // Si cambia el periodo, cualquier pregunta antigua de "habilitar Comisiones"
  // debe responderse afirmativamente para mantener coherencia.
  if (typeof window.saveAdmin === 'function' && !window.__PAD_SAVE_ADMIN_WRAPPED) {
    const original = window.saveAdmin;
    window.saveAdmin = function(...args) {
      const nativeConfirm = window.confirm;
      try {
        window.confirm = function(message) {
          if (
            String(message || '').includes('apartado 4 de Comisiones') &&
            String(message || '').includes('¿Desea habilitar')
          ) return true;
          return nativeConfirm.call(window, message);
        };
        return original.apply(this, args);
      } finally {
        window.confirm = nativeConfirm;
      }
    };
    window.__PAD_SAVE_ADMIN_WRAPPED = true;
  }
}

function renderAdminModuleFor(user) {
  const admin = document.getElementById('admin');
  if (!admin) return;

  const email = String(user?.email || '').trim().toLowerCase();
  const allowed = !!user && email === adminEmail();

  document.getElementById('backupRestoreCard')?.remove();

  keepCommissionsAlwaysAvailable();

  if (!allowed) return;

  const grid = admin.querySelector('.admin-core-grid');
  if (!grid) return;

  const card = buildCard();
  grid.appendChild(card);

  document.getElementById('btnFullBackup')?.addEventListener('click', window.exportFullBackup);
  document.getElementById('backupFileInput')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setStatus('Validando archivo de respaldo…', 'working');
      await loadBackupFile(file);
    } catch (err) {
      console.error(err);
      loadedBackup = null;
      document.getElementById('restorePreview').innerHTML = '';
      setStatus(err?.message || 'Archivo de respaldo no válido.', 'error');
      alert(err?.message || 'Archivo de respaldo no válido.');
    }
  });
}

function boot() {
  installStyles();

  const app = getFirebaseApp();
  const auth = getAuth(app);

  if (authUnsubscribe) authUnsubscribe();
  authUnsubscribe = onAuthStateChanged(auth, user => {
    // Se espera un instante a que app.js termine su render.
    setTimeout(() => renderAdminModuleFor(user), 120);
  });

  // Defensa ante renderizaciones posteriores de la vista administrativa.
  const observer = new MutationObserver(() => {
    const user = auth.currentUser;
    if (user && String(user.email || '').toLowerCase() === adminEmail()) {
      if (!document.getElementById('backupRestoreCard')) {
        renderAdminModuleFor(user);
      }
    } else {
      document.getElementById('backupRestoreCard')?.remove();
    }
    keepCommissionsAlwaysAvailable();
  });

  const admin = document.getElementById('admin');
  if (admin) {
    observer.observe(admin, { childList: true, subtree: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
