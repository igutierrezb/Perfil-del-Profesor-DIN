/*
  Perfil Académico Docente DIN
  Módulo de respaldo integral V1
  Fecha: 2026-09-29

  IMPORTANTE:
  - Este módulo SOLO LEE Firestore.
  - No crea, modifica ni elimina documentos.
  - Solo permite exportar el respaldo a la cuenta administradora.
  - El archivo generado conserva IDs de documentos y tipos especiales
    de Firestore (Timestamp, GeoPoint y DocumentReference) mediante etiquetas.
*/

import {
  initializeApp,
  getApps,
  getApp
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';

import {
  getAuth
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';

import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const BACKUP_VERSION = 1;

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

  if (Array.isArray(value)) {
    return value.map(encodeFirestoreValue);
  }

  if (typeof value !== 'object') {
    return value;
  }

  // Timestamp de Firestore
  if (
    typeof value.toDate === 'function' &&
    typeof value.seconds === 'number'
  ) {
    return {
      __firestoreType: 'Timestamp',
      seconds: value.seconds,
      nanoseconds: Number(value.nanoseconds || 0),
      iso: value.toDate().toISOString()
    };
  }

  // GeoPoint
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

  // DocumentReference
  if (
    typeof value.path === 'string' &&
    value.constructor?.name === 'DocumentReference'
  ) {
    return {
      __firestoreType: 'DocumentReference',
      path: value.path
    };
  }

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = encodeFirestoreValue(child);
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

  if (!snap.exists()) {
    return [];
  }

  return [{
    id: snap.id,
    path: ref.path,
    data: encodeFirestoreValue(snap.data())
  }];
}

function safeTimestampForFileName(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + '_' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('-');
}

function downloadJson(data, filename) {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], {
    type: 'application/json;charset=utf-8'
  });

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
  const btn = document.getElementById('btnFullBackup');

  try {
    setBackupButtonBusy(true);
    setBackupStatus('Leyendo configuración y perfiles…', 'working');

    const { app, user } = requireAdmin();
    const db = getFirestore(app);

    // Lectura únicamente. No hay setDoc, addDoc, updateDoc ni deleteDoc.
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
      collections: {
        settings,
        profiles,
        audit
      }
    };

    const filename =
      `respaldo-perfil-din_${safeTimestampForFileName(exportedAt)}.json`;

    downloadJson(backup, filename);

    setBackupStatus(
      `Respaldo generado: ${backup.summary.profileDocuments} perfiles, ` +
      `${backup.summary.settingsDocuments} configuración y ` +
      `${backup.summary.auditDocuments} registros de auditoría.`,
      'ok'
    );
  } catch (error) {
    console.error('No fue posible generar el respaldo integral', error);
    setBackupStatus(
      error?.message || 'No fue posible generar el respaldo.',
      'error'
    );
    alert(error?.message || 'No fue posible generar el respaldo.');
  } finally {
    setBackupButtonBusy(false);
  }
};

function injectBackupPanel() {
  // El panel se inserta dentro del área de Administración.
  // Si no existe esa sección, no modifica nada.
  const admin = document.getElementById('admin');
  if (!admin || document.getElementById('backupAdminCard')) return;

  const anchor =
    document.getElementById('excelExportCard') ||
    admin.querySelector('.admin-core-grid');

  if (!anchor) return;

  const card = document.createElement('section');
  card.id = 'backupAdminCard';
  card.className = 'card admin-core-card';
  card.innerHTML = `
    <div class="admin-core-head">
      <div>
        <h2>Respaldo integral</h2>
        <p>Descarga una copia externa de configuración, perfiles y auditoría almacenados en Firestore.</p>
      </div>
      <span class="excel-admin-badge">JSON</span>
    </div>

    <div class="period-preserve-note">
      Este proceso es <b>solo de lectura</b>: no modifica, borra ni reemplaza información capturada.
    </div>

    <div class="mini-actions admin-core-actions">
      <button
        id="btnFullBackup"
        type="button"
        class="primary"
        onclick="exportFullBackup()">
        Descargar respaldo completo (.json)
      </button>
    </div>

    <div id="backupStatus" class="deadline-admin-preview">
      Aún no se ha generado un respaldo en esta sesión.
    </div>
  `;

  anchor.insertAdjacentElement('afterend', card);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectBackupPanel);
} else {
  injectBackupPanel();
}
