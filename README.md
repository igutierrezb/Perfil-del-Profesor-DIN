# Perfil Académico Docente · División Industrial UTEQ

Versión 2 del prototipo funcional.

## Archivos
- `index.html`: estructura principal.
- `styles.css`: diseño visual, escritorio e impresión.
- `catalog.js`: ocho programas educativos base y reglas de tronco común.
- `app.js`: captura, persistencia, validaciones, impresión, administración y exportación.
- `logo-uteq.png`: logo extraído del formato institucional de referencia aportado para este prototipo.

## Uso en GitHub Pages
Sustituir en la raíz del repositorio los archivos anteriores y conservar sus nombres.

## Cambios principales de esta versión
- Datos personales obligatorios en una sola línea horizontal.
- Formación profesional sin periodo; Licenciatura/TSU y Posgrados.
- Experiencia docente sin columna de asignaturas/área.
- Primera línea obligatoria en formación, docencia y experiencia laboral.
- Dos cuatrimestres por fila en escritorio.
- Inglés marcado automáticamente como NO APLICA y vacío en impresión.
- Botón compacto desactivar/reactivar.
- X/XX obliga a seleccionar origen 1, 2 y/o 3.
- Selección de materias ideales (mínimo 3).
- Registro de coordinación de academia por programa.
- Guardado por sección y por programa.
- Revisión bloqueada hasta completar toda la captura.
- Impresión horizontal ampliada con logo, control de calidad, sello y firmas.
- Administración con alta de nuevos programas y materias.
- Exportación administrativa a Excel `.xlsx` compatible con Office 365.
- Configuración editable de código, revisión, fecha de revisión, periodo y Jefe de Unidad.
- Pie de autoría y enlace al Aviso de Privacidad UTEQ.

## Persistencia
Esta versión usa `localStorage` del navegador. Conserva la información en el equipo/navegador utilizado. La siguiente etapa debe sustituir esta persistencia por una base central cuando se implemente autenticación institucional `@uteq.edu.mx`.

## Seguridad pendiente
El módulo Administración está visualmente separado, pero todavía no constituye una barrera de seguridad. La restricción real por rol se implementará junto con el acceso institucional.
