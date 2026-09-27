# Arquitectura V10

## Capa local
`localStorage` se conserva como respaldo inmediato y permite que la aplicación siga operando si Firestore no está disponible.

## Capa central Firestore
- `settings/app`: configuración global, fecha límite, estado de edición, programas activos, programas personalizados y acrónimos.
- `profiles/{uid}`: perfil vigente del profesor; se sobrescribe con la versión actual.
- `audit/{id}`: registro básico de acciones relevantes.

No se crea histórico anual: el perfil vigente se actualiza/sobrescribe, conforme a la decisión funcional del proyecto.

## Cierre de captura
`cfg.captureDeadline` guarda un timestamp. Cuando vence:
- profesores: solo consulta/impresión;
- administrador: conserva edición;
- el contador cambia a “CAPTURA FUERA DE TIEMPO”.

## Excel
- Concentrado perfiles.
- Base maestra.
- Catálogo.
- Resumen por asignatura.
Marcas: `★` favorito y `C` coordinador de academia.
