/*
  Perfil Académico Docente DIN
  Respaldo integral V2
  2026-09-29

  OBJETIVO
  - Agregar el módulo de respaldo sin tocar app.js ni la lógica existente.
  - Insertar la tarjeta de respaldo debajo del cuadro de Comisiones en escritorio.
  - Mantener una implementación solo de lectura (no escribe, no borra, no restaura).
*/

import {
  initializeApp,
  getApps,
  getApp
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';

import { getAuth } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';

import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const BACKUP_VERSION = 2;

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

function requireAdmin() {
  const app = getFirebaseApp();
  const auth = getAuth(app);
  const user = auth.currentUser;

  if (!user) {
    throw new Error('Debe iniciar sesión antes de generar el respaldo.');
  }

  const email = String(user.email || '').trim().toLowerCase();
  if (email !== adminEmail()) {
    throw new Error('Solo la cuenta administradora puede generar el respaldo completo.');
  }

  return { app, user };
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(encodeFirestoreValue);
  if (typeof value !== 'object') return value;

  if (typeof value.toDate === 'function' && typeof value.seconds === 'number') {
    return {
      __firestoreType: 'Timestamp',
      seconds: value.seconds,
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

  if (typeof value.path === 'string' && value.constructor?.name === 'DocumentReference') {
    return {
      __firestoreType: 'DocumentReference',
      path: value.path
    };
  }

  const result = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = encodeFirestoreValue(v);
  }
  return result;
}

async function exportCollection(db, collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs.map(d => ({
    id: d.id,
    path: d.ref.path,
    data: encodeFirestoreValue(d.data())
  }));
}

async function exportSettings(db) {
  const ref = doc(db, 'settings', 'app');
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  return [{
    id: snap.id,
    path: ref.path,
    data: encodeFirestoreValue(snap.data())
  }];
}

function safeTimestampForFileName(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-') +
    '_' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('-');
}

function downloadJson(data, filename) {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
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

function setBackupStatus(message, kind = '') {
  const el = document.getElementById('backupStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
}

function setBackupButtonBusy(busy) {
  const btn = document.getElementById('btnFullBackup');
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy
    ? 'Generando respaldo…'
    : 'Descargar respaldo completo (.json)';
}

window.exportFullBackup = async function exportFullBackup() {
  try {
    setBackupButtonBusy(true);
    setBackupStatus('Leyendo configuración, perfiles y auditoría…', 'working');

    const { app, user } = requireAdmin();
    const db = getFirestore(app);

    const [settings, profiles, audit] = await Promise.all([
      exportSettings(db),
      exportCollection(db, 'profiles'),
      exportCollection(db, 'audit')
    ]);

    const exportedAt = new Date();
    const backup = {
      backupFormat: 'PAD_DIN_FIRESTORE_BACKUP',
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
      collections: { settings, profiles, audit }
    };

    const filename = `respaldo-perfil-din_${safeTimestampForFileName(exportedAt)}.json`;
    downloadJson(backup, filename);

    setBackupStatus(
      `Respaldo generado correctamente: ${backup.summary.profileDocuments} perfiles, ` +
      `${backup.summary.settingsDocuments} configuración y ${backup.summary.auditDocuments} registros de auditoría.`,
      'ok'
    );
  } catch (error) {
    console.error('No fue posible generar el respaldo integral', error);
    setBackupStatus(error?.message || 'No fue posible generar el respaldo.', 'error');
    alert(error?.message || 'No fue posible generar el respaldo.');
  } finally {
    setBackupButtonBusy(false);
  }
};

function installBackupStyles() {
  if (document.getElementById('backupModuleStyles')) return;

  const style = document.createElement('style');
  style.id = 'backupModuleStyles';
  style.textContent = `
    #backupAdminCard {
      border-radius: 22px;
      border: 1px solid #bcd0e0;
      background: #f7fbff;
      padding: 14px;
      box-sizing: border-box;
      min-width: 0;
    }

    #backupAdminCard h2 {
      margin: 0 0 6px 0;
      font-size: 1.25rem;
      line-height: 1.2;
      color: #14385b;
    }

    #backupAdminCard p {
      margin: 0;
      color: #42627a;
    }

    #backupAdminCard .backup-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }

    #backupAdminCard .backup-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 52px;
      height: 30px;
      padding: 0 12px;
      border-radius: 999px;
      background: #dff4e7;
      color: #175a33;
      font-weight: 800;
      font-size: .74rem;
      white-space: nowrap;
    }

    #backupAdminCard .backup-note {
      border: 1px solid #d7e4ef;
      background: #eef6fc;
      color: #294861;
      border-radius: 12px;
      padding: 10px 12px;
      margin-bottom: 12px;
      font-size: .93rem;
      line-height: 1.35;
    }

    #backupAdminCard .backup-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    #btnFullBackup {
      appearance: none;
      border: none;
      border-radius: 12px;
      padding: 12px 16px;
      background: linear-gradient(180deg, #0d5b8f 0%, #083f65 100%);
      color: #fff;
      font-weight: 800;
      cursor: pointer;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.12);
    }

    #btnFullBackup[disabled] {
      opacity: .75;
      cursor: wait;
    }

    #backupStatus {
      border: 1px solid #d7e4ef;
      border-radius: 12px;
      background: #ffffff;
      color: #35516a;
      padding: 11px 12px;
      min-height: 48px;
      line-height: 1.35;
    }

    #backupStatus[data-kind="ok"] {
      background: #eaf8ef;
      border-color: #b6e0c3;
      color: #145a31;
    }

    #backupStatus[data-kind="error"] {
      background: #fff3f0;
      border-color: #efc5ba;
      color: #8a2f20;
    }

    #backupStatus[data-kind="working"] {
      background: #eef6ff;
      border-color: #cfe1f6;
      color: #174c7a;
    }

    @media (min-width: 1200px) {
      .backup-commissions-compact {
        grid-column: 3 / 4 !important;
      }
      #backupAdminCard.backup-under-commissions {
        grid-column: 3 / 4 !important;
      }
    }

    @media (max-width: 1199.98px) {
      #backupAdminCard {
        grid-column: 1 / -1 !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function getText(node) {
  return String(node?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findCommissionCard() {
  const candidates = [...document.querySelectorAll('section, article, div.card, .card, .panel')];

  for (const el of candidates) {
    const txt = getText(el);
    if (txt.includes('comisiones') && (txt.includes('habilita') || txt.includes('deshabilitar apartado de comisiones'))) {
      return el;
    }
  }

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,strong')];
  for (const h of headings) {
    const txt = getText(h);
    if (txt === 'comisiones' || txt.includes('comisiones')) {
      return h.closest('section, article, .card, .panel, div') || null;
    }
  }

  return null;
}

function findAdminGrid() {
  const commissionCard = findCommissionCard();
  if (!commissionCard) return null;

  let parent = commissionCard.parentElement;
  while (parent && parent !== document.body) {
    if (parent.children && parent.children.length >= 2) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function buildBackupCard() {
  const card = document.createElement('section');
  card.id = 'backupAdminCard';
  card.className = 'backup-under-commissions';
  card.innerHTML = `
    <div class="backup-head">
      <div>
        <h2>Respaldo integral</h2>
        <p>Descarga una copia externa de configuración, perfiles y auditoría almacenados en Firestore.</p>
      </div>
      <span class="backup-badge">JSON</span>
    </div>

    <div class="backup-note">
      Este proceso es <b>solo de lectura</b>: no modifica, borra ni reemplaza la información capturada.
    </div>

    <div class="backup-actions">
      <button id="btnFullBackup" type="button" onclick="exportFullBackup()">
        Descargar respaldo completo (.json)
      </button>
    </div>

    <div id="backupStatus">
      Aún no se ha generado un respaldo en esta sesión.
    </div>
  `;
  return card;
}

function injectBackupPanel() {
  if (document.getElementById('backupAdminCard')) return;

  installBackupStyles();

  const commissionCard = findCommissionCard();
  const grid = findAdminGrid();

  if (!commissionCard || !grid) {
    console.warn('No se encontró el contenedor esperado para insertar el módulo de respaldo.');
    return;
  }

  commissionCard.classList.add('backup-commissions-compact');

  const backupCard = buildBackupCard();

  if (commissionCard.nextSibling) {
    grid.insertBefore(backupCard, commissionCard.nextSibling);
  } else {
    grid.appendChild(backupCard);
  }
}

function bootBackupModule() {
  injectBackupPanel();
  // Reintento defensivo por si la vista administrativa se renderiza unos ms después.
  setTimeout(() => {
    if (!document.getElementById('backupAdminCard')) {
      injectBackupPanel();
    }
  }, 700);
  setTimeout(() => {
    if (!document.getElementById('backupAdminCard')) {
      injectBackupPanel();
    }
  }, 1800);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootBackupModule);
} else {
  bootBackupModule();
}
