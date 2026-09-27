# Perfil Académico Docente DIN · Versión 12

Actualización incremental sobre V11, conservando autenticación, Firestore, perfil vigente, impresión, troncos comunes y administración.

## Cambios V12
- Nuevo logotipo circular, juvenil y más elaborado, con engrane, brazo robótico, fábrica y detalles digitales.
- Wordmark UTEQ reconstruido con separación interna mucho mayor entre `UTEQ` y `UNIVERSIDAD TECNOLÓGICA DE QUERÉTARO`.
- Área de conocimiento más compacta y encabezado en dos líneas.
- Nueva columna `Coordinación` antes de `Favorito`.
- Coordinación deshabilitada por defecto; solo se habilita después de declarar que se ha sido coordinador(a) de academia.
- Cada asignatura puede marcarse individualmente con una palomita de coordinación.
- Mensaje permanente: `Solo habilitar si has sido coordinador(a) de academia previamente`.
- Favorito corregido para mostrar exactamente una estrella: `☆ Favorito` / `★ Favorito`.
- Se elimina el botón administrativo redundante `Cerrar ahora`; se conservan el control de edición y la fecha límite.
- Se elimina el segundo botón redundante de `Continuar a revisión e impresión` al final de Perfil por programa.
- `Guardar todo el perfil` cambia a `Guardar avance`.
- Después de `Imprimir / Guardar PDF`, el profesor decide:
  - Aceptar: formaliza el perfil y bloquea edición para el periodo actual.
  - Cancelar: continúa editando.
- El bloqueo posterior a impresión se libera automáticamente cuando Administración cambia el periodo, sin borrar ningún dato capturado.
