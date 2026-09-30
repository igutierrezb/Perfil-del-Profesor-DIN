# Diagnóstico técnico V91 · Perfil del Profesor DIN

Fecha: 30-sep-2026

## 1. Hallazgo principal: falso bloqueo por sesión

V90 mantenía un documento `profileSessions/{uid}` con `activeSessionId`, `activeDevice` y `heartbeatMs`. Si el navegador se cerraba, perdía conexión o no alcanzaba a ejecutar la liberación de sesión, ese documento permanecía en Firestore. En el siguiente acceso, la aplicación podía interpretar ese registro como si otro dispositivo siguiera editando.

Se identificaron cuatro causas concretas:

1. `watchSessionDocument()` mostraba el modal de recuperación incluso cuando `activeSessionId` estaba vacío. Un documento de sesión sin propietario podía producir visualmente el mensaje «Edición abierta en otro dispositivo».
2. V90 utilizaba un protocolo de solicitud/espera (`takeoverRequestedSessionId`) que dependía de que el dispositivo anterior siguiera vivo y respondiera. Si ya no existía, el nuevo dispositivo podía quedar esperando una transferencia que nunca se completaba.
3. El botón «Recuperar edición aquí» dependía de `forceClaimSession()` y de un `runTransaction()` con tiempo máximo de interfaz. En redes lentas podía parecer que el botón no hacía nada aunque el estado remoto estuviera cambiando o la transacción terminara después.
4. `editingAllowed()` mezclaba dos conceptos independientes: permiso administrativo y propiedad de la sesión. Por ello, un perfil podía aparecer «Edición individual habilitada» en Administración y continuar bloqueado por un conflicto de sesión obsoleto.

## 2. Hallazgo de rendimiento

V90 escribía un heartbeat de sesión aproximadamente cada 45 segundos mientras el profesor conservaba el control. Cada heartbeat utilizaba una transacción de Firestore: una lectura y una escritura. Para una plataforma con alrededor de 100 profesores, esa actividad era innecesaria frente al modelo de guardado manual ya adoptado.

## 3. Hallazgo de coherencia del candado

Existían tres controles distintos: cierre general (`cfg.editingLocked`), habilitación individual (`individualEditEnabled`) y bloqueo individual (`individualEditDisabled`). La habilitación individual no prevalecía sobre la fecha límite porque `deadlinePassed()` se evaluaba antes. Esto hacía que el botón administrativo «Habilitar edición» no significara siempre «puede editar».

## 4. Estructura de publicación revisada

El proyecto es una aplicación web estática: `index.html`, `app.js`, `styles.css`, `mobile.css` y `catalog.js`. `build-cloudflare.sh` construye `dist/`, copia los activos y genera `firebase-config.js` desde variables de entorno. `wrangler.jsonc` publica `dist/` como activos estáticos en Cloudflare. La autenticación, datos, permisos y sesiones se resuelven en el navegador contra Firebase Authentication y Firestore.

El repositorio también contiene `.github/workflows/deploy-pages.yml`, que construye el mismo `dist/` y lo publica en GitHub Pages. La lógica problemática no está en Cloudflare ni en el workflow: está en el cliente y en el documento persistente `profileSessions`.

## 5. Criterio de solución

V91 conserva el esquema actual, los documentos existentes y las reglas actuales de Firestore. No migra, elimina ni renombra datos. Se reemplaza el handshake entre dispositivos por una concesión simple y explícita:

- mismo dispositivo: recuperación automática;
- sesión antigua/vencida: recuperación automática;
- otro dispositivo realmente reciente: se muestra un único botón «Continuar edición aquí»;
- al confirmarlo, este dispositivo toma la sesión y el anterior pasa a solo lectura por `onSnapshot`;
- los cambios no guardados del dispositivo anterior se conservan localmente en ese equipo, pero no se suben automáticamente.

Esto es coherente con V90: la nube sólo se actualiza mediante guardados manuales confirmados.

## 6. Preservación de los cinco pilares

1. Datos: no se modifica el modelo de perfiles ni se realiza borrado/migración.
2. Diseño/candados: se simplifica el modal y se separa permiso administrativo de sesión de dispositivo.
3. Reporte: no se cambia la generación de datos ni el Excel.
4. Control administrativo: la habilitación individual pasa a ser una autorización real que prevalece sobre cierre general, fecha límite y finalización; el bloqueo individual sigue teniendo prioridad.
5. Impresión: no se modifica la composición ni el control de impresión/finalización.
