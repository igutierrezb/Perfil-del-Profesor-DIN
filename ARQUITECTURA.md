# Arquitectura V7

## Sin cambios funcionales
Se conserva:
- Firebase Authentication;
- restricción `@uteq.edu.mx`;
- administrador `ivan.gutierrez@uteq.edu.mx`;
- perfil, materias, X/XX, áreas, materia ideal y coordinaciones;
- troncos comunes;
- configuración administrativa.

## Presentación
- `favicon.svg`: ícono para pestaña/favoritos.
- `icono-industria.svg`: identidad visual de la plataforma.
- `logo-uteq-wordmark.svg`: wordmark azul utilizado en impresión.

## Excel
La exportación administrativa genera:
1. `Concentrado perfiles`: matriz horizontal por programa y asignatura.
2. `Base maestra`: registros normalizados.
3. `Catálogo`: catálogo curricular.

Las filas `Horas al cuatrimestre` y `Horas a la semana` se dejan vacías mientras esos datos no estén incorporados al catálogo.

## Limitación actual
Los perfiles continúan almacenados localmente. Para que Administración consolide automáticamente a todos los profesores que capturen desde cualquier equipo, será necesario persistir los perfiles en Firestore.
