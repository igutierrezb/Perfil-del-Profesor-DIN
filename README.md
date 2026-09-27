# Perfil Académico Docente DIN · Versión 19

Actualización puntual del apartado Administración → Programas educativos.

## Cambios
- Todos los programas educativos pueden editarse desde Administración.
- El administrador puede modificar nombre, salida lateral, materias, horas y cantidad de cuatrimestres.
- Los programas base se conservan en `catalog.js`; los cambios se guardan como `programOverrides`.
- Si cambia una materia en una posición, se limpia solo la respuesta de esa posición para evitar heredar una competencia de otra materia.
- Importación desde imagen mediante OCR en el navegador con Tesseract.js.
- El OCR intenta detectar programa, salida lateral, cuatrimestres, materias y horas.
- El texto detectado queda visible y editable antes de guardar.
- Se conserva la captura manual `Asignatura - horas`.

## Deploy
`deploy-pages.yml`: NO necesita actualización.
