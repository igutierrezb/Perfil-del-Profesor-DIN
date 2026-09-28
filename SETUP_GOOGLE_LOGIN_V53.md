# Acceso institucional V53 — configuración única

Esta versión ya no usa `perfil-profesor-din.firebaseapp.com/__/auth/handler`. El acceso se realiza con Google Identity Services y después Firebase recibe la credencial directamente.

## 1. Obtener el Client ID

En Google Cloud Console, abra el proyecto **Perfil Profesor DIN / perfil-profesor-din**.

1. Vaya a **APIs y servicios → Credenciales**.
2. En **IDs de cliente de OAuth 2.0**, abra el cliente web existente de Google Sign-In o cree uno de tipo **Aplicación web**.
3. En **Orígenes de JavaScript autorizados**, agregue exactamente:
   - `https://igutierrezb.github.io`
4. No se requiere URI de redirección para este flujo popup/token.
5. Copie el **ID de cliente**, que termina en `.apps.googleusercontent.com`.

## 2. Agregar el secreto en GitHub

Repositorio → **Settings → Secrets and variables → Actions → New repository secret**

- Nombre: `GOOGLE_CLIENT_ID`
- Valor: el Client ID copiado en el paso anterior.

## 3. Actualizar el workflow

Sustituya `.github/workflows/deploy-pages.yml` por el archivo de esta versión y publique los cambios.

## 4. Mantener Firebase

- Google debe seguir habilitado en **Firebase Authentication → Sign-in method**.
- `igutierrezb.github.io` debe continuar en **Authorized domains** de Firebase Authentication.
- No hay cambios en Firestore Rules.

## Qué cambia técnicamente

Antes, Firebase abría un intermediario en `perfil-profesor-din.firebaseapp.com/__/auth/handler`, que su red está reiniciando con `ERR_CONNECTION_RESET`.

V53 abre Google directamente (`accounts.google.com`), obtiene una credencial OAuth y la entrega a Firebase con `signInWithCredential`. Por eso el navegador ya no necesita abrir el dominio `firebaseapp.com` para iniciar sesión.
