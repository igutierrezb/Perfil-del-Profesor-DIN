# Arquitectura V6

## Autenticación
Firebase Authentication con Google.
- Usuarios permitidos: `@uteq.edu.mx`
- Administrador: `ivan.gutierrez@uteq.edu.mx`
- La aplicación permanece detrás de la compuerta de login.

## Configuración Firebase
La configuración real ya no se almacena en el repositorio.
GitHub Actions genera `firebase-config.js` durante el despliegue usando:
- FIREBASE_API_KEY
- FIREBASE_AUTH_DOMAIN
- FIREBASE_PROJECT_ID
- FIREBASE_APP_ID

## Datos
Se conserva el modelo existente de V5:
- perfil,
- respuestas por materia,
- troncos comunes,
- coordinaciones,
- materias ideales,
- catálogo y programas añadidos,
- exportación administrativa.

## Impresión
- primera hoja: datos profesionales;
- hojas posteriores: dos programas por hoja;
- un bloque de firma y sello por hoja;
- encabezados de tabla pastel;
- nivel y área en columnas estrechas;
- mayor espacio previo a firmas;
- logo institucional azul.
