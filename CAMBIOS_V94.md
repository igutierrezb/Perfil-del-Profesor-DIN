# Cambios V94

1. Resguardo no destructivo de perfiles.
2. Restauración reversible mediante cambio de estado.
3. Perfil resguardado en solo lectura para el profesor.
4. Perfil resguardado visible para Administración.
5. Snapshot + estado + auditoría en una sola operación atómica de Firestore.
6. Una lectura puntual del perfil afectado al resguardar; sin recarga masiva posterior.
7. Restauración sin lectura de comprobación ni recarga masiva.
8. Se conserva la exclusión de perfiles resguardados del Excel operativo por defecto.
