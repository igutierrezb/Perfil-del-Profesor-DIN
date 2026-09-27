# Perfil Académico Docente DIN · Versión 21

Actualización visual y corrección de control de edición.

## Cambios
- Ejemplos de captura en gris en Datos del profesor.
- Periodos muestran ejemplos como `sep 2023 - ago 2025`.
- La explicación general de competencia se integró al punto 3 de “Cómo capturar”.
- Programas educativos: controles estandarizados y con código de color para Acrónimo, Editar, Tronco común y Estado.
- Administración ya no inicia con la tarjeta “Configuración y base maestra”.
- Troncos comunes quedan integrados al mismo módulo de Programas educativos.
- Corrección de edición individual:
  - `individualEditEnabled` permite habilitar solamente a un profesor;
  - funciona incluso cuando la edición general está desactivada;
  - Finalizar e imprimir vuelve a quitar esa habilitación;
  - Administración puede volver a deshabilitar el permiso individual.
- El control global de edición espera el guardado en Firestore antes de confirmar visualmente el cambio.
- Mensajes de error de edición individual incluyen el código de Firestore para facilitar diagnóstico.

## IMPORTANTE: Firestore
SÍ debe publicarse `firestore.rules` V21.

La regla crítica es:
`allow create, update: if admin() || (institutional() && request.auth.uid == uid);`

## Deploy
`deploy-pages.yml`: NO necesita actualización.
