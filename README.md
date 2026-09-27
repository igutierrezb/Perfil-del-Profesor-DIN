# Perfil Académico Docente DIN · Versión 7

Versión conservadora: mantiene autenticación, captura, troncos comunes y administración de V6.
Los cambios se concentran en presentación, impresión y formato del Excel administrativo.

## Cambios V7
- Nuevo ícono industrial más formal y simple.
- Favicon distintivo para favoritos/pestaña del navegador.
- Navegación 1–2–3 más visual; Administración resaltada en rojo.
- Fuente general aumentada aproximadamente un punto, excepto portada, encabezados y botones.
- Materias mostradas con mayúscula inicial y resto en minúsculas, preservando CAD/CAM y números romanos.
- Perfil por programa con menos negritas.
- Área del perfil con desplazamiento horizontal visible si la pantalla no permite mostrar todas las columnas.
- Impresión con wordmark UTEQ azul alineado.
- Tablas de impresión con bordes reforzados y contenido centrado hacia la parte inferior.
- Dos programas por hoja, usando el espacio disponible y colocando firmas/sello al fondo de la misma hoja.
- Encabezados por programa con tonalidades pastel.
- Excel administrativo con nueva hoja `Concentrado perfiles`, organizada horizontalmente por programa educativo y asignatura, similar al concentrado operativo de referencia.
- Se conservan las hojas `Base maestra` y `Catálogo`.

## Importante sobre horas y profesores
El catálogo actual no contiene `Horas al cuatrimestre` ni `Horas a la semana`; por eso esas filas/columnas se exportan vacías y listas para completar.

Asimismo, la versión actual conserva cada perfil en `localStorage`. El Excel puede estructurar el concentrado, pero la lista real de todos los profesores desde diferentes computadoras requerirá la siguiente etapa: guardar perfiles en una base central (Firestore).
