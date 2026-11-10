# HANDOFF — Sorteo HoF Patrulla Retro

Documento de traspaso: qué es el proyecto, cómo funciona, cómo se trabaja en él
y qué decisiones ha tomado el dueño. Pensado para quien continúe el trabajo
(una persona u otra sesión de Claude). Estado a 1 de noviembre de 2026
(`main` = PR #24 fusionado; PR #25 en curso).

## 1. Qué es

Web del sorteo mensual del juego del mes de La Patrulla Retro (comunidad de
Telegram). Muestra la cuenta atrás, la recreativa con los rodillos, el ganador,
los 5 usuarios que eligen el Arcade del Mes, y tres listas: Ganadores,
Hall of Fame (juegos completados) e Historial. Tiene un panel de admin oculto
(3 clics en el logo) para programar sorteos, copias de seguridad y ajustes.

- Web: https://kb-retro.github.io/Sorteo-HoF-Patrulla-Retro/ (GitHub Pages desde `main`)
- Repositorio de la web: `KB-retro/Sorteo-HoF-Patrulla-Retro`
- Repositorio de copias: `KB-retro/Backups-Sorteo-HoF` (JSON en `backups/AAAA/MM/`)
- Firebase Realtime Database: proyecto `sorteo-hof` (europe-west1)
- Cloudflare Worker: `dawn-band-8bc8.microbiops.workers.dev`
- Canal de Telegram del que se leen listas y juegos: `t.me/s/retrojuegodelmes`

## 2. Arquitectura

```
Navegador (index.html) ──lee──> Firebase (lectura pública de los nodos públicos)
        │                   └─escribe solo con sesión de admin (Firebase Auth)
        ├──> Worker /?url=…      proxy de Telegram (copia de 1 min)
        ├──> Worker /backup      copia en GitHub (solo admins, con su token)
        └──> Google Sheets CSV   lista de juegos ya elegidos (buscador)

Worker (cron) ──> realiza sorteos programados (real y de prueba)
              ──> recordatorio en Telegram 3 h antes del sorteo
              ──> copia automática en GitHub tras cada sorteo real
              ──> anuncia el resultado en Telegram (bot)
              ──> avisa al chat de admins si algo falla
Telegram ──POST /telegram──> Worker: fotos que mencionan a @M_1_c_h_3_l
              ──> se le reenvían por privado con botón «☐ Marcar como apuntado»
              ──> cambia el mes solo 25 h después de un sorteo programado
```

### Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Toda la web (HTML + CSS + JS, ~5.300 líneas). Firebase compat SDK 9.22.0. |
| `worker/worker.js` | Worker de Cloudflare (~850 líneas). **No se despliega solo**: se pega a mano en Cloudflare. |
| `firebase/reglas-database.json` | Reglas de Firebase (se pegan a mano en la consola). |
| `fuentes/` | Fuente pixel art del título (Press Start 2P, licencia OFL). |
| `manifest.webmanifest`, `icono-*.png` | App instalable (PWA). |
| `tests/` | Pruebas automáticas (ver §6). |
| `.github/workflows/pruebas.yml` | Ejecuta las pruebas en cada PR y en cada push a `main`. |

### Nodos de Firebase

| Nodo | Lectura | Contenido |
|---|---|---|
| `sorteo_actual` | pública | Estado del sorteo: `programado`/`procesando`/`error`/`inactivo`, o el resultado (`ganador`, `arcadeGroup`, `revealAt`, `cambioMesAt`, `mesPremio`, `especial`, `premioEspecial`, `rawLines`). |
| `historial_ganadores` | pública | Un registro por ganador (`user`, `ticket`, `fecha`, `timestamp`, `especial`…). Desde noviembre de 2026 también `arcade` (los 5 usuarios) y `participantes` (`[{ user, boletos }]`) para las estadísticas de la ficha. |
| `hall_of_fame_juegos` | pública | `{ "@usuario": { user, total } }` (clave en minúsculas). |
| `regalos` | pública | Usuarios que recibieron camiseta por cesión. |
| `mes_sorteo` | pública | Mes actual ("Noviembre"). Se muestra en la franja de estado. |
| `juegos_proximo_sorteo` | pública | Juegos del Mes y Arcades leídos de Telegram. |
| `config_sorteo_especial` | pública | Casilla "Sorteo Especial" y su premio (persisten entre sorteos). |
| `sorteo_participantes_raw` | pública | Lista de participantes guardada por el admin. |
| `sorteo_privado` | solo admins | Lista negra y registro de descartes del sorteo real. |
| `sorteo_prueba` | solo admins | Tirada de prueba (no toca nada real). |
| `backups` | solo admins | Copias manuales en Firebase. |
| `estado_bot` | nadie (solo el Worker) | `recordatorio`: hora del último sorteo ya recordado en Telegram. |

Escritura: solo los 2 UID de admin (en las reglas y en `UIDS_ADMIN` de la web;
deben coincidir). El registro de cuentas nuevas está desactivado en Firebase Auth.

### Secretos del Worker (en Cloudflare, nunca en el repositorio)

`FIREBASE_SECRET`, `FIREBASE_API_KEY`, `ADMIN_UIDS`, `GITHUB_TOKEN`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` y, opcionales, `TELEGRAM_ADMIN_CHAT_ID`
(avisos de error; el dueño no lo quiere usar) y `TELEGRAM_MENCIONES_CHAT_ID`
(número de chat de @M_1_c_h_3_l para los avisos de menciones con foto). **Nunca pedir al dueño que pegue sus valores en el chat.**
Si falta `ADMIN_UIDS`, `/backup` deniega a todos.

## 3. Cómo funciona un sorteo programado

1. El admin pone el mes, carga la lista (sale sola de Telegram al abrir el
   panel), elige fecha y hora (21:00 por defecto) y pulsa "Guardar y programar".
   Los juegos de la lista se suman al Hall of Fame **al programar** (al
   sustituir o borrar un sorteo se restan los anteriores).
   Cuando faltan 3 h o menos (y al menos 10 min), el bot publica un
   recordatorio en el canal (una sola vez por sorteo; lo apunta en `estado_bot`).
2. A la hora, el cron del Worker bloquea el sorteo con ETag/If-Match
   (`procesando` + `tiradaPendiente`), elige ganador con `crypto.getRandomValues`
   (sin sesgo), guarda historial con clave fija `sorteo_<targetTime>_<timestamp>`
   y escribe el resultado con `revealAt` = ahora + 30 s. Si se queda a medias,
   otra pasada del cron lo retoma a los 5 min reutilizando el mismo ganador.
3. La web muestra los rodillos con el número premiado y una cuenta atrás de
   30 s (con la hora del servidor de Firebase); el historial no destripa al
   ganador hasta entonces.
4. Copia automática en GitHub y, tras la revelación, mensaje del bot en
   Telegram con ganador, boleto, premio especial (si lo hay) y los 5 del Arcade.
   Si falla el historial, el resultado, la copia, el anuncio o el cambio de
   mes, el bot avisa a `TELEGRAM_ADMIN_CHAT_ID`.
5. 25 h después (`cambioMesAt`), el Worker pasa al mes siguiente y deja el
   sorteo `inactivo` (escritura condicional: no pisa un sorteo recién
   programado y nunca avanza el mes dos veces). La web carga sola los juegos
   del mes nuevo desde Telegram.

Sorteo inmediato (sin hora): lo hace la propia web, sin cuenta atrás, sin
Telegram y sin cambio de mes automático. Tirada de prueba: solo la ven los
admins; ni historial, ni Hall of Fame, ni copia, ni Telegram.

### Avisos de menciones con foto

- Con `TELEGRAM_MENCIONES_CHAT_ID` configurado, el cron conecta el bot con el
  Worker (`setWebhook` a `/telegram`, solo `message` y `callback_query`). Si el
  bot ya enviaba a otra URL no la toca. La clave del webhook se deriva del token.
- Mensaje de grupo con imagen (foto o archivo de imagen) que menciona a
  `USUARIO_MENCIONES` → `forwardMessage` + aviso con enlace y botón. El botón
  edita el aviso a «✅ Apuntado el …» y permite desmarcar. No se guarda nada.
- El bot tiene que ser administrador del supergrupo para leer todos los mensajes.
- Uso: 1 petición por mensaje del grupo; el Worker usaba ~1.430/día de 100.000.

## 4. Despliegue

- **Web**: fusionar el PR en `main` → GitHub Pages publica en 1–2 min.
- **Worker**: el dueño copia `worker/worker.js` y lo pega en Cloudflare
  (Workers → `dawn-band-8bc8` → Edit code → Deploy). Mandarle el archivo como
  `.js` y `.txt` (desde el móvil no siempre puede abrirlo en GitHub). Hasta que
  lo suba, la web debe seguir funcionando con el Worker anterior: cada cambio
  se ha hecho compatible en los dos sentidos.
- **Reglas de Firebase**: se pegan a mano en la consola (Realtime Database → Reglas).

## 5. Forma de trabajar con el dueño

- Escribe en **español** y espera respuestas **en español** (se ha quejado
  dos veces de respuestas en inglés).
- **No modificar nada sin consultarle**: primero se explica la propuesta y
  él decide. Le gusta poder **revertir**.
- Cada cambio va en un **PR** desde la rama de trabajo, con pruebas en verde,
  descripción en español y **capturas** (PC y móvil) cuando es visual.
- Tras fusionar, la rama de trabajo se reinicia desde `main`.
- Explicar los pasos manuales (subir Worker, Firebase) de forma muy concreta.

## 6. Pruebas

```
cd tests
npm install
npx playwright install chromium
npm test        # web.test.cjs (Chromium + Firebase simulado) y worker.test.mjs
```

- Web: ~214 comprobaciones; Worker: ~85. Todo debe acabar en `TODO OK`.
- `tests/fakefb.js` simula Firebase y Auth (`admin@test.es` / `buena` es admin;
  `otro@test.es` / `buena` es una cuenta sin permisos).
- Las pruebas nuevas de la web se insertan antes de la línea
  `// Visitor doesn't write Telegram list` de `web.test.cjs`.
- Al probar algo nuevo, comprobar que la prueba **fallaría sin el cambio**.

## 7. Historial de cambios (PRs fusionados)

| PR | Qué |
|---|---|
| #1–#4 | Seguridad fases 1–3: Firebase Auth en vez de contraseña en el HTML, reglas por UID, `/backup` autenticado, CORS, sesión que se cierra al recargar, lista negra privada, bloqueo ETag del sorteo. |
| #5–#7 | Rodillos con 30 s de revelación (solo programados), pruebas automáticas, ganadores sin distinguir mayúsculas. |
| #8–#9 | Bot de Telegram con resultado y Arcade; tiradas de prueba solo para admins y sin Telegram. |
| #10–#12 | Diseño adaptable (pestañas en móvil, dos columnas en PC), buscador global, ficha de usuario, franja de estado, barra de accesos, podio, PWA, panel de admin reorganizado en 4 pasos. |
| #13–#14 | En PC, columnas a la misma altura; recreativa del tamaño de la tarjeta del ganador; instrucciones siempre abiertas. |
| #15 | Título "Hall of Fame Patrulla Retro" en pixel art; el mes pasa a la franja de estado. |
| #16 | Revisión: bloqueo del cambio de mes con sorteo activo, "EXTRA" en nombres, año del premio, hora del servidor, caché de Telegram en el Worker, etc. |
| #17 | `/backup` deniega sin `ADMIN_UIDS`, panel solo para los UID admin, `fresco=1` solo para admins, grupo Arcade por posición, copias con segundos. |
| #18 | Escape cierra cualquier ventana, @Pepe/@pepe juntos en participantes, buscador de juegos. |
| #19 | Buscador en el Historial. |
| #20 | Cambio de mes automático 25 h después de un sorteo programado. |
| #21 | El bot anuncia también a los del Arcade en los Sorteos Especiales. |
| #22 | Imágenes WebP, copias más completas, avisos de error al chat de admins, recordatorio en Telegram, aviso de Sorteo Especial al programar, botón Compartir y estadísticas en la ficha. |
| #23 | Avisos por privado a @M_1_c_h_3_l cuando le mencionan con fotos, con botón de apuntado. |
| #24 | La app instalada se puede girar a horizontal (consolas portátiles). |
| #25 | Lista de participantes al día: la de Telegram no la pisa una lectura vieja de Firebase y se vuelve a leer al volver a la web tras 30 s en segundo plano. |

## 8. Decisiones del dueño (no volver a proponer sin motivo)

- **Lista negra**: no se usa (era del sorteo antiguo; ahora se puede volver a
  ganar). No tocar su lógica aunque acepte nombres sin @ o no se recargue en el panel.
- **Empates en Ganadores/HoF** (medallas por orden de lista): se deja así.
- **Spoiler en el caso raro de retomar un sorteo atascado**: se deja así.
- **La lista de Telegram sustituye a la editada a mano al abrir el panel**,
  restaurar una copia antigua puede disparar el cambio de mes, y los visitantes
  ven la lista de Telegram y no la del sorteo: el dueño no lo ve necesario.
- **Cuenta de servicio de Firebase** (en vez de `FIREBASE_SECRET`): descartada.
- **Diseño PC** con bloque principal arriba a todo el ancho: rechazado; se
  mantiene sorteo a la izquierda y listas a la derecha, panel de admin a todo el ancho.
- Los Sorteos Especiales **sí** tienen grupo Arcade (web y Telegram) y también
  disparan el cambio de mes automático.

## 9. Pendiente / a comprobar

- Confirmar que el dueño ha subido a Cloudflare el Worker de `main`
  (con el cambio de mes automático y el Arcade en especiales).
- El sorteo del 29/10/2026 (@Jj4vy, "Magia para Suis") salió como
  **Sorteo Especial**. Si debía ser normal, corregir a mano en Firebase
  `especial: false` y `premioEspecial: ""` en su entrada de `historial_ganadores`
  y en `sorteo_actual`.
- La casilla "Sorteo Especial" sigue marcada entre sorteos, pero desde el
  PR #22 la confirmación avisa claramente de que será Especial.
- Opcional: rellenar las estadísticas de la ficha con los sorteos anteriores
  (agosto, septiembre y octubre de 2026) a partir de las copias de GitHub.
