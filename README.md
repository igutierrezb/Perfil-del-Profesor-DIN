# Perfil Académico Docente DIN · Versión 25

## Cambios
- Se elimina por completo el módulo de importación de materias desde imagen y Tesseract.js.
- Agregar/Editar programa educativo ahora trabaja materia por materia.
- Cada cuatrimestre es independiente y contiene:
  - nombre de materia;
  - horas;
  - botón Editar;
  - botón Eliminar;
  - botón + Agregar materia.
- También puede agregarse o borrarse un cuatrimestre completo.
- El guardado valida que cada materia tenga nombre y horas.
- Exportar Excel se mantiene verde, ahora más grande, con mayor fuente y presencia visual.
- Impresión/PDF:
  - las hojas de programas reservan una franja inferior exclusiva;
  - firma del profesor, sello y firma del Jefe de Unidad aparecen al pie de todas las hojas a partir de la hoja 2;
  - la zona de firmas no se superpone con las tablas.

## Deploy
`deploy-pages.yml`: NO necesita actualización.

## Firestore
`firestore.rules`: NO necesita actualización respecto a V21.
