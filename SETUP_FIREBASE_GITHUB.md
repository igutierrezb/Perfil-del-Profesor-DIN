# Activar Firebase sin publicar la API key en el repositorio

Esta versión evita guardar la configuración real de Firebase en `firebase-config.js`.
El despliegue de GitHub Pages la genera automáticamente con GitHub Actions Secrets.

## 1. En GitHub
Abra:

`Repository > Settings > Secrets and variables > Actions > New repository secret`

Cree exactamente estos cuatro Secrets:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_APP_ID`

Copie cada valor directamente desde Firebase Console > Project settings > Your apps > Web app.

**No copie los valores a `firebase-config.js`.**

## 2. Cambiar GitHub Pages a Actions
Abra:

`Repository > Settings > Pages`

En **Build and deployment > Source**, seleccione:

`GitHub Actions`

## 3. Subir el workflow
La carpeta incluida en esta versión es:

`.github/workflows/deploy-pages.yml`

Al hacer commit en `main`, GitHub Actions:
1. toma los cuatro Secrets;
2. genera `firebase-config.js` solo para el artefacto publicado;
3. publica la página.

## 4. Firebase Authentication
Debe mantenerse:
- Proveedor Google habilitado.
- Dominio autorizado: `igutierrezb.github.io`.
- Dominio permitido en la app: `uteq.edu.mx`.
- Administrador: `ivan.gutierrez@uteq.edu.mx`.

## 5. Sobre la alerta de GitHub
La alerta apareció porque la API key de Firebase se había escrito directamente en el repositorio.
Esta versión deja ese archivo vacío y usa Secrets para el despliegue, por lo que los siguientes commits
ya no contienen la API key en el código fuente.

La alerta histórica puede seguir apareciendo porque el valor existió en un commit anterior. Puede revisarse
desde GitHub Security > Secret scanning y marcarse como resuelta después de confirmar la nueva configuración.
