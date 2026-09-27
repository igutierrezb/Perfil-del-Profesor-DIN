# Arquitectura V11

## Periodo
`cfg.periodo` es únicamente metadato visual y administrativo. Cambiarlo no crea un perfil nuevo ni elimina:
- `profile`;
- `answers`;
- `programMeta`.

El documento Firestore del profesor continúa siendo `profiles/{uid}`, por lo que el perfil vigente se sobrescribe y conserva entre cambios de periodo.

## Troncos comunes
`commonRules` se almacena en configuración global. Cada regla contiene:
- `id`;
- `name`;
- `programIds`;
- `semesters` (índices base 0).

La réplica busca la misma asignatura por nombre normalizado en el mismo cuatrimestre. Esto evita depender de que la asignatura tenga exactamente la misma posición dentro de las listas.

## Impresión
- firmas y sello: solo primera hoja;
- tres programas por hoja posterior;
- columnas de asignatura calculadas según cantidad de cuatrimestres;
- Nivel y Área mantienen columnas estrechas.
