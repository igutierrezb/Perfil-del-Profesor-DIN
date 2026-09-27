# Perfil Académico Docente DIN · Versión 6

Versión conservadora: mantiene la lógica funcional y concentra los cambios en autenticación segura de despliegue,
acabado visual e impresión.

## Mejoras V6
- Acceso a la plataforma únicamente después de autenticación institucional.
- Administración visible solo para `ivan.gutierrez@uteq.edu.mx`.
- API key eliminada del código fuente del repositorio.
- Despliegue de GitHub Pages mediante Actions + Secrets.
- Tipografía del perfil por programa con menos negritas.
- Periodo de vigencia bajo el título principal.
- Ícono industrial renovado.
- Logo UTEQ de impresión recoloreado en azul y alineado con el nombre institucional.
- Nombre, categoría, competencia y área centrados en hojas de programas.
- Contenido de tablas alineado hacia la parte inferior.
- Bordes reforzados para impresión.
- Encabezados de cada programa con tonalidades pastel.
- Zona de firma y sello desplazada hacia abajo para dar mayor espacio de firma.

## Archivos a sustituir
- `index.html`
- `styles.css`
- `app.js`
- `catalog.js`
- `firebase-config.js`
- `logo-uteq.png`
- `logo-uteq-blue.png`
- `icono-industria.svg`
- `README.md`
- `ARQUITECTURA.md`

## Archivos nuevos
- `.github/workflows/deploy-pages.yml`
- `SETUP_FIREBASE_GITHUB.md`

Lea `SETUP_FIREBASE_GITHUB.md` antes de volver a probar el inicio de sesión.
