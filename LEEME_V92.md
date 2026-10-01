# Perfil del Profesor DIN · V92 · Control definitivo

## Objetivo principal
Eliminar definitivamente el bloqueo falso por dispositivo y hacer determinante el candado administrativo de edición.

## Archivos a sustituir en GitHub
- `app.js`
- `index.html`
- `styles.css`
- `mobile.css` (se incluye para mantener el paquete acumulativo; su contenido funcional no cambia)
- `build-cloudflare.sh`
- `firestore.rules`

## Paso adicional OBLIGATORIO
`firestore.rules` no se publica con GitHub ni con Cloudflare. Después de sustituir los archivos:
1. Abra Firebase Console.
2. Firestore Database → Rules.
3. Sustituya las reglas por el contenido de `firestore.rules` V92.
4. Pulse **Publish / Publicar**.

Sin este paso, un documento heredado de `profileSessions` puede seguir bloqueando escrituras aunque la interfaz V92 ya no use sesiones por dispositivo.

## deploy-pages.yml
**NO SE ACTUALIZA.**

## Comportamiento V92
- Teléfonos y tabletas: la aplicación no inicia autenticación ni Firestore; sólo muestra el aviso de uso en computadora.
- Computadora: no existe candado por dispositivo ni modal de transferencia.
- `Guardar y continuar`: si hubo cambios, escribe una vez; si no hubo cambios, sólo avanza.
- `Anterior`: no escribe.
- Se eliminan botones intermedios de guardar Datos, Formación, Experiencia docente, Experiencia laboral, Comisiones y `Guardar avances`.
- El último `Guardar y continuar` confirmado en nube es la referencia.
- Administración: habilitar/deshabilitar edición tiene timeout, confirmación directa contra servidor y siempre libera el botón.
- Los datos académicos existentes no se eliminan ni migran.
