# Arquitectura · Perfil Académico Docente DIN

## Separación lógica
1. **Catálogo curricular** (`catalog.js`): programas, salidas laterales, cuatrimestres y asignaturas base.
2. **Datos del profesor**: información personal, formación, experiencia docente y laboral.
3. **Perfil por asignatura**:
   - `pending`: aún no revisada.
   - `off`: revisada y conscientemente desactivada; se imprime vacía.
   - `X`: competencia media.
   - `XX`: competencia alta.
   - `na`: NO APLICA; utilizado automáticamente para Inglés; se imprime vacío.
4. **Origen del conocimiento**: 1 formación, 2 experiencia docente, 3 experiencia laboral; combinables.
5. **Preferencias**: materia ideal y coordinación de academia.
6. **Administración**: configuración institucional, catálogo adicional y exportación Office 365.
7. **Formalización**: impresión/PDF derivada de la misma captura; no es la fuente primaria.

## Reglas de tronco común
Solo se sincronizan:
- Ingeniería Industrial: Procesos Productivos ↔ Moldeo de Plásticos, cuatrimestres 1–3.
- Ingeniería Mecánica: Mecánica Industrial ↔ Mecánica Automotriz ↔ Mecánica Moldes y Troqueles, cuatrimestres 1–3.

No se sincronizan:
- Ingeniería en Mecánica Automotriz / Diseño y Manufactura Automotriz.
- Nanotecnología.
- Mantenimiento Industrial.
- Programas agregados desde Administración, salvo que una versión futura permita configurar explícitamente un tronco común.

## Exportación Excel
La exportación se encuentra únicamente en Administración y genera:
- Base maestra
- Resumen profesor
- Materias ideales
- Coordinaciones
- Catálogo

Usa SheetJS desde CDN y genera `.xlsx`, utilizable en Microsoft Office 365.

## Etapa siguiente: autenticación
La siguiente versión deberá:
- autenticar exclusivamente usuarios `@uteq.edu.mx`;
- diferenciar rol profesor / administrador;
- ocultar y proteger Administración y exportación Excel;
- conservar perfil por usuario en una base central;
- mantener historial por periodo de vigencia;
- permitir que un profesor abra el nuevo periodo con su captura anterior precargada.
