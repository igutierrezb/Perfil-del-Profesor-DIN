# Perfil DIN V96 · Corrección de marca de agua

## Objetivo
Corregir exclusivamente la determinación de la marca de agua al imprimir perfiles desde Administración, preservando sin cambios el modelo de datos, reglas de Firestore, guardado manual y controles existentes de V95.

## Corrección
En V95, `printTeacherProfile(uid)` cargaba el perfil, respuestas, metadatos, periodo y fecha de finalización del profesor seleccionado, pero no cargaba temporalmente los campos `dataRevision`, `finalizedDataRevision`, `individualEditEnabled` e `individualEditDisabled` de ese profesor.

La función `profileFormallyFinalized()` podía entonces comparar la revisión finalizada del profesor con la revisión local del administrador. Esa mezcla de estados podía clasificar como borrador un perfil correctamente finalizado y agregar `DOCUMENTO NO FINALIZADO / BORRADOR`.

V96 carga temporalmente el estado completo de finalización del profesor seleccionado antes de construir la impresión y restaura íntegramente el estado local del administrador al terminar.

## Resultado esperado
- Perfil correctamente finalizado: impresión limpia, sin marca de agua.
- Perfil no finalizado o modificado después de su última finalización: conserva la marca de agua.
- Perfiles antiguos finalizados antes del control por revisiones: mantienen compatibilidad con la lógica existente.
- No se altera ni borra información capturada.
- No se agregan lecturas ni escrituras de Firestore.

## Archivos que cambian
- `app.js`
- `index.html` (solo identificador/cache bust de V96)

## Archivos que NO cambian funcionalmente
- `firestore.rules`

## Despliegue
`.github/workflows/deploy-pages.yml` NO requiere actualización.
