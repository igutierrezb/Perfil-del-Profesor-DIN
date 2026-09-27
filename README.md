# Perfil Académico Docente DIN · Versión 22

Ajuste visual final sobre V21, sin cambios a la lógica funcional.

## Cambios
- Guía “Cómo capturar cada asignatura” reorganizada en 5 recuadros homogéneos.
- Asignatura + Habilitación unificadas.
- Se enfatiza que interruptor apagado = no puede impartir y la materia se imprime en blanco.
- Competencia:
  - X = competencia media
  - XX = competencia alta
- Área de conocimiento conserva sus códigos y la banda azul queda en una línea cuando hay espacio.
- Coordinación y Favorito se destacan con aviso, ✓ y ★.
- Coordinación y Favorito indican expresamente que no aparecen en impresión y son referencia para el coordinador.
- Impresión/PDF:
  - filas con altura natural;
  - materias alineadas a la izquierda y centradas verticalmente;
  - X/XX y números centrados horizontal y verticalmente.
- Administración:
  - Control de captura se mantiene antes de Profesores y cierre;
  - botones más pequeños, homogéneos y alineados horizontalmente.

## Deploy
deploy-pages.yml: NO necesita actualización.

## Firestore
firestore.rules: NO necesita actualización respecto a V21.
