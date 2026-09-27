# Perfil Académico Docente DIN · Versión 3

## Actualización manual en GitHub
Sustituya en la raíz del repositorio:
- `index.html`
- `styles.css`
- `app.js`
- `catalog.js`
- `logo-uteq.png`

Agregue:
- `icono-industria.svg`

También puede sustituir `README.md` y `ARQUITECTURA.md`.

## Cambios V3
- Captura mostrada programa educativo por programa educativo.
- Navegador anterior/siguiente y selector directo de programa.
- Todas las materias no-Inglés empiezan habilitadas pero pendientes de revisión.
- Las materias pendientes resaltan en rojo.
- Inglés queda bloqueado como NO APLICA y se imprime vacío.
- Encabezados visibles: Asignatura, Habilitar, Competencia, Área de conocimiento, Materia ideal.
- Área del conocimiento como opción única: 1, 2, 3, 12, 13, 23 o 123.
- Habilitar/deshabilitar mediante interruptor visual.
- Materia ideal con texto visible.
- Coordinación de academia opcional y de selección múltiple.
- Tronco común sincronizado en los tres primeros cuatrimestres únicamente en las familias definidas.
- Revisión bloqueada mientras haya pendientes.
- Impresión: dos programas educativos por hoja, con una sola zona de firmas y sello.
- Datos de Calidad compactos y sin tabla.
- Logo UTEQ corregido en impresión.
- Ícono de interfaz sustituido por símbolo industrial.
- Administración oculta en uso normal y con acceso temporal por PIN.
- Base maestra `.xlsx` para Office 365 desde Administración.

## PIN administrativo temporal
`DIN2026`

Este PIN **no es seguridad real** porque GitHub Pages es un sitio estático y el código es público. Solo oculta la interfaz administrativa frente al uso normal. La seguridad definitiva debe implementarse en la siguiente etapa con autenticación institucional `@uteq.edu.mx` y rol de administrador.

## Persistencia
Continúa usando `localStorage`, por lo que una captura ya realizada se conserva en ese navegador y se vuelve a mostrar en futuras sesiones.
