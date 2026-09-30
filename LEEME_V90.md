# Perfil del Profesor DIN · V90

Fecha: 30-sep-2026

## Instalación directa

V90 es **acumulativa**. Incluye las correcciones de V89 (Comisiones, móvil y control de edición) y las nuevas mejoras de guardado manual. **No es necesario instalar V89 primero.**

Sustituya en la raíz del repositorio exactamente estos cinco archivos:

1. `app.js`
2. `index.html`
3. `styles.css`
4. `mobile.css`
5. `build-cloudflare.sh`

Aunque `styles.css` y `mobile.css` no cambian internamente respecto de V89, se incluyen para que V90 pueda instalarse directamente sobre la versión anterior sin aplicar V89 por separado.

## No modificar

- `firestore.rules` → **NO actualizar**.
- `.github/workflows/deploy-pages.yml` → **NO actualizar**.
- `catalog.js` → no cambia.
- `firebase-config.js` → no cambia.
- `wrangler.jsonc` → no cambia.
- imágenes, iconos y logotipos → no cambian.

## Nuevo modelo de guardado V90

- No existe autoguardado periódico del perfil en Firestore.
- Escribir, seleccionar materias, abrir/cerrar secciones, agregar una comisión o navegar hacia atrás conserva el borrador local, pero **no produce una escritura automática en Firestore**.
- `Guardar y continuar` valida y compara el estado actual con el último estado confirmado en la nube.
- Si **no hubo cambios reales**, el sistema avanza sin hacer otra escritura.
- Si **sí hubo cambios**, realiza una única escritura consolidada y solo avanza cuando Firestore confirma el guardado.
- Si la nube falla, la información queda en el dispositivo y la pantalla no avanza.
- Al volver a una página ya guardada, pulsar `Guardar y continuar` nuevamente no genera otra escritura si el contenido no cambió.
- `Atrás` no escribe en Firestore.
- Al recuperar conexión no se dispara una escritura automática; el usuario confirma el siguiente guardado mediante el botón correspondiente.
- Cerrar sesión no guarda automáticamente en Firestore. Si existen cambios pendientes, se muestra una advertencia.
- Cerrar o recargar el navegador con cambios pendientes muestra la advertencia estándar del navegador.

## Excepciones intencionales

Las siguientes operaciones sí usan Firestore porque son funciones de control, no autoguardados del formulario:

- sesión única / transferencia entre dispositivos;
- heartbeat de la sesión activa;
- cambio administrativo de habilitar/deshabilitar edición;
- configuración administrativa;
- finalización explícita del perfil;
- auditoría existente.

La transferencia entre dispositivos sigue intentando confirmar los cambios pendientes antes de ceder el control para proteger la información.

## Comisiones heredadas de V89

V90 conserva íntegramente la corrección de V89:

- `Sí` muestra `Agregar comisión`;
- nombre, horas autorizadas y horario específico;
- resumen compacto por comisión;
- editar/eliminar;
- validación de horario cuando se requiere bloqueo;
- adaptación para dispositivos móviles;
- controles bloqueados cuando Administración deshabilita la edición.

## Compatibilidad y datos

No se cambia el esquema de Firestore ni se requiere migración. Se mantienen `profile`, `answers`, `programMeta`, `planningByPeriod`, `submittedPeriod`, `finalizedAtMs`, `writerSessionId`, `sessionWriteSeq` y los controles administrativos existentes.

V90 además preserva campos superiores heredados del objeto `profile` aunque no formen parte de la interfaz visible actual.
