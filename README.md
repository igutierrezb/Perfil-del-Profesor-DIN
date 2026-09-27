# Perfil Académico Docente DIN · Versión 4

## Sustituir en GitHub
- index.html
- styles.css
- app.js
- catalog.js
- logo-uteq.png
- icono-industria.svg

## Agregar
- firebase-config.js

## Cambios principales
- Experiencia laboral en una sola línea por organización.
- Bloque visual rojizo de instrucciones.
- Área del conocimiento con opciones 1, 2, 3, 12, 13, 23 y 123 en una sola línea.
- Flujo secuencial por programa: Guardar y seguir al siguiente.
- Impresión con columnas proporcionales y encabezados verticales para Nivel y Área de competencia.
- Logo UTEQ + texto institucional azul en impresión.
- Datos de Calidad en tres líneas limpias.
- Nombre, categoría, competencia y área centrados en una sola línea en hojas de programas.
- Autenticación preparada para cuentas @uteq.edu.mx.
- Administración restringida a ivan.gutierrez@uteq.edu.mx cuando Firebase esté configurado.

## Activar autenticación
1. Cree un proyecto Firebase.
2. Active Authentication > Sign-in method > Google.
3. Agregue el dominio de GitHub Pages a Authorized domains.
4. En Project settings > Your apps > Web app copie `apiKey`, `authDomain`, `projectId` y `appId`.
5. Péguelos en `firebase-config.js`.

Mientras `firebase-config.js` esté vacío, la plataforma funciona en modo local para pruebas.
