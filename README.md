# Perfil Académico Docente DIN · Versión 10

Consolidación de la versión estable, preservando autenticación, captura, troncos comunes, impresión y administración.

## Cambios principales
- Favorito reemplaza el término “Materia ideal”.
- Botón de Favorito más compacto: ☆ Favorito / ★ Favorito.
- Coordinación de academia desactivada por defecto y resaltada en rojo; solo se habilita si el profesor declara haber sido coordinador.
- Excel identifica favoritos con ★ y coordinación con C; coordinación aparece con fondo rojo suave.
- Nueva hoja de Excel “Resumen por asignatura”.
- Excel administrativo consolida todos los profesores cuando Firestore está habilitado.
- Progreso muestra pendientes, favoritos y programas completos.
- Estados pendiente, deshabilitado, revisado y no aplica se distinguen visualmente.
- Instrucciones de captura más grandes y visibles.
- Acrónimos editables desde Administración.
- Autoguardado y hora del último guardado.
- Persistencia central opcional/segura con Firestore.
- Auditoría básica de acciones.
- Fecha y hora límite global definible por Administración.
- Cuenta regresiva para profesores; últimas 24 h en ámbar, últimas 3 h en rojo y vencido en rojo intenso.
- Al vencer, el profesor conserva acceso de consulta e impresión pero no puede editar.
- El administrador puede cerrar inmediatamente, reabrir cambiando la fecha o quitar la fecha límite.
- Impresión conserva tres programas por hoja y aumenta la legibilidad de materias desde la hoja 2.

## Firestore
Consulte `FIRESTORE_SETUP.md` y `firestore.rules`. Si Firestore aún no está habilitado, la aplicación mantiene el funcionamiento local previo.
