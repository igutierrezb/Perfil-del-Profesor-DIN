# Arquitectura propuesta para producción

## Principio
El PDF no debe ser la fuente maestra. La fuente maestra es una base normalizada. El PDF se genera como evidencia/formalización de la misma captura.

## Google Sheets sugerido
- `CONFIG`: periodo vigente, código, revisión, jefe de unidad, estado de convocatoria.
- `PROFESORES`: id_profesor, correo, apellido paterno, materno, nombres, categoría, activo.
- `FORMACION`: id_profesor, tipo/grado, institución, periodo.
- `EXPERIENCIA_DOCENTE`: id_profesor, institución, área/asignaturas, periodo.
- `EXPERIENCIA_LABORAL`: id_profesor, organización, cargo, periodo.
- `PROGRAMAS`: id_programa, licenciatura, salida_lateral, grupo_tronco.
- `ASIGNATURAS`: id_asignatura, id_programa, cuatrimestre, orden, nombre, id_tronco (si aplica).
- `PERFILES`: id_profesor, periodo, id_asignatura, estado_revision, competencia, origen_1, origen_2, origen_3, fecha_actualizacion.
- `VERSIONES`: id_profesor, periodo, version, fecha_cierre, pdf_url, hash/folio.
- `OFERTA`: periodo, grupo, id_programa, cuatrimestre, id_asignatura. Esta tabla permitirá producir después el archivo operativo de asignación.

## Flujo
1. Profesor accede con cuenta institucional.
2. Si ya existe, se precarga su último perfil.
3. Actualiza solo lo necesario.
4. El sistema obliga a revisar todas las asignaturas.
5. La lógica de tronco común sincroniza solo los grupos autorizados.
6. Al finalizar, se guarda una versión congelada y se genera PDF.
7. La base madre administrativa consulta `PERFILES` directamente; no se recaptura desde el PDF.
8. Al cargar `OFERTA` del siguiente periodo, se puede expandir automáticamente cada perfil a los grupos/materias habilitados.

## Recomendación de seguridad
En producción: Apps Script Web App con validación de correo institucional y permisos de administrador. No confiar en validaciones del navegador. El profesor solo puede editar su registro; administración puede consultar todos y abrir/cerrar periodos.

## Persistencia entre periodos
Nunca sobrescribir la versión cerrada. Para un periodo nuevo, clonar el perfil vigente como borrador del nuevo periodo; el profesor modifica diferencias y vuelve a formalizar. Así existe historial completo.
