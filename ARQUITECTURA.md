# Arquitectura V12

## Bloqueo por formalización
`store.submittedPeriod` conserva el periodo en el que el profesor dio por finalizada su captura tras imprimir/guardar PDF.

La edición se bloquea si:
- `submittedPeriod === cfg.periodo`;
- la fecha límite venció; o
- Administración desactivó la edición.

Cuando cambia `cfg.periodo`, el valor anterior de `submittedPeriod` deja de coincidir y la edición vuelve a estar disponible. No se elimina `profile`, `answers` ni `programMeta`.

## Coordinación por asignatura
`programMeta[programId].coordinatorEnabled` habilita el modo de coordinación.
`programMeta[programId].coordinators` almacena claves `cuatrimestre|índice`.

El PDF no imprime Favorito ni Coordinación. Ambos se conservan para la base administrativa/Excel.
