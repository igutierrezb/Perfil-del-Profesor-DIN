#!/usr/bin/env bash
set -euo pipefail

test -n "${FIREBASE_API_KEY:-}"
test -n "${FIREBASE_AUTH_DOMAIN:-}"
test -n "${FIREBASE_PROJECT_ID:-}"
test -n "${FIREBASE_APP_ID:-}"
test -n "${GOOGLE_CLIENT_ID:-}"

rm -rf dist
mkdir -p dist

# V82: sólo artefactos activos de producción.
for f in \
  index.html \
  styles.css \
  mobile.css \
  app.js \
  catalog.js \
  manifest.webmanifest \
  apple-touch-icon.png \
  favicon.ico \
  favicon.svg \
  favicon-16x16.png \
  favicon-32x32.png \
  favicon-division.png \
  icon-192.png \
  icon-512.png \
  icon-din.png \
  icono-industria.svg \
  logo-din-horizontal.png \
  logo-division-industrial-emblem.png \
  logo-division-industrial-full.png \
  logo-uteq-blue.png \
  logo-uteq-wordmark.svg \
  logo-uteq.png
do
  test -f "$f"
  cp "$f" dist/
done

cat > dist/firebase-config.js <<EOF
window.FIREBASE_CONFIG = {
  apiKey: "$FIREBASE_API_KEY",
  authDomain: "$FIREBASE_AUTH_DOMAIN",
  projectId: "$FIREBASE_PROJECT_ID",
  appId: "$FIREBASE_APP_ID"
};

window.PAD_GOOGLE_CLIENT_ID = "$GOOGLE_CLIENT_ID";
window.PAD_ALLOWED_DOMAIN = "uteq.edu.mx";
window.PAD_ADMIN_EMAIL = "ivan.gutierrez@uteq.edu.mx";
EOF

cat > dist/build-info.json <<EOF
{
  "version": "V82-2026-09-29",
  "runtime": "consolidated",
  "legacyBackupModulePublished": false
}
EOF
