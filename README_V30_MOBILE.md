# Perfil Profesor DIN · V30 Mobile

## Qué cambia
- Se conserva el diseño y funcionamiento de escritorio.
- Se añade una capa responsive exclusiva para teléfonos (<= 780 px).
- En móvil:
  - acceso y encabezado compactos;
  - navegación horizontal táctil;
  - formularios de una columna;
  - materias convertidas en tarjetas táctiles sin scroll horizontal;
  - botones con áreas táctiles mayores;
  - Administración reorganizada a una columna;
  - vista previa de impresión permite desplazamiento horizontal sin alterar el PDF.
- Se integra la identidad DIN final recuperada del paquete de marca:
  - logo-din-horizontal.png
  - icon-din.png
  - favicon.ico / 16 / 32
  - apple-touch-icon.png
  - icon-192.png / icon-512.png
- El logo UTEQ del formato de impresión NO se modifica.

## Importante sobre FortiGate
La pantalla “Application Blocked · Github · Storage.Backup” es un bloqueo del dominio
`igutierrezb.github.io` por la política de seguridad de la red/dispositivo. No es un problema
de compatibilidad móvil y no puede resolverse con CSS o JavaScript del sitio.

## Deploy
`deploy-pages.yml`: SÍ debe actualizarse, porque debe copiar los nuevos archivos de identidad
y `manifest.webmanifest` al directorio `dist`.
