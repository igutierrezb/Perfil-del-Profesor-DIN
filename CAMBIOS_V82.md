# Resumen técnico V82

V82 es acumulativa: V80 publicada + toda V81 + ajustes V82.

### Seguridad y persistencia
- `runTransaction` para adquisición/traspaso de sesión.
- Heartbeat de sesión y takeover entre dispositivos.
- Segundo candado en Firestore mediante `writerSessionId` + `sessionWriteSeq`.
- Checkpoint antes de ceder sesión y antes de cerrar sesión.

### Datos del profesor
- Comisiones dejan de ser requisito absoluto para avanzar.
- Confirmación explícita cuando no existe comisión capturada.
- Líneas adicionales de experiencia laboral se validan como unidad completa si se empieza a llenar cualquiera de sus campos.

### Perfil académico
- Manual forzado en cada transición Datos → Perfil.
- Ocho programas ordenados mediante `PROGRAM_ORDER_V82` sin alterar sus datos fuente.
- Guardado de avances desacoplado de la validación de avance.
- Pendientes resaltados después de intentar continuar.
- Coordinador y Favorita no participan en `currentProgramIssues()`, `validateCapture()` ni `validateAll()`.

### Despliegue
- `build-cloudflare.sh` cambia únicamente la marca de versión a `V82-2026-09-29`.
- `.github/workflows/deploy-pages.yml` permanece intacto.
