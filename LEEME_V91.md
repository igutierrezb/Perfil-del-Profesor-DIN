# Perfil del Profesor DIN · V91

## Archivos que debe sustituir en GitHub

Sustituya únicamente estos archivos de la raíz:

1. `app.js`
2. `index.html`
3. `styles.css`
4. `mobile.css`
5. `build-cloudflare.sh`

## Archivos que NO debe cambiar

- `firestore.rules`
- `catalog.js`
- `firebase-config.js`
- `wrangler.jsonc`
- imágenes, iconos y logotipos
- `.github/workflows/deploy-pages.yml`

### deploy-pages.yml

**NO SE ACTUALIZA.**

## Qué corrige

V91 corrige el falso aviso de sesión abierta en otro dispositivo y el bloqueo que permanecía aunque Administración hubiera habilitado la edición. Elimina el handshake que esperaba respuesta del equipo anterior y lo sustituye por control explícito y directo.

## Comportamiento esperado

- Si se abre nuevamente desde el mismo navegador/dispositivo, recupera la edición automáticamente.
- Si la sesión anterior ya venció, recupera la edición automáticamente.
- Si existe otro dispositivo realmente activo, aparece «Continuar edición aquí» o «Continuar en solo lectura».
- «Continuar edición aquí» debe activar la edición en este equipo sin esperar al anterior.
- El equipo anterior pasa a solo lectura cuando recibe el cambio de Firestore.
- Habilitar individualmente a un profesor desde Administración permite editar incluso si el perfil estaba finalizado, venció la fecha o el cierre general está activo.
- Deshabilitar individualmente mantiene el perfil bloqueado hasta una nueva habilitación administrativa.

## Importante sobre cambios no guardados

V90/V91 trabajan con guardado manual. Si se cambia de dispositivo, sólo están garantizados en la nube los datos que se hayan confirmado mediante «Guardar y continuar». Un borrador todavía no guardado permanece únicamente en el equipo donde se escribió.
