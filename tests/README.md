# Pruebas automáticas

Comprueban la web (`index.html`) y el Worker (`worker/worker.js`) sin tocar
Firebase, Cloudflare, GitHub ni Telegram reales: todo se simula.

- `worker.test.mjs`: sorteos programados, Lista Negra privada, bloqueo y
  retoma, `/backup`, proxy de Telegram y avisos al canal.
- `web.test.cjs`: abre la web en Chromium con un Firebase simulado
  (`fakefb.js`) cargado con `fixtures/backup.json` y prueba login, programar,
  borrar, restaurar, rodillos, Hall of Fame, etc.

Con `BACKUPS_DIR=<carpeta>` se comprueba además que todas las copias reales de
esa carpeta se pueden restaurar.

Se ejecutan solas en GitHub en cada *pull request* (pestaña **Actions**).
Para ejecutarlas a mano:

```
cd tests
npm install
npx playwright install chromium
npm test
```
