# Arquitectura V8

## Conservado
- Firebase Authentication y dominio institucional.
- Administrador exclusivo `ivan.gutierrez@uteq.edu.mx`.
- Captura X / XX, áreas 1-2-3, materia ideal, coordinaciones y troncos comunes.
- Programas personalizados.
- Impresión y exportación Excel.
- GitHub Actions + GitHub Pages.

## Datos curriculares
`catalog.js` conserva los nombres de los programas y ahora incorpora `PROGRAM_HOURS`, un arreglo paralelo con las horas totales por cuatrimestre para cada asignatura base.

Funciones nuevas:
- `subjectHours(programa, cuatrimestre, asignatura)`
- `weeklyHours(...)`

## Concentrado Excel
La hoja `Concentrado perfiles` utiliza:
- Columna A: Profesor.
- Columna B: Categoría.
- Desde columna C: asignaturas agrupadas por programa.
- Filas superiores: asignatura, horas al cuatrimestre, horas por semana y cuatrimestre.
- Celdas del profesor: X o XX.

## Control de edición
`cfg.editingLocked` controla la edición del perfil en la instalación/navegador actual.
No es un bloqueo multiusuario global mientras la configuración siga en `localStorage`.

## Impresión
La primera hoja conserva los datos profesionales.
Las siguientes hojas usan la clase `program-trio` para distribuir hasta tres programas, encabezado compacto y firmas/sello al fondo.
