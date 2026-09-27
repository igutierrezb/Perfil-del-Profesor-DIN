# Perfil Académico Docente - División Industrial UTEQ

## Qué contiene
Prototipo funcional sin servidor para validar el flujo antes de conectarlo a Google Apps Script / Sheets.

- `index.html`: interfaz.
- `styles.css`: diseño y formato de impresión.
- `catalog.js`: 8 programas educativos y reglas de tronco común.
- `app.js`: captura, validación, persistencia local, impresión y exportación de base madre.
- `ARQUITECTURA.md`: propuesta para llevarlo a producción.

## Reglas implementadas
1. Cada asignatura inicia como **pendiente**.
2. El profesor debe **desactivarla** o seleccionar **X / XX**.
3. Desactivada = revisada internamente, pero se imprime en blanco.
4. X/XX obliga a seleccionar al menos un origen: 1 formación académica, 2 experiencia docente, 3 experiencia laboral.
5. Tronco común Industrial: solo cuatrimestres 1-3 entre Procesos Productivos y Moldeo de Plásticos.
6. Tronco común Mecánica: solo cuatrimestres 1-3 entre Mecánica Industrial, Mecánica Automotriz y Mecánica Moldes y Troqueles.
7. Los demás programas no comparten respuestas.
8. Los datos quedan guardados en `localStorage` para que el prototipo conserve el perfil al volver a abrirse en el mismo navegador.

## Cómo probar
Abra `index.html` en Chrome/Edge. Para publicación real no use localStorage como base definitiva: conecte la interfaz a Apps Script + Google Sheets según `ARQUITECTURA.md`.

## Referencia de Calidad
Del PDF de referencia se identificó: **EA-F-86 / Rev.01 / Fecha: 21-sep-2018**. Se conserva como referencia visual/configurable. Antes de producción debe confirmarse con el documento vigente de Control de Calidad.
