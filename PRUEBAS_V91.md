# Pruebas V91

## Verificaciones automáticas ejecutadas

- `node --check app.js`: correcto.
- `bash -n build-cloudflare.sh`: correcto.
- Construcción completa de `dist/` con variables de entorno de prueba: correcta.
- `test_flow_v72.py`: 8/8.
- `test_persistence_logic.py`: 5/5.
- `test_flow_sequence.py`: 6/6.
- `test_v73_logic.py`: 7/7.
- Total heredado: 26 comprobaciones superadas.

## Comprobaciones específicas V91

1. No existe `setInterval(heartbeatSession, ...)`.
2. Un documento sin `activeSessionId` se reclama; no abre el modal.
3. Un registro V90 antiguo conserva compatibilidad y vence con 120 s.
4. Una sesión V91 usa concesión de 8 min.
5. El mismo dispositivo se reconoce mediante `activeDeviceId`.
6. «Continuar edición aquí» usa toma directa de sesión (`force:true`).
7. El dispositivo anterior pasa a solo lectura por `onSnapshot`.
8. El borrador visible se conserva localmente antes de perder el control.
9. El bloqueo individual administrativo tiene prioridad.
10. La habilitación individual prevalece sobre fecha, cierre global y finalización.
11. No se modifica `firestore.rules`.
12. No se modifica `.github/workflows/deploy-pages.yml`.
13. `index.html`, `app.js` y `build-info.json` quedan identificados como V91.
14. El modal utiliza una acción principal única y botones de ancho completo en móvil.
15. La lógica de guardado manual de V90 se conserva.

## Pruebas de aceptación recomendadas después de publicar

A. Profesor sin otra sesión: ingresar y confirmar que NO aparece el modal.
B. Cerrar navegador y volver a abrir en el mismo equipo: debe recuperar edición automáticamente.
C. Abrir una segunda computadora mientras la primera está activa: debe aparecer el modal.
D. Pulsar «Continuar edición aquí»: la segunda debe editar; la primera debe quedar en solo lectura.
E. Administración deshabilita un profesor: el usuario debe bloquearse en tiempo real.
F. Administración habilita al mismo profesor: debe desbloquearse en tiempo real si este dispositivo tiene el control.
G. Perfil finalizado: habilitar individualmente y comprobar que vuelve a ser editable.
H. Con fecha límite vencida: habilitar individualmente y comprobar que puede editar.
I. Móvil: repetir A, C, D, E y F.
J. Modificar una página y navegar Atrás sin guardar: no debe escribirse en la nube.
K. Pulsar «Guardar y continuar»: debe confirmar guardado y avanzar.
