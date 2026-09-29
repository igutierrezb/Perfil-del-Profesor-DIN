#!/usr/bin/env bash
set -euo pipefail

test -n "${FIREBASE_API_KEY:-}"
test -n "${FIREBASE_AUTH_DOMAIN:-}"
test -n "${FIREBASE_PROJECT_ID:-}"
test -n "${FIREBASE_APP_ID:-}"
test -n "${GOOGLE_CLIENT_ID:-}"

rm -rf dist
mkdir -p dist

find . -maxdepth 1 -type f \
  ! -name 'firebase-config.js' \
  ! -name 'wrangler.jsonc' \
  ! -name '.assetsignore' \
  ! -name 'build-cloudflare.sh' \
  ! -name 'firestore.rules' \
  ! -name 'README*' \
  ! -name 'LEEME*' \
  ! -name 'SETUP_*' \
  ! -name '*.md' \
  -exec cp {} dist/ \;

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
