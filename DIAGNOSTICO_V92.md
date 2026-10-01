# Diagnóstico V92

## 1. Causa raíz del falso “sin control de edición”
V91 mantenía un segundo candado basado en `profileSessions/{uid}`. El cliente podía considerar que otro dispositivo tenía la edición y `sessionCanWrite()` bloqueaba `Guardar y continuar`. Además, las reglas de Firestore exigían que `writerSessionId` coincidiera con `activeSessionId` cuando existía un documento de sesión. Por tanto, un documento de sesión antiguo podía seguir bloqueando escrituras incluso si físicamente no había otro equipo abierto.

## 2. Causa del botón administrativo que queda procesando
`setTeacherEditAccess()` esperaba directamente a `updateDoc()`. Si Firestore no confirmaba la escritura (conectividad, reglas no publicadas o estado de red), la promesa podía permanecer pendiente y el botón seguía en estado `Habilitando…/Deshabilitando…`. No existía un límite temporal ni una verificación posterior contra servidor.

## 3. Separación de despliegues
- `build-cloudflare.sh` genera `dist/` y `wrangler.jsonc` sirve esos archivos estáticos en Cloudflare.
- `.github/workflows/deploy-pages.yml` despliega esa misma compilación a GitHub Pages.
- `firestore.rules` NO se despliega por ninguno de los dos mecanismos. Se publica aparte en Firebase Console.

Esa separación es crítica: reemplazar código en GitHub/Cloudflare no actualiza las reglas activas de Firestore.

## 4. Solución V92
- Se elimina la sesión exclusiva por dispositivo como condición de edición.
- Se mantiene el candado administrativo, fecha, cierre general y finalización.
- Las reglas V92 eliminan el requisito `profileSessions` de las escrituras propias.
- El administrador usa `setDoc(..., {merge:true})`, timeout y `getDocFromServer()` para confirmar el resultado real.
- Se impide el uso desde teléfono/tableta antes de inicializar Auth/Firestore.
- Sólo quedan acciones de `Guardar y continuar` como escritura académica manual visible.
