# Perfil Académico Docente DIN · Versión 27

Actualización exclusivamente visual del botón de exportación.

## Cambio
- `Exportar a Excel` ahora utiliza un diseño inspirado en la identidad visual de Excel / Microsoft 365:
  - verde Excel;
  - ficha blanca para el icono;
  - mayor tamaño y jerarquía tipográfica;
  - subtítulo `Libro de Microsoft Excel · .xlsx`;
  - relieve y estados hover/active;
  - selector CSS de mayor especificidad para evitar que las reglas generales de Administración vuelvan a pintarlo de azul.

No se modifica la función `exportExcel()` ni ninguna lógica del sistema.

## Deploy
`deploy-pages.yml`: NO necesita actualización.

## Firestore
`firestore.rules`: NO necesita actualización.
