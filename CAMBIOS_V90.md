# Cambios técnicos V90

## 1. Eliminación del autoguardado en nube

`persist()` queda limitado a almacenamiento local. Ya no programa `setDoc()` ni temporizadores de sincronización del perfil.

`scheduleCloudProfileSave()` se conserva únicamente como función de compatibilidad y no programa escrituras.

`scheduleCloudRetry()` ya no reintenta escrituras del perfil; solo actualiza el estado visual.

## 2. Detección real de modificaciones

Se agregó una huella canónica del contenido académico del profesor. Compara:

- perfil;
- respuestas por asignatura;
- metadatos de programas;
- comisiones/planeación del periodo;
- estado de finalización.

Los timestamps técnicos `updatedAtMs` y `completedAtMs` no provocan escrituras por sí solos.

## 3. Guardado manual confirmado

`saveTeacherChangesNow()` centraliza el flujo:

1. comprueba conexión/usuario/control de sesión;
2. comprueba si realmente hubo cambios;
3. si no hubo cambios, no escribe;
4. si hubo cambios, guarda en Firestore;
5. confirma éxito antes de permitir avanzar.

Se aplica a Datos del profesor, Comisiones, Guardar avances y cada `Guardar y continuar` de programa.

## 4. Navegación sin escrituras

`Anterior` y navegación interna conservan estado local, pero no escriben en Firestore.

## 5. Cierre y recuperación

- sin escritura automática al cerrar sesión;
- advertencia si hay cambios pendientes;
- respaldo local por UID se conserva;
- la transferencia entre dispositivos mantiene su checkpoint explícito de seguridad.

## 6. Finalización

La finalización sigue siendo una acción explícita. V90 exige confirmación de nube antes de bloquear el perfil. Si Firestore no confirma, el perfil permanece editable y no se presenta como finalizado.

## 7. Rendimiento / lecturas

Se eliminó una lectura redundante del documento de perfil para obtener `sessionWriteSeq` cuando el perfil ya fue recuperado por el flujo normal de carga/snapshot.

## 8. Candado administrativo

No se modifica el esquema ni las reglas. Se conserva:

- bloqueo global;
- habilitación individual;
- bloqueo individual;
- actualización en tiempo real por snapshot;
- privilegios del administrador;
- solo lectura del profesor cuando corresponde.
