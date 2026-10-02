# Perfil DIN · V95 · Blindaje e integridad

Fecha: 1 de octubre de 2026

## Alcance
Actualización mínima sobre V94. No cambia estructura académica, reportes, impresión, Excel, programas, X/XX, áreas, favoritas, coordinaciones ni planeación.

## Cambios
1. **Borrado físico de perfiles bloqueado por reglas**: `profiles/{uid}` ya no admite `delete` desde clientes, ni siquiera para Administración. El flujo sigue siendo Resguardar → Restaurar.
2. **Auditoría atribuible**: cada alta en `/audit` debe llevar el mismo UID y correo de la sesión autenticada.
3. **Reinicio de asignaturas atómico**: una lectura puntual + un único batch que crea respaldo, reinicia `answers/programMeta` y registra auditoría. Ya no recarga toda la colección de profesores.
4. **Restauración atómica**: estado del perfil + auditoría se confirman juntos.
5. **Texto administrativo corregido**: la interfaz ya describe “Resguardar perfil” como una acción no destructiva.

## Archivos a sustituir
- `app.js`
- `index.html`
- `firestore.rules`

`deploy-pages.yml` no se modifica.

## Importante
Como V95 sí modifica `firestore.rules`, además de subir los archivos al repositorio es necesario publicar esas reglas en Firebase (por la consola o mediante el mecanismo de despliegue de reglas que utilice el proyecto).
