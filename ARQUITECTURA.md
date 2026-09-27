# Arquitectura V13

V13 es deliberadamente conservadora: las modificaciones son de presentación y experiencia de uso.

## Sin cambios
- Firebase Authentication.
- Firestore y reglas.
- Estructura `profiles/{uid}`.
- Configuración global.
- Bloqueo por periodo/formalización.
- X/XX, áreas 1/2/3, Favorito.
- Coordinaciones almacenadas en `programMeta`.
- Troncos comunes y sincronización.
- Catálogo y horas.

## Excel
En `Concentrado perfiles`:
- `★` = Favorito.
- Fuente roja = Coordinó esa asignatura.
- No se colorea el fondo por Favorito o Coordinación.

## Coordinación
Ya no necesita un interruptor visual global en Perfil por programa. El profesor puede marcar directamente la palomita en cada asignatura elegible. Se conserva compatibilidad con los datos de coordinación existentes.
