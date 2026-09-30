# Diagnóstico consolidado · V90

La V89 resolvía el error funcional de Comisiones y reforzaba el control de edición, pero todavía mantenía varios caminos de escritura automática del documento `profiles/{uid}`: debounce de captura, reintentos al recuperar conexión, sincronización al obtener la sesión y checkpoints al cerrar sesión.

Para un formulario de captura breve por pantalla, esos mecanismos agregaban escrituras y complejidad sin aportar una ventaja proporcional. V90 cambia el modelo a **borrador local + commit manual confirmado**.

El cambio se diseñó sin alterar el esquema de Firestore ni los datos ya almacenados. La detección de cambios se hace en cliente mediante una huella estable del contenido académico. Así, un profesor puede navegar cientos de veces sin generar escrituras del perfil; solo una modificación real seguida de una acción de guardado manual produce un `setDoc`.

El candado administrativo continúa en tiempo real: la configuración global y los campos individuales de edición siguen observándose mediante los listeners existentes. Por tanto, reducir escrituras del perfil no sacrifica la capacidad de Administración para cerrar o reabrir la edición.
