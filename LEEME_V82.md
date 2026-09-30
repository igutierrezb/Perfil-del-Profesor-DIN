# Perfil del Profesor DIN · V82 consolidada

## Punto de partida
Esta V82 está construida **directamente sobre la V80 publicada en `main`** del repositorio `igutierrezb/Perfil-del-Profesor-DIN` y ya integra todo lo que se había definido para V81. **No debe instalar V81 previamente.**

## Archivos que SÍ debe sustituir manualmente en GitHub
- `app.js`
- `index.html`
- `styles.css`
- `mobile.css`
- `firestore.rules`
- `build-cloudflare.sh`

## Archivo que NO debe sustituir en esta versión
- `.github/workflows/deploy-pages.yml`

**Deploy Pages: NO se modifica en V82.** El workflow vigente ya ejecuta `build-cloudflare.sh` y publica `dist` correctamente.

## Paso indispensable fuera de GitHub
Después de sustituir `firestore.rules` en el repositorio, publique también esas reglas en **Firebase / Firestore Rules**. La sesión única entre dispositivos depende de esas reglas; no basta con cambiar la interfaz.

## Qué integra de V81
- Una sola sesión activa de edición por profesor.
- Transferencia de control entre computadora y móvil.
- El dispositivo anterior queda en solo lectura cuando otro toma la edición.
- `profileSessions/{uid}` en Firestore.
- `writerSessionId` y `sessionWriteSeq` monotónico para impedir escrituras desde una sesión anterior.
- Estado visible de sesión y verificación previa de revisión.
- Conservación de `profile`, `answers`, `programMeta`, `planningByPeriod`, `submittedPeriod`, `finalizedAtMs`, `dataRevision` y respaldo `PAD_UTEQ_PROFILE_<UID>`.

## Mejoras específicas V82
- Comisiones opcionales: si no se capturó ninguna, se pide confirmación antes de avanzar; no se convierte en un error obligatorio.
- Experiencia laboral: si se inicia una línea adicional, organización, puesto/cargo y periodo deben quedar completos antes de avanzar.
- El manual de llenado se muestra **cada vez** que se pasa de Datos del profesor a Perfil por programa, incluso si se regresó en la misma sesión.
- Navegación secuencial mediante Atrás / Guardar y continuar; los indicadores superiores no sirven para saltar etapas durante la edición.
- Orden fijo de programas:
  1. Ingeniería Industrial — Procesos Productivos.
  2. Ingeniería Industrial — Moldeo de Plásticos.
  3. Ingeniería Mecánica — Mecánica Automotriz.
  4. Ingeniería Mecánica — Mecánica Industrial.
  5. Ingeniería Mecánica — Moldes y Troqueles.
  6. Ingeniería en Mecánica Automotriz — Diseño y Manufactura Automotriz.
  7. Ingeniería en Mantenimiento Industrial — Mantenimiento Industrial.
  8. Ingeniería en Nanotecnología — Nanotecnología.
- `Guardar avances` y `Guardar y continuar` son acciones distintas.
- `Guardar avances` conserva la captura aunque existan pendientes y permanece en el programa actual.
- En la zona superior: `Guardar y continuar` arriba y `Guardar avances` debajo.
- En la zona inferior derecha: `Guardar avances` arriba y `Guardar y continuar` debajo.
- Si se intenta continuar con materias incompletas, se bloquea el avance y se resaltan las materias que requieren atención.
- Coordinador y Favorita son completamente opcionales y nunca bloquean el avance.

## Aplicación manual recomendada
1. Conserve una copia de su V80 actual.
2. Sustituya en `main` los seis archivos indicados arriba.
3. No modifique `deploy-pages.yml` para esta versión.
4. Espere a que GitHub Pages termine el despliegue normal.
5. Publique `firestore.rules` en Firebase.
6. Recargue la aplicación en computadora y móvil antes de probar la transferencia de sesión.
7. Ejecute la batería de `PRUEBAS_V82.md` antes de habilitar la captura general.
