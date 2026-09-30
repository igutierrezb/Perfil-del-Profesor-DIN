# Pruebas de aceptación · V82

## 1. Migración directa V80 → V82
- Sustituir los seis archivos sin instalar V81.
- Abrir un perfil existente.
- Confirmar que nombres, formación, experiencia, respuestas, coordinación, favoritas, comisiones y finalización siguen presentes.

## 2. Sesión única
- Abrir el mismo profesor en computadora.
- Abrir después el mismo profesor en móvil.
- Confirmar que el móvil toma la edición y la computadora queda en solo lectura.
- Hacer el proceso inverso.
- Verificar que no existan dos dispositivos escribiendo simultáneamente.

## 3. Comisiones opcionales
- Dejar sin capturar comisión.
- Pulsar continuar desde Datos del profesor.
- Debe aparecer una confirmación para avanzar sin comisión.
- Cancelar: debe permanecer en Datos.
- Aceptar: debe poder continuar, siempre que el resto de datos aplicables esté completo.

## 4. Experiencia laboral incompleta
- En una línea adicional escribir solo la organización.
- Intentar continuar.
- Debe bloquearse el avance y señalar puesto/cargo y periodo.
- Completar ambos campos y volver a continuar.

## 5. Manual de Perfil
- Pasar de Datos a Perfil: debe mostrarse el manual.
- Regresar a Datos con Atrás.
- Volver a Perfil: el manual debe mostrarse otra vez.

## 6. Orden de programas
Comprobar estrictamente: Procesos Productivos → Moldeo de Plásticos → Mecánica Automotriz → Mecánica Industrial → Moldes y Troqueles → Diseño y Manufactura Automotriz → Mantenimiento Industrial → Nanotecnología.

## 7. Guardar avances
- Dejar materias pendientes.
- Pulsar `Guardar avances` arriba y después abajo.
- Debe guardar y permanecer en el mismo programa.
- Recargar la página y confirmar que la captura permanece.

## 8. Guardar y continuar
- Con materias pendientes, pulsar `Guardar y continuar`.
- No debe avanzar.
- Debe marcar visualmente las materias incompletas y llevar la atención a la primera.
- Al completar todas las obligatorias, debe permitir avanzar.

## 9. Coordinador y Favorita
- Dejar ambas columnas vacías en todas las materias.
- Completar competencia y área de conocimiento.
- Debe permitir continuar sin alertas por Coordinador o Favorita.

## 10. Navegación
- Durante edición, comprobar que los indicadores superiores no permiten saltarse la secuencia.
- Usar Atrás para regresar de Perfil a Datos y desde Revisión a Perfil.
- Confirmar que los datos no se pierden.

## 11. Revisión e impresión
- Completar los ocho programas.
- Confirmar la tarjeta de verificación previa.
- Abrir Revisión e impresión.
- Comprobar que EA-F-86, impresión/PDF e informes administrativos continúan funcionando.

## 12. Móvil
- Repetir pruebas 3, 5, 7 y 8 en teléfono.
- Confirmar que ambos botones de guardado sean visibles y utilizables sin desplazamiento horizontal de la interfaz de acciones.

## 13. Firestore
- Publicar `firestore.rules` V82.
- Confirmar que `profileSessions/{uid}` se crea al entrar.
- Confirmar que una sesión que perdió el control no puede seguir sincronizando cambios del profesor.
