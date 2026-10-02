# Perfil DIN · V94 · Resguardo seguro

Base: `Perfil-DIN-V93-Optimizada.zip` recuperada del paquete previo.

## Archivos que debes sustituir
- `app.js`
- `index.html`

Los archivos `styles.css`, `mobile.css`, `build-cloudflare.sh` y `firestore.rules` se incluyen como referencia de la base V93 y no requieren cambios funcionales para esta corrección.

## Qué corrige V94
- El perfil administrativamente resguardado ya no se vacía ni reinicia localmente.
- `deletedByAdmin:true` conserva `profile`, `answers`, `programMeta`, `planningByPeriod` y estado de finalización.
- Administración sigue viendo los perfiles resguardados.
- Se agrega `Restaurar perfil` sin reconstruir ni sobrescribir datos académicos.
- La acción cambia conceptualmente de “Eliminar perfil completo” a “Resguardar perfil”.
- El resguardo usa un batch atómico: snapshot administrativo + cambio de estado + auditoría.
- Después de resguardar/restaurar un profesor no se vuelve a leer toda la colección de perfiles para refrescar la interfaz.
- Los perfiles resguardados siguen excluidos por defecto del concentrado operativo de exportación.

## No se modifica
- Estructura académica.
- Formato de reportes.
- Lógica de impresión/finalización.
- Datos ya guardados.
- `deploy-pages.yml`.
- Reglas Firestore vigentes.

## Identificación
- `PAD_BUILD_VERSION = V94-2026-10-01`
- `index.html` carga `app.js?v=20261001-94`
