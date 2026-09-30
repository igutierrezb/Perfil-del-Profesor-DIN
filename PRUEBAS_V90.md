# Pruebas realizadas · V90

Se verificó sobre la V89 consolidada proporcionada en esta conversación.

## Sintaxis y construcción

- `node --check app.js` → correcto.
- `bash -n build-cloudflare.sh` → correcto.
- build de producción con variables de entorno de prueba → genera `dist/build-info.json` con `V90-2026-09-30`.

## Pruebas heredadas del repositorio

- flujo secuencial: 6/6.
- flujo V72: 8/8.
- precedencia/persistencia: 5/5.
- reglas críticas V73: 7/7.

Total heredado: 26 comprobaciones superadas.

## Pruebas específicas V90

20/20 comprobaciones superadas, entre ellas:

- `persist()` no programa escrituras en Firestore;
- reintento automático del perfil desactivado;
- scheduler de autoguardado desactivado;
- detección de cambios por huella;
- no escritura si el contenido no cambió;
- Datos del profesor espera confirmación antes de avanzar;
- cada Programa espera confirmación antes de avanzar;
- `Atrás` no toca Firestore;
- cierre de sesión sin autoguardado en nube;
- advertencia de cambios pendientes al salir;
- finalización requiere confirmación de nube;
- lectura redundante de `sessionWriteSeq` eliminada;
- preservación de campos heredados del perfil;
- corrección V89 de Comisiones conservada;
- estilos móviles V89 conservados;
- candado global e individual conservados.

## Archivos de control

Se comprobó por SHA-256 que V90 **no modifica**:

- `firestore.rules`.
- `.github/workflows/deploy-pages.yml`.
