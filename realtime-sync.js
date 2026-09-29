/*
  Perfil Académico Docente DIN
  Puente de sincronización multidispositivo V1
  2026-09-29

  OBJETIVO
  - Reflejar cambios guardados en móvil/escritorio casi en tiempo real.
  - No sobrescribir cambios locales pendientes.
  - No recargar mientras el usuario está escribiendo.
  - La versión con mayor dataRevision/clientUpdatedAt prevalece.
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
  doc,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

let unsubscribeProfile = null;
let pendingRemote = null;
let applyTimer = null;
let lastAppliedRevision = 0;
let lastAppliedUpdatedAt = 0;

function configured() {
  const c = window.FIREBASE_CONFIG || {};
  return !!(c.apiKey && c.projectId && c.appId);
}

function getAppSafe() {
  if (!configured()) return null;
  return getApps().length ? getApp() : initializeApp(window.FIREBASE_CONFIG);
}

function readWorkStore() {
  try {
    return JSON.parse(localStorage.getItem('PAD_UTEQ') || '{}');
  } catch (_) {
    return {};
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (Number.isFinite(value.seconds)) {
    return Number(value.seconds) * 1000 +
      Math.floor((Number(value.nanoseconds) || 0) / 1e6);
  }
  return 0;
}

function activeEditor() {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el.matches?.('input, textarea, select, [contenteditable="true"]') ||
    !!el.closest?.('input, textarea, select, [contenteditable="true"]')
  );
}

function ensureSyncNotice() {
  let el = document.getElementById('multiDeviceSyncNotice');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'multiDeviceSyncNotice';
  el.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'z-index:99999',
    'max-width:340px',
    'padding:11px 14px',
    'border-radius:12px',
    'background:#0b4e79',
    'color:#fff',
    'font:600 13px/1.35 system-ui,sans-serif',
    'box-shadow:0 10px 28px rgba(0,0,0,.18)',
    'display:none'
  ].join(';');
  document.body.appendChild(el);
  return el;
}

function showNotice(text) {
  const el = ensureSyncNotice();
  el.textContent = text;
  el.style.display = 'block';
}

function hideNotice() {
  const el = document.getElementById('multiDeviceSyncNotice');
  if (el) el.style.display = 'none';
}

function remoteVersion(d) {
  return {
    revision: Number(d?.dataRevision || 0),
    updatedAt: Number(d?.clientUpdatedAt || 0) || timestampToMs(d?.updatedAt)
  };
}

function localVersion() {
  const s = readWorkStore();
  return {
    revision: Number(s.dataRevision || 0),
    updatedAt: Number(s.localUpdatedAt || s.lastSavedAt || 0),
    pending: !!s.syncPending
  };
}

function remoteIsNewer(d) {
  const r = remoteVersion(d);
  const l = localVersion();

  if (l.pending) return false;

  if (r.revision > 0 && l.revision > 0) {
    return r.revision > l.revision;
  }
  return r.updatedAt > l.updatedAt + 250;
}

function mergeRemoteIntoLocal(d, uid) {
  const current = readWorkStore();
  const v = remoteVersion(d);

  const next = {
    ...current,
    profile: d.profile || {},
    answers: d.answers || {},
    programMeta: d.programMeta || {},
    planningByPeriod:
      d.planningByPeriod && typeof d.planningByPeriod === 'object'
        ? d.planningByPeriod
        : (current.planningByPeriod || {}),
    submittedPeriod: d.submittedPeriod || null,
    finalizedAtMs: Number(d.finalizedAtMs || 0) || null,
    individualEditEnabled: !!d.individualEditEnabled,
    individualEditDisabled: !!d.individualEditDisabled,
    profileResetToken: d.profileResetToken || null,
    profileDeletionToken: d.profileDeletionToken || null,
    localUpdatedAt: v.updatedAt || Date.now(),
    cloudUpdatedAt: v.updatedAt || Date.now(),
    dataRevision: v.revision || Number(current.dataRevision || 0),
    syncPending: false,
    lastSavedAt: v.updatedAt || Date.now()
  };

  writeJson('PAD_UTEQ', next);

  // Mantener también el respaldo persistente del mismo UID.
  writeJson(`PAD_UTEQ_PROFILE_${uid}`, {
    profile: next.profile,
    answers: next.answers,
    programMeta: next.programMeta,
    planningByPeriod: next.planningByPeriod,
    submittedPeriod: next.submittedPeriod,
    finalizedAtMs: next.finalizedAtMs,
    profileResetToken: next.profileResetToken,
    profileDeletionToken: next.profileDeletionToken,
    currentProgramIndex: Number(next.currentProgramIndex || 0),
    localUpdatedAt: next.localUpdatedAt,
    cloudUpdatedAt: next.cloudUpdatedAt,
    syncPending: false,
    dataRevision: next.dataRevision,
    savedAt: Date.now()
  });

  lastAppliedRevision = v.revision;
  lastAppliedUpdatedAt = v.updatedAt;
}

function applyPendingWhenSafe(uid) {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(() => {
    if (!pendingRemote) return;

    if (activeEditor()) {
      showNotice(
        'Hay cambios nuevos de otro dispositivo. Se aplicarán al terminar de editar este campo.'
      );
      applyPendingWhenSafe(uid);
      return;
    }

    const d = pendingRemote;
    pendingRemote = null;

    if (!remoteIsNewer(d)) {
      hideNotice();
      return;
    }

    showNotice('Cambios recibidos de otro dispositivo. Actualizando…');
    mergeRemoteIntoLocal(d, uid);

    setTimeout(() => {
      location.reload();
    }, 450);
  }, 650);
}

function startProfileListener(user) {
  if (unsubscribeProfile) {
    unsubscribeProfile();
    unsubscribeProfile = null;
  }

  if (!user) return;

  const app = getAppSafe();
  if (!app) return;

  const db = getFirestore(app);
  const ref = doc(db, 'profiles', user.uid);

  unsubscribeProfile = onSnapshot(ref, snap => {
    if (!snap.exists()) return;
    const d = snap.data() || {};
    if (d.deletedByAdmin === true) return;

    const v = remoteVersion(d);

    // Evitar reaccionar dos veces al mismo snapshot.
    if (
      v.revision &&
      v.revision <= lastAppliedRevision &&
      v.updatedAt <= lastAppliedUpdatedAt
    ) return;

    if (!remoteIsNewer(d)) return;

    pendingRemote = d;
    applyPendingWhenSafe(user.uid);
  }, err => {
    console.warn('Sincronización multidispositivo temporalmente no disponible', err);
  });
}

function boot() {
  const app = getAppSafe();
  if (!app) return;
  const auth = getAuth(app);

  onAuthStateChanged(auth, user => {
    pendingRemote = null;
    hideNotice();
    startProfileListener(user);
  });

  // Si había cambios remotos esperando y el usuario terminó de escribir,
  // acelerar la aplicación.
  document.addEventListener('focusout', () => {
    const user = auth.currentUser;
    if (pendingRemote && user) applyPendingWhenSafe(user.uid);
  });

  document.addEventListener('visibilitychange', () => {
    const user = auth.currentUser;
    if (!document.hidden && pendingRemote && user) {
      applyPendingWhenSafe(user.uid);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
