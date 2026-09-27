# Configuración única de Firestore · V10

La V10 funciona en modo local si Firestore todavía no está habilitado, pero las funciones globales requieren Firestore:
- fecha límite global;
- cierre global de edición;
- perfiles centralizados;
- Excel de todos los profesores;
- auditoría básica;
- sincronización entre equipos.

## Pasos
1. Firebase Console → proyecto `Perfil Profesor DIN`.
2. Build → Firestore Database.
3. Crear base de datos.
4. Elegir una región apropiada y continuar.
5. Abrir la pestaña **Rules**.
6. Reemplazar las reglas por el contenido de `firestore.rules`.
7. Publicar las reglas.
8. No cambie los cuatro GitHub Secrets existentes.

No necesita cambiar el workflow de GitHub Pages para usar Firestore.
