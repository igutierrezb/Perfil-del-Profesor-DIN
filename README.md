# Perfil Académico Docente DIN · Versión 8

Esta versión conserva el funcionamiento de V7 y realiza ajustes puntuales de presentación, impresión, horas curriculares, Excel y control de edición.

## Cambios V8
- Ícono industrial más moderno y sobrio.
- Favicon distintivo.
- Íconos pequeños en las cuatro secciones principales.
- Administración permanece resaltada en rojo.
- Reducción general de tipografía de aproximadamente 0.5 pt; los nombres de materias en Perfil por programa conservan su tamaño.
- Pendientes con fondo rojizo y barra lateral más evidente.
- Horas totales de cada asignatura incorporadas desde los ocho mapas curriculares fuente.
- En Perfil por programa las horas aparecen discretamente entre paréntesis.
- Las horas no se imprimen en el PDF.
- Concentrado Excel con Profesor y Categoría en columnas separadas.
- Excel incluye Horas al cuatrimestre y Horas a la semana (total / 15).
- La validación de pendientes evita reportar como tres decisiones distintas una materia sincronizada del tronco común.
- Impresión compactada a tres programas educativos por hoja, con firmas y sello al fondo.
- Materias alineadas a la izquierda en impresión; resto de datos centrados.
- Logo UTEQ de impresión reducido para evitar empalmes.
- Encabezado de páginas de programas más compacto.
- Paleta pastel con líneas más firmes para conservar legibilidad en blanco y negro.
- Control administrativo para activar/desactivar edición de perfiles.
- Autoría visible al fondo: “Sitio diseñado, creado y administrado por Iván Gutiérrez Bautista”.

## Nota importante sobre el control de edición
La aplicación todavía almacena la configuración en `localStorage`. Por lo tanto, el interruptor de edición incluido en esta versión funciona en el navegador donde se activa. Para convertirlo en un bloqueo global para todos los profesores desde cualquier equipo, debe persistirse ese estado en una base central (por ejemplo Firestore). No se agregó esa dependencia todavía para no romper la autenticación y el funcionamiento actual.

## Horas
`PROGRAM_HOURS` almacena las horas totales del cuatrimestre. La hoja de Excel calcula `Horas a la semana` dividiendo entre 15 semanas.
