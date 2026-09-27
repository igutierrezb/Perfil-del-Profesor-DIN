# Arquitectura V3

## Estado por asignatura
- `pending`: habilitada pero todavía no revisada; se resalta en rojo.
- `off`: revisada y deshabilitada; se imprime en blanco.
- `X`: competencia media.
- `XX`: competencia alta.
- `na`: Inglés / NO APLICA; bloqueada y se imprime en blanco.

Las materias parten de `pending`, salvo Inglés (`na`).

## Área del conocimiento
Se almacena como arreglo de dígitos, pero la interfaz obliga a una sola combinación explícita:
`1`, `2`, `3`, `12`, `13`, `23`, `123`.

## Tronco común
Sincroniza estado, competencia, área e ideal:
- IND: Procesos Productivos ↔ Moldeo de Plásticos, cuatrimestres 1–3.
- MEC: Mecánica Industrial ↔ Mecánica Automotriz ↔ Mecánica Moldes y Troqueles, cuatrimestres 1–3.

## Coordinación de academia
Es opcional, permite múltiples materias y se conserva por programa educativo.

## Impresión
- Hoja 1: datos generales, formación y experiencia.
- Hojas siguientes: dos programas educativos por hoja.
- Una zona de firmas y sello por hoja.
- Calidad mostrada en línea, sin tabla.

## Administración
La V3 usa un bloqueo visual temporal mediante PIN. No debe considerarse control de acceso seguro.
La siguiente etapa debe implementar:
1. autenticación de usuarios `@uteq.edu.mx`;
2. rol profesor / administrador;
3. almacenamiento central por usuario y periodo;
4. historial de versiones;
5. Administración y exportación Excel protegidas en backend.
