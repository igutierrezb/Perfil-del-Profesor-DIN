# Perfil Académico Docente DIN · Versión 13

Versión de refinamiento visual sobre V12. No cambia autenticación, Firestore, modelo de datos, perfil vigente, horas, programas ni lógica de tronco común.

## Cambios V13
- Perfil por programa más compacto horizontalmente.
- Área de conocimiento reducida y mantenida en dos renglones.
- Se elimina el cintillo superior de Coordinación; la decisión se realiza directamente por asignatura.
- Encabezado de la columna: `¿Has coordinado la materia?`.
- Favorito más angosto, sin reducir su fuente.
- Guía `Cómo capturar` actualizada a seis pasos e incluye Coordinación.
- Leyenda visual de estados: pendiente, revisada, no puede impartir y no aplica.
- Botones con jerarquía visual más consistente y menor relieve.
- Encabezado del programa discretamente sticky.
- Mensajes de pendientes muestran nombres de las primeras asignaturas faltantes.
- Mejoras de accesibilidad con `aria-label`, `title` y foco visible.
- Tronco común se identifica como sincronizado y su editor administrativo recibe un refinamiento visual.
- Administración incorpora una barra horizontal: Control de captura, Configuración institucional y Exportar Excel.
- Se elimina la tarjeta separada `Base maestra para Office 365`.
- Excel:
  - `★` identifica materia favorita.
  - **Fuente roja** identifica una materia que el profesor ha coordinado.
  - No utiliza fondo amarillo para favoritas.
  - Profesor/Categoría permanecen congelados.
  - Se agregan autofiltros.
- Impresión:
  - `Área de competencia` se presenta en dos líneas horizontales.
  - Nivel continúa compacto.
  - Se optimiza el ancho para dar mayor espacio a Asignatura.
