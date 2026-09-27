# Arquitectura V9

## Programas activos
Se agrega `disabledPrograms` al estado local. `allPrograms()` devuelve todos los programas; `programs()` devuelve solo los habilitados.

La deshabilitación afecta:
- captura;
- validación;
- impresión;
- exportación Excel.

## Programas personalizados con horas
Los programas creados desde Administración ahora almacenan:
- `semesters`: nombres de materias;
- `hours`: matriz paralela de horas totales por materia.

El formato de entrada es `Asignatura - horas`.

## Excel
El encabezado fusionado por programa utiliza:
`Nombre completo del programa (ACRÓNIMO)`.

## Impresión
- Primera hoja: metadatos de profesor ampliados.
- Hojas siguientes: materias con mayor tamaño.
- Logo UTEQ más compacto.
- Tres programas por hoja y firmas al fondo.
