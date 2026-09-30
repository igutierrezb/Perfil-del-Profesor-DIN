# Cambios V91 · Sesión y permisos

- Eliminados los heartbeats periódicos de 45 s.
- La sesión se renueva al reclamarla y, como máximo, después de guardados manuales cuando han pasado al menos 3 minutos desde la última renovación.
- Las sesiones V91 usan una concesión de 8 minutos; registros heredados V90 se consideran vencidos con el criterio anterior de 2 minutos para facilitar la transición.
- Se agrega `activeDeviceId` estable por navegador/dispositivo, sin datos personales, para recuperar automáticamente una sesión del mismo equipo.
- Si `activeSessionId` está vacío, ya no aparece el modal de «otro dispositivo».
- Una sesión vencida se recupera automáticamente.
- El botón «Continuar edición aquí» toma directamente el control; ya no espera una respuesta del dispositivo anterior.
- El dispositivo anterior recibe el cambio mediante `onSnapshot`, conserva su borrador local y pasa a solo lectura.
- Eliminado el flujo visual «Recuperar edición aquí» porque era redundante y podía quedar bloqueado.
- El permiso administrativo y la sesión del dispositivo quedan separados.
- `individualEditDisabled=true` mantiene prioridad absoluta y bloquea.
- `individualEditEnabled=true` funciona como autorización explícita del JUCA y prevalece sobre cierre general, fecha límite y perfil finalizado.
- Los mensajes de bloqueo ahora informan la causa real: Administración, finalización, fecha, inicialización o sesión de otro dispositivo.
- El modal es más directo y adaptado a móvil.
- Se conserva el guardado manual V90: Atrás/Adelante no escriben por sí solos; «Guardar y continuar» sólo escribe cuando corresponde.
