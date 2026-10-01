# Pruebas V92

Se realizaron las siguientes verificaciones sobre la versión consolidada:

1. `node --check app.js` — sintaxis JavaScript correcta.
2. `bash -n build-cloudflare.sh` — sintaxis del build correcta.
3. `test_flow_sequence.py` — 6 comprobaciones superadas.
4. `test_flow_v72.py` — 8 comprobaciones superadas.
5. `test_persistence_logic.py` — 5 comprobaciones superadas.
6. `test_v73_logic.py` — 7 comprobaciones superadas.
7. Build completo con variables de entorno de prueba — `dist/` generado correctamente.
8. `dist/build-info.json` — versión `V92-2026-09-30` confirmada.
9. Verificación HTML — eliminados los botones de guardado intermedios y `Guardar avances`.
10. Verificación HTML — permanece `Guardar y continuar al perfil por programa`.
11. Verificación HTML — modal de transferencia entre dispositivos eliminado.
12. Verificación HTML/CSS — aviso exclusivo para teléfono/tableta incluido.
13. Verificación de app — `sessionCanWrite()` ya no depende de `profileSessions`.
14. Verificación de reglas — las escrituras del profesor ya no requieren coincidencia con `activeSessionId`.
15. Verificación administrativa — el botón de habilitar/deshabilitar tiene timeout, `finally` y confirmación mediante `getDocFromServer()`.

## Pruebas funcionales recomendadas después de publicar

- Profesor habilitado: iniciar sesión en una computadora y confirmar que puede editar sin mensaje de otro dispositivo.
- Profesor deshabilitado: confirmar que queda en solo lectura y que `Guardar y continuar` no escribe.
- Administración: deshabilitar y volver a habilitar un perfil; el botón debe terminar la operación o mostrar error en un máximo acotado, nunca quedar girando indefinidamente.
- Abrir el sitio en teléfono/tableta: sólo debe aparecer el mensaje de uso en computadora y no debe abrirse Google Sign-In.
- Modificar una sección y pulsar `Guardar y continuar`: debe escribir y avanzar.
- Regresar con `Anterior` sin modificar: no debe producir una nueva escritura.
- Avanzar nuevamente sin modificar: debe informar que no hubo cambios nuevos y avanzar sin escribir.
