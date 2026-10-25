// Pruebas de la web (index.html) en Chromium con un Firebase simulado en memoria.
// Uso: npm test (desde la carpeta tests). Opcional: BACKUPS_DIR=<carpeta> con
// copias reales (*.json) para comprobar que pasan la validación de restauración.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const leerCopias = dir => fs.readdirSync(dir, { recursive: true })
  .filter(f => String(f).endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(dir, String(f)), 'utf8')));

let window_backupAuth = null; let backupCalls = 0; let backupFail = false;
const REPO = path.join(__dirname, '..');
const backup = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'backup.json'), 'utf8'));
const initial = { historial_ganadores: backup.historial_ganadores, hall_of_fame_juegos: backup.hall_of_fame_juegos, regalos: backup.regalos, mes_sorteo: 'Octubre' };
let failures = 0;
const check = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failures++; };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(`window.__INITIAL_DB__ = ${JSON.stringify(initial)};
    window.__alerts = []; window.alert = m => window.__alerts.push(m);
    window.__confirms = []; window.confirm = m => { window.__confirms.push(m); return true; };
    window.prompt = () => 'patrulla123';`);
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebase-app-compat')) return route.fulfill({ body: fs.readFileSync(path.join(__dirname, 'fakefb.js'), 'utf8'), contentType: 'application/javascript' });
    if (u.includes('firebase-auth-compat')) return route.fulfill({ body: '', contentType: 'application/javascript' });
    if (u.includes('docs.google.com')) return route.fulfill({ status: 200, body: 'Chrono Trigger,Enero 2025\nMetal Slug,Marzo 2024\nMetal Gear Solid,Junio 2025', contentType: 'text/csv', headers: { 'Access-Control-Allow-Origin': '*' } });
    if (u.includes('workers.dev/backup')) { window_backupAuth = route.request().headers()['authorization']; backupCalls++;
      if (backupFail) return route.fulfill({ status: 500, body: JSON.stringify({ ok: false, error: 'GitHub caído' }), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
      return route.fulfill({ status: 200, body: JSON.stringify({ ok: true, archivo: 'backups/x.json' }), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } }); }
    if (u.includes('firebase-database-compat')) return route.fulfill({ body: '', contentType: 'application/javascript' });
    if (u.includes('canvas-confetti')) return route.fulfill({ body: 'window.confetti=function(){}', contentType: 'application/javascript' });
    if (u.startsWith('file://')) return route.continue();
    return route.fulfill({ status: 500, body: '' });
  });
  await page.goto('file://' + path.join(REPO, 'index.html'));
  await page.waitForTimeout(1500);
  const db = p => page.evaluate(p => window.__DB__.get(p), p);
  const ev = (f, a) => page.evaluate(f, a);
  const hofTotal = h => Object.values(h || {}).reduce((a, x) => a + x.total, 0);

  check(await page.$eval('#retroTimeDisplayValue', e => e.textContent) === '21:00', 'hora visible 21:00');
  check(await page.$eval('#drawTimeInput', e => e.value) === '21:00', 'valor real 21:00');

  check(!(await page.content()).includes('cGF0cnVsbGExMjM'), 'contraseña antigua eliminada del código');
  const clicks = () => ev(() => { contarClicksAdmin(); contarClicksAdmin(); contarClicksAdmin(); });
  await clicks(); await page.waitForTimeout(200);
  check(await page.isVisible('#loginModal'), 'sin sesión: 3 clics abren el login');
  await page.fill('#loginEmail', 'admin@test.es'); await page.fill('#loginPassword', 'mala'); await page.click('#loginSubmit');
  await page.waitForTimeout(200);
  check((await page.textContent('#loginError')).includes('incorrectos') && !(await ev(() => isAdminLoggedIn)), 'contraseña mala: error y sin panel');
  await page.fill('#loginPassword', 'buena'); await page.click('#loginSubmit');
  await page.waitForTimeout(500);
  check(await ev(() => isAdminLoggedIn) && await page.isVisible('#adminPanel') && !(await page.isVisible('#loginModal')), 'contraseña buena: panel abierto');
  check((await page.textContent('#adminUserEmail')) === 'admin@test.es', 'muestra el correo de la sesión');
  check(await page.isVisible('#irAlPanelBtn'), 'con el panel abierto aparece el botón flotante "Panel"');
  check(await ev(() => window.__fbConfig && window.__fbConfig.apiKey && window.__fbConfig.authDomain), 'config con apiKey y authDomain');
  // ocultar y volver a abrir sin pedir contraseña
  await clicks(); await page.waitForTimeout(200);
  check(!(await page.isVisible('#adminPanel')) && !(await ev(() => isAdminLoggedIn)), '3 clics con panel abierto lo ocultan');
  check(!(await page.isVisible('#irAlPanelBtn')), 'al ocultar el panel desaparece el botón flotante');
  await clicks(); await page.waitForTimeout(300);
  check(await page.isVisible('#adminPanel') && !(await page.isVisible('#loginModal')), 'con sesión: 3 clics abren el panel sin login');
  // backup manual con token
  await ev(() => crearBackupGitHubManual()); await page.waitForTimeout(500);
  check(window_backupAuth === 'Bearer tok-admin', 'backup GitHub envía el token de la sesión');

  const hof0 = await db('hall_of_fame_juegos'); const hist0 = await db('historial_ganadores');
  const n0 = Object.keys(hist0).length;
  const lines = '1-@AlfaUser\n2-@BetaUser.\n3-@alfauser\nPUNTO EXTRA\n4-@GammaUser';
  await ev((l) => { document.getElementById('listInput').value = l; }, lines);
  await page.evaluate(l => { document.getElementById('listInput').value = l; }, lines);

  // Programar
  await ev(() => programarOEjecutarSorteo()); await page.waitForTimeout(300);
  let s = await db('sorteo_actual'); let hof1 = await db('hall_of_fame_juegos');
  check(s && s.status === 'programado', 'sorteo programado');
  const t = new Date(s.targetTime); check(t.getHours() === 21 && t.getMinutes() === 0, 'programado a las 21:00');
  check(hofTotal(hof1) === hofTotal(hof0) + 3, 'HoF +3 (alfa x2, beta x1, extra excluido)');
  check(hof1['@betauser'] && hof1['@alfauser'].total >= 2, 'usuario con punto final guardado sin punto');

  // Reprogramar: no duplica
  await ev(() => programarOEjecutarSorteo()); await page.waitForTimeout(300);
  check(hofTotal(await db('hall_of_fame_juegos')) === hofTotal(hof0) + 3, 'reprogramar no duplica HoF');
  check((await ev(() => __confirms.slice(-1)[0])).includes('Ya hay un sorteo programado'), 'pide confirmar sustitución');

  // Borrar programado: historial intacto, HoF revertido
  await ev(() => borrarUltimoSorteo()); await page.waitForTimeout(300);
  check(!(await db('sorteo_actual')), 'programación borrada');
  check(Object.keys(await db('historial_ganadores')).length === n0, 'historial intacto al borrar programación');
  check(JSON.stringify(await db('hall_of_fame_juegos')) === JSON.stringify(hof0), 'HoF revertido exactamente');

  // Manual entry added later (old timestamp) then immediate draw then delete
  await ev(() => { document.getElementById('manualUserAdmin').value = '@ManualViejo'; agregarGanadorManual(); });
  await page.waitForTimeout(200);
  await ev(() => document.getElementById('retroTimeCancel').click());
  check(await page.$eval('#drawTimeInput', e => e.value) === '', 'quitar hora deja valor vacío');
  await ev(() => programarOEjecutarSorteo()); await page.waitForTimeout(400);
  s = await db('sorteo_actual');
  check(s && s.ganador, 'sorteo inmediato con ganador');
  check(Object.keys(await db('historial_ganadores')).length === n0 + 2, 'historial +1 (manual) +1 (sorteo)');
  check(hofTotal(await db('hall_of_fame_juegos')) === hofTotal(hof0) + 3, 'HoF +3 tras sorteo inmediato');
  await ev(() => borrarUltimoSorteo()); await page.waitForTimeout(400);
  const hist2 = Object.values(await db('historial_ganadores'));
  check(hist2.length === n0 + 1 && hist2.some(h => h.user === '@ManualViejo'), 'borra el sorteo, no el manual');
  check(JSON.stringify(await db('hall_of_fame_juegos')) === JSON.stringify(hof0), 'HoF revertido tras borrar sorteo inmediato');

  // Inactivo: no borra nada
  await ev(() => borrarUltimoSorteo()); await page.waitForTimeout(300);
  check(Object.keys(await db('historial_ganadores')).length === n0 + 1, 'sin sorteo actual no borra historial');
  check((await ev(() => __alerts.slice(-1)[0])).includes('No hay ningún sorteo actual'), 'avisa que no hay sorteo');

  // Sorteo inmediato sin participantes válidos
  await ev(() => { document.getElementById('listInput').value = 'hola\nsin usuarios'; });
  const hofA = await db('hall_of_fame_juegos');
  await ev(() => programarOEjecutarSorteo()); await page.waitForTimeout(300);
  check(JSON.stringify(await db('hall_of_fame_juegos')) === JSON.stringify(hofA), 'sin participantes: HoF no cambia');
  check((await ev(() => __alerts.slice(-1)[0])).includes('No se ha realizado'), 'avisa de sorteo no realizado');

  // Fecha pasada
  await ev(() => { document.getElementById('listInput').value = '1-@AlfaUser'; document.getElementById('drawTimeInput').value='21:00'; document.getElementById('drawDateInput').value='2020-01-01'; programarOEjecutarSorteo(); });
  await page.waitForTimeout(300);
  check((await ev(() => __alerts.slice(-1)[0])).includes('ya han pasado'), 'rechaza fecha pasada');
  check(!(await db('sorteo_actual')), 'no programa en el pasado');
  await ev(() => { document.getElementById('drawDateInput').value=''; });

  // XSS
  await ev(() => window.__DB__.set('historial_ganadores/xss', { user: '<img src=x onerror="window.pwned=1">', fecha: 'Mes <b>x</b>', ticket: 't', timestamp: Date.now() - 1e9 }));
  await ev(() => { isHistoryExpanded = true; isWinnersExpanded = true; refrescarHistorialAntiSpoiler(); });
  await page.waitForTimeout(1500);
  check(!(await ev(() => window.pwned)), 'nombre con HTML no se ejecuta');
  check((await page.$eval('#historyList', e => e.textContent)).includes('<img src=x'), 'nombre se muestra como texto');

  // Botón borrar ganador concreto
  const btnOk = await ev(() => { const b = [...document.querySelectorAll('#historyList .delete-item-btn')]; b[b.length-1].click(); return b.length; });
  await page.waitForTimeout(300);
  check(btnOk > 0, 'botones de borrar presentes');

  // Selector estable
  await ev(() => { window.__opt = document.querySelector('#historyWinnerSelect option:nth-child(2)'); });
  await page.waitForTimeout(2200);
  check(await ev(() => window.__opt === document.querySelector('#historyWinnerSelect option:nth-child(2)')), 'selector no se reconstruye cada segundo');

  // Corregir mes
  const key = await ev(() => document.querySelector('#historyWinnerSelect option:nth-child(2)').value);
  await ev((k) => { const s = document.getElementById('historyWinnerSelect'); s.value = k; s.onchange(); document.getElementById('historyWinnerMonth').value = '2025-03'; guardarMesGanadorHistorico(); }, key);
  await page.waitForTimeout(300);
  const e = await db('historial_ganadores/' + key);
  check(e.fecha === 'Marzo 2025' && e.mesPremio === 'Marzo 2025', 'corrección actualiza fecha y mesPremio');

  // HoF manual con usuario inválido
  await ev(() => { document.getElementById('hofManualInput').value = '@uno = 3\n@dos. = 2'; guardarHoFManual(); });
  await page.waitForTimeout(300);
  const hm = await db('hall_of_fame_juegos');
  check(hm && hm['@uno'] && Object.keys(hm).length === 1, 'HoF manual ignora usuario inválido y guarda el resto');

  // Estado error del Worker
  const hofE0 = await db('hall_of_fame_juegos');
  await ev(() => { document.getElementById('listInput').value = '1-@ErrUno\n2-@ErrDos'; document.getElementById('drawDateInput').value=''; document.getElementById('drawTimeInput').value='21:00'; programarOEjecutarSorteo(); });
  await page.waitForTimeout(300);
  const hofE1 = await db('hall_of_fame_juegos');
  check(hofTotal(hofE1) === hofTotal(hofE0) + 2, 'error: programación suma 2');
  await ev(() => { const s = window.__DB__.get('sorteo_actual'); s.status = 'error'; s.error = 'Todos los participantes están en la Lista Negra.'; window.__DB__.set('sorteo_actual', s); });
  await page.waitForTimeout(300);
  check(!(await page.$eval('#adminDrawError', e => e.classList.contains('hidden'))), 'error: aviso visible al admin');
  check((await page.$eval('#adminDrawErrorText', e => e.textContent)).includes('Lista Negra'), 'error: aviso muestra el motivo');
  const nConf = await ev(() => __confirms.length);
  await ev(() => { programarOEjecutarSorteo(); }); await page.waitForTimeout(300);
  check(hofTotal(await db('hall_of_fame_juegos')) === hofTotal(hofE0) + 2, 'error: reprogramar tras error no duplica HoF');
  check(!(await ev((n) => __confirms.slice(n).some(c => c.includes('Ya hay un sorteo programado')), nConf)), 'error: no pregunta por sustituir un sorteo fallido');
  check(await page.$eval('#adminDrawError', e => e.classList.contains('hidden')), 'error: aviso desaparece al reprogramar');
  await ev(() => { const s = window.__DB__.get('sorteo_actual'); s.status = 'error'; window.__DB__.set('sorteo_actual', s); });
  await page.waitForTimeout(200);
  const histE = Object.keys(await db('historial_ganadores')).length;
  await ev(() => borrarUltimoSorteo()); await page.waitForTimeout(300);
  check(!(await db('sorteo_actual')) && JSON.stringify(await db('hall_of_fame_juegos')) === JSON.stringify(hofE0), 'error: borrar sorteo fallido revierte HoF');
  check(Object.keys(await db('historial_ganadores')).length === histE, 'error: borrar sorteo fallido no toca historial');

  // Cerrar sesión
  await ev(() => { isHistoryExpanded = true; refrescarHistorialAntiSpoiler(); });
  await page.waitForTimeout(300);
  check((await page.$$('#historyList .delete-item-btn')).length > 0, 'con sesión: botones de borrar visibles');
  await ev(() => cerrarSesionAdmin()); await page.waitForTimeout(400);
  check(!(await page.isVisible('#adminPanel')) && !(await ev(() => isAdminLoggedIn)), 'cerrar sesión oculta el panel');
  check((await page.$$('#historyList .delete-item-btn')).length === 0, 'tras cerrar sesión no hay botones de borrar');
  await clicks(); await page.waitForTimeout(200);
  check(await page.isVisible('#loginModal'), 'tras cerrar sesión, 3 clics piden login otra vez');

  // Recargar la página cierra la sesión
  check(await ev(() => window.__persist) === 'none', 'sesión configurada solo en memoria');
  await page.fill('#loginEmail', 'admin@test.es'); await page.fill('#loginPassword', 'buena'); await page.click('#loginSubmit');
  await page.waitForTimeout(400);
  check(await page.isVisible('#adminPanel'), 'login de nuevo antes de recargar');
  await page.evaluate(() => localStorage.setItem('fakeAuthUser', JSON.stringify({ email: 'admin@test.es' })));
  await page.reload(); await page.waitForTimeout(1200);
  check(!(await page.isVisible('#adminPanel')), 'tras recargar el panel está cerrado');
  await clicks(); await page.waitForTimeout(300);
  check(await page.isVisible('#loginModal') && !(await ev(() => isAdminLoggedIn)), 'tras recargar (incluso con sesión antigua guardada) pide login');

  // ===== PR A: restaurar, borrar todo, errores =====
  check((await page.content()).includes('canvas-confetti@1.9.3/dist/confetti.browser.js" integrity="sha384-'), 'confeti con versión fija e integridad');
  await page.fill('#loginEmail', 'admin@test.es'); await page.fill('#loginPassword', 'buena'); await page.click('#loginSubmit');
  await page.waitForTimeout(400);
  check(await ev(() => isAdminLoggedIn), 'login para pruebas PR A');

  // Todas las copias reales del repo pasan la validación
  const reales = process.env.BACKUPS_DIR ? leerCopias(process.env.BACKUPS_DIR) : [backup];
  const errsReales = await ev((lista) => lista.map(d => analizarDatosBackup(d, {}).errores).filter(e => e.length), reales);
  check(reales.length > 0 && errsReales.length === 0, `las ${reales.length} copias reales de GitHub son válidas ${JSON.stringify(errsReales)}`);

  // Restaurar JSON válido
  const jsonValido = reales[0];
  const nReal = Object.keys(jsonValido.historial_ganadores).length;
  await ev(() => window.__DB__.set('historial_ganadores/extra_x', { user: '@Temporal', fecha: 'x', timestamp: 1 }));
  let bc0 = backupCalls; let nconf = await ev(() => __confirms.length);
  await page.setInputFiles('#jsonFileInput', { name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(jsonValido)) });
  await page.waitForTimeout(800);
  const confRest = await ev((n) => __confirms.slice(n).join('\n---\n'), nconf);
  check(confRest.includes('Ganadores en el historial') && confRest.includes('→'), 'restaurar JSON muestra resumen ahora → copia');
  check(backupCalls === bc0 + 1, 'restaurar JSON hace copia previa en GitHub');
  const histTrasRest = await db('historial_ganadores');
  check(Object.keys(histTrasRest).length === nReal && !histTrasRest.extra_x, 'restaurar JSON aplica los datos de la copia');

  // Restaurar JSON inválido
  bc0 = backupCalls; const antesInv = JSON.stringify(await db('historial_ganadores'));
  await page.setInputFiles('#jsonFileInput', { name: 'mala.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ historial_ganadores: { a: { fecha: 'sin usuario' } } })) });
  await page.waitForTimeout(600);
  check((await ev(() => __alerts.slice(-1)[0])).includes('No se puede restaurar'), 'JSON inválido: avisa y no restaura');
  check(backupCalls === bc0 && JSON.stringify(await db('historial_ganadores')) === antesInv, 'JSON inválido: no toca datos ni hace copia');
  await page.setInputFiles('#jsonFileInput', { name: 'rota.json', mimeType: 'application/json', buffer: Buffer.from('{ no es json') });
  await page.waitForTimeout(400);
  check((await ev(() => __alerts.slice(-1)[0])).includes('formato JSON válido'), 'JSON roto: avisa');

  // Restaurar copia de Firebase con nodos ausentes y sorteo programado vencido
  await ev(() => window.__DB__.set('backups/2026-01-01_1200', { etiqueta: 'Prueba', historial_ganadores: { k1: { user: '@SoloUno', fecha: 'Enero 2026', timestamp: 5 } }, sorteo_actual: { status: 'programado', targetTime: 1000, rawLines: '1-@a' } }));
  await page.waitForTimeout(300);
  nconf = await ev(() => __confirms.length);
  await ev(() => { const s = document.getElementById('backupSelect'); s.value = '2026-01-01_1200'; return restaurarBackupSeleccionado(); });
  await page.waitForTimeout(600);
  const confFb = await ev((n) => __confirms.slice(n).join('\n'), nconf);
  check(confFb.includes('YA HA PASADO'), 'avisa de sorteo programado vencido en la copia');
  check(Object.keys(await db('historial_ganadores')).length === 1 && !(await db('hall_of_fame_juegos')), 'copia de Firebase: nodos ausentes quedan vacíos');

  // Borrar todo
  await page.setInputFiles('#jsonFileInput', { name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(jsonValido)) });
  await page.waitForTimeout(800);
  await ev(() => { window.prompt = () => 'borrar'; }); bc0 = backupCalls;
  await ev(() => borrarTodo()); await page.waitForTimeout(400);
  check(Object.keys(await db('historial_ganadores') || {}).length === nReal && backupCalls === bc0, 'borrar todo: "borrar" en minúsculas no borra');
  await ev(() => { window.prompt = () => null; });
  await ev(() => borrarTodo()); await page.waitForTimeout(300);
  check(Object.keys(await db('historial_ganadores') || {}).length === nReal, 'borrar todo: cancelar no borra');
  backupFail = true;
  await ev(() => { window.prompt = () => 'BORRAR'; window.confirm = m => { window.__confirms.push(m); return !m.includes('SIN copia previa'); }; });
  await ev(() => borrarTodo()); await page.waitForTimeout(500);
  check(Object.keys(await db('historial_ganadores') || {}).length === nReal && (await ev(() => __confirms.slice(-1)[0])).includes('GitHub caído'), 'copia previa falla: pregunta y si dices no, no borra');
  backupFail = false; bc0 = backupCalls;
  await ev(() => { window.confirm = m => { window.__confirms.push(m); return true; }; });
  await ev(() => borrarTodo()); await page.waitForTimeout(500);
  check(backupCalls === bc0 + 1 && !(await db('historial_ganadores')) && !(await db('hall_of_fame_juegos')) && !(await db('regalos')), 'borrar todo con BORRAR: copia previa y borrado');
  check((await ev(() => __alerts.slice(-1)[0])).includes('borrado'), 'borrar todo: confirma tras borrar');

  // Errores de escritura
  await ev(() => { window.__failWrites = true; document.getElementById('manualUserAdmin').value = '@Nuevo'; agregarGanadorManual(); });
  await page.waitForTimeout(300);
  check((await ev(() => __alerts.slice(-1)[0])).includes('No se pudieron añadir'), 'si Firebase rechaza, avisa del error (no de éxito)');
  await ev(() => { document.getElementById('listInput').value = 'x'; guardarParticipantesFirebase(); });
  await page.waitForTimeout(200);
  check((await ev(() => __alerts.slice(-1)[0])).includes('lista de participantes'), 'error al guardar participantes: avisa');
  await ev(() => { window.__failWrites = false; document.getElementById('manualUserAdmin').value = '@bien, @mal.user'; agregarGanadorManual(); });
  await page.waitForTimeout(300);
  check((await ev(() => __alerts.slice(-1)[0])).includes('no son válidos') && !(await db('historial_ganadores')), 'usuario manual inválido: no añade ninguno');
  await ev(() => { document.getElementById('manualUserAdmin').value = '@bien, otro'; agregarGanadorManual(); });
  await page.waitForTimeout(300);
  check(Object.values(await db('historial_ganadores') || {}).map(x => x.user).sort().join() === '@bien,@otro', 'ganadores manuales válidos se añaden');

  // ===== PR B: lista negra privada y rodillos =====
  await ev(() => { window.__DB__.set('historial_ganadores', null); window.__DB__.set('sorteo_actual', null); });
  await ev(() => { document.getElementById('listInput').value = '1-@Uno\n2-@Dos\n3-@Tres'; document.getElementById('blacklistInput').value = '@uno'; document.getElementById('drawDateInput').value=''; document.getElementById('drawTimeInput').value='21:00'; programarOEjecutarSorteo(); });
  await page.waitForTimeout(400);
  let sa = await db('sorteo_actual'), sp = await db('sorteo_privado');
  check(sa.status === 'programado' && !('rawBlacklist' in sa), 'B: programado sin lista negra pública');
  check(sp && sp.rawBlacklist === '@uno' && sp.targetTime === sa.targetTime, 'B: lista negra en sorteo_privado con su targetTime');
  // procesando: los rodillos siguen activos
  await ev(() => { const s = window.__DB__.get('sorteo_actual'); s.targetTime = Date.now() - 5000; s.status = 'procesando'; window.__DB__.set('sorteo_actual', s); });
  await page.waitForTimeout(400);
  check(await page.$eval('#slotMachineCard', e => e.classList.contains('active')) && (await page.textContent('#slotStatus')).includes('PROCESANDO'), 'B: en "procesando" la recreativa sigue girando');
  // Resultado del Worker con revealAt
  await ev(() => {
    const ts = Date.now();
    window.__DB__.set('historial_ganadores/sorteo_x', { user: '@Tres', ticket: '357-@Tres', fecha: 'Octubre 2026', timestamp: ts });
    window.__DB__.set('sorteo_actual', { ganador: { user: '@Tres', ticket: '357-@Tres' }, arcadeGroup: [{ user: '@Tres', ticket: '357-@Tres' }], timestamp: ts, revealAt: ts + 3000, mesPremio: 'Octubre 2026', rawLines: 'x' });
  });
  await page.waitForTimeout(700);
  const reels = await page.$$eval('.slot-reel', els => els.map(e => e.textContent).join(''));
  check(reels === '357', 'B: rodillos paran en el número premiado (357)');
  check((await page.textContent('#slotStatus')).includes('MOSTRANDO GANADOR EN'), 'B: cuenta atrás visible');
  check(!(await page.isVisible('#winnerCard')), 'B: ganador oculto durante la cuenta atrás');
  check(!(await page.textContent('#historyList')).includes('@Tres'), 'B: historial no revela al ganador antes de tiempo');
  await page.waitForTimeout(3500);
  check(await page.isVisible('#winnerCard') && (await page.textContent('#winnerName')).includes('@Tres'), 'B: tras la cuenta atrás se muestra el ganador');
  check((await page.textContent('#historyList')).includes('@Tres'), 'B: tras la revelación aparece en el historial');
  // Sorteo inmediato: sin cuenta atrás y sin lista negra pública
  await ev(() => window.__DB__.set('sorteo_actual', null)); await page.waitForTimeout(200);
  await ev(() => { document.getElementById('drawTimeInput').value = ''; document.getElementById('listInput').value = '1-@Uno\n2-@Dos'; document.getElementById('blacklistInput').value = '@uno'; programarOEjecutarSorteo(); });
  await page.waitForTimeout(600);
  sa = await db('sorteo_actual'); sp = await db('sorteo_privado');
  check(sa.ganador.user === '@Dos' && !('rawBlacklist' in sa) && !('log' in sa) && !('revealAt' in sa), 'B: inmediato sin lista negra, sin registro y sin cuenta atrás');
  check(sp.rawBlacklist === '@uno' && Array.isArray(sp.log), 'B: inmediato guarda lista negra y registro en privado');
  check(await page.isVisible('#winnerCard'), 'B: inmediato muestra el ganador al momento');
  await ev(() => borrarUltimoSorteo()); await page.waitForTimeout(400);
  check(!(await db('sorteo_actual')) && !(await db('sorteo_privado')), 'B: borrar último sorteo limpia también el nodo privado');

  // Ganadores: @Pepe y @pepe cuentan como la misma persona
  await ev(() => {
    window.__DB__.set('historial_ganadores/may1', { user: '@PepeMay', fecha: 'Enero 2026', timestamp: 1000 });
    window.__DB__.set('historial_ganadores/may2', { user: '@pepemay', fecha: 'Febrero 2026', timestamp: 2000 });
    winnersSearchQuery = 'pepemay'; refrescarHistorialAntiSpoiler();
  });
  await page.waitForTimeout(400);
  const filasPepe = await page.$$eval('#winnersCountList li', els => els.map(e => e.textContent));
  check(filasPepe.length === 1 && filasPepe[0].includes('2 veces'), 'ganadores: mayúsculas distintas cuentan como una persona ' + JSON.stringify(filasPepe));
  check(filasPepe[0].includes('@pepemay'), 'ganadores: muestra el nombre de la victoria más reciente');
  await ev(() => { winnersSearchQuery = ''; });

  // ===== Tiradas de prueba =====
  await ev(() => { if (!isAdminLoggedIn) abrirPanelAdmin(); });
  await page.waitForTimeout(300);
  await ev(() => {
    window.__DB__.set('sorteo_actual', { ganador: { user: '@RealWin', ticket: '4-@RealWin' }, arcadeGroup: [{ user: '@RealWin', ticket: '4-@RealWin' }], timestamp: 1000, mesPremio: 'Septiembre 2026', rawLines: 'x' });
    window.__DB__.set('historial_ganadores', { r1: { user: '@RealWin', fecha: 'Septiembre 2026', timestamp: 1000 } });
  });
  await page.waitForTimeout(400);
  const histP0 = JSON.stringify(await db('historial_ganadores')), hofP0 = JSON.stringify(await db('hall_of_fame_juegos')), realP0 = JSON.stringify(await db('sorteo_actual')), privP0 = JSON.stringify(await db('sorteo_privado'));
  check(!(await page.isVisible('#pruebaBanner')) && (await page.textContent('#winnerName')).includes('@RealWin'), 'prueba: sin prueba se ve el sorteo real');
  // Prueba inmediata
  await ev(() => { document.getElementById('pruebaCheckbox').checked = true; document.getElementById('drawTimeInput').value = ''; document.getElementById('listInput').value = '1-@Uno\n2-@Dos\n3-@Tres'; document.getElementById('blacklistInput').value = '@uno\n@dos'; programarOEjecutarSorteo(); });
  await page.waitForTimeout(700);
  const pr = await db('sorteo_prueba');
  check(pr && pr.prueba === true && pr.ganador.user === '@Tres' && Array.isArray(pr.log) && pr.rawBlacklist === '@uno\n@dos', 'prueba: inmediata guardada en sorteo_prueba, respetando la lista negra');
  check(JSON.stringify(await db('historial_ganadores')) === histP0 && JSON.stringify(await db('hall_of_fame_juegos')) === hofP0, 'prueba: no toca historial ni Hall of Fame');
  check(JSON.stringify(await db('sorteo_actual')) === realP0 && JSON.stringify(await db('sorteo_privado')) === privP0, 'prueba: no toca el sorteo real ni su lista negra');
  check(await page.isVisible('#pruebaBanner') && (await page.textContent('#winnerName')).includes('@Tres'), 'prueba: el admin la ve con la banda de prueba');
  check((await page.textContent('#winnerTitle')).includes('tirada de prueba'), 'prueba: el título dice que es de prueba');
  check(await page.isVisible('#borrarPruebaBtn'), 'prueba: aparece el botón de borrar la prueba');
  check((await ev(() => __alerts.slice(-1)[0])).includes('Tirada de prueba realizada'), 'prueba: avisa de que no se ha guardado nada');
  // Ocultar el panel: se vuelve a ver el sorteo real
  await clicks(); await page.waitForTimeout(400);
  check(!(await page.isVisible('#pruebaBanner')) && (await page.textContent('#winnerName')).includes('@RealWin'), 'prueba: con el panel oculto se ve el sorteo real');
  check((await page.textContent('#winnerTitle')).includes('Ganador Oficial'), 'prueba: el sorteo real mantiene su título');
  await clicks(); await page.waitForTimeout(400);
  check(await page.isVisible('#pruebaBanner'), 'prueba: al reabrir el panel se vuelve a ver la prueba');
  // Prueba programada con cuenta atrás (resultado como lo deja el Worker)
  const nConfP = await ev(() => __confirms.length);
  await ev(() => { document.getElementById('drawDateInput').value = ''; document.getElementById('drawTimeInput').value = '21:00'; programarOEjecutarSorteo(); });
  await page.waitForTimeout(500);
  const prog = await db('sorteo_prueba');
  check(prog.status === 'programado' && prog.prueba === true && prog.rawBlacklist === '@uno\n@dos' && JSON.stringify(await db('sorteo_actual')) === realP0, 'prueba: programada en sorteo_prueba sin tocar el real');
  check(!(await ev((n) => __confirms.slice(n).some(c => c.includes('Ya hay un sorteo programado')), nConfP)), 'prueba: no pregunta por sustituir el sorteo real');
  await ev(() => { const t = Date.now(); window.__DB__.set('sorteo_prueba', { ganador: { user: '@Tres', ticket: '853-@Tres' }, arcadeGroup: [{ user: '@Tres', ticket: '853-@Tres' }], timestamp: t, revealAt: t + 2000, prueba: true, mesPremio: 'Octubre 2026', rawLines: 'x' }); });
  await page.waitForTimeout(600);
  check((await page.$$eval('.slot-reel', els => els.map(e => e.textContent).join(''))) === '853' && !(await page.isVisible('#winnerCard')), 'prueba: rodillos con cuenta atrás para el admin');
  await page.waitForTimeout(2200);
  check(await page.isVisible('#winnerCard') && (await page.textContent('#winnerName')).includes('@Tres'), 'prueba: tras la cuenta atrás se muestra el ganador de prueba');
  // Error en la prueba
  await ev(() => window.__DB__.set('sorteo_prueba', { status: 'error', error: 'Sin participantes', prueba: true, targetTime: 1 }));
  await page.waitForTimeout(400);
  check((await page.textContent('#adminDrawErrorText')).includes('Tirada de prueba: Sin participantes') && await page.isVisible('#adminDrawError'), 'prueba: un error de la prueba se avisa en el panel');
  // Borrar la prueba
  await ev(() => borrarTiradaPrueba()); await page.waitForTimeout(400);
  check(!(await db('sorteo_prueba')) && !(await page.isVisible('#pruebaBanner')) && (await page.textContent('#winnerName')).includes('@RealWin') && !(await page.isVisible('#borrarPruebaBtn')), 'prueba: borrarla vuelve a mostrar el sorteo real');
  check(!(await page.isVisible('#adminDrawError')), 'prueba: al borrarla desaparece su aviso de error');
  await ev(() => { document.getElementById('pruebaCheckbox').checked = false; });
  // Al cerrar sesión no se ve la prueba
  await ev(() => window.__DB__.set('sorteo_prueba', { ganador: { user: '@Oculto', ticket: '1-@Oculto' }, timestamp: 5, prueba: true }));
  await page.waitForTimeout(300);
  await ev(() => cerrarSesionAdmin()); await page.waitForTimeout(400);
  check(!(await page.isVisible('#pruebaBanner')) && !(await page.textContent('#winnerName')).includes('@Oculto'), 'prueba: sin sesión no se ve la prueba');
  await page.fill('#loginEmail', 'admin@test.es').catch(() => {});
  await ev(() => window.__DB__.set('sorteo_prueba', null));

  // ===== Diseño adaptable =====
  for (const ancho of [320, 360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width: ancho, height: 900 });
    await page.waitForTimeout(150);
    const desborde = await ev(() => document.documentElement.scrollWidth - window.innerWidth);
    check(desborde <= 0, `sin desplazamiento horizontal a ${ancho}px (sobran ${desborde}px)`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const visibles = () => ev(() => ['winnersCountCard', 'hallOfFameCard', 'historyCard'].filter(id => getComputedStyle(document.getElementById(id)).display !== 'none'));
  check(await page.isVisible('.tabs-listas') && JSON.stringify(await visibles()) === '["winnersCountCard"]', 'móvil: pestañas visibles y solo la lista de Ganadores');
  await page.click('.tab-lista[data-tab="hof"]'); await page.waitForTimeout(150);
  check(JSON.stringify(await visibles()) === '["hallOfFameCard"]' && await ev(() => document.querySelector('.tab-lista[data-tab="hof"]').getAttribute('aria-selected') === 'true'), 'móvil: pestaña Hall of Fame');
  await page.click('.tab-lista[data-tab="historial"]'); await page.waitForTimeout(150);
  check(JSON.stringify(await visibles()) === '["historyCard"]', 'móvil: pestaña Historial');
  check(await ev(() => { const h = document.getElementById('mainTitle'); return h.textContent === 'Hall of Fame Patrulla Retro' && h.getBoundingClientRect().height < 40; }), 'móvil: título "Hall of Fame Patrulla Retro" en una línea');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  check(!(await page.isVisible('.tabs-listas')) && (await visibles()).length === 3, 'PC: sin pestañas y con las tres listas');
  const columnas = await ev(() => { const a = document.querySelector('.col-principal').getBoundingClientRect(), b = document.querySelector('.col-listas').getBoundingClientRect(); return b.left >= a.right && Math.abs(a.top - b.top) < 5; });
  check(columnas, 'PC: dos columnas lado a lado');
  // Panel de admin del mismo ancho que las dos columnas juntas
  await ev(() => { if (!isAdminLoggedIn) abrirPanelAdmin(); });
  await page.waitForTimeout(300);
  const panelOk = await ev(() => {
    const pa = document.getElementById('adminPanel').getBoundingClientRect(), l = document.querySelector('.layout').getBoundingClientRect();
    const sec = document.querySelector('#adminPanel > .admin-section').getBoundingClientRect(), aj = document.querySelector('#adminPanel .admin-ajustes').getBoundingClientRect();
    return Math.abs(pa.left - l.left) < 2 && Math.abs(pa.width - l.width) < 2 && aj.left >= sec.right && Math.abs(aj.top - sec.top) < 2;
  });
  check(panelOk, 'PC: panel de admin del ancho de las dos columnas, con los ajustes a la derecha');
  check(await ev(() => document.getElementById('mainTitle').textContent === 'Hall of Fame Patrulla Retro'), 'PC: título sin mes ni emojis');
  await ev(() => seleccionarPestanaListas('ganadores'));
  // Grupo del Arcade sin repetir el nombre
  await ev(() => { window.__DB__.set('sorteo_actual', { ganador: { user: '@Arc', ticket: '12-@Arc' }, arcadeGroup: [{ user: '@Arc', ticket: '12-@Arc' }, { user: '@Otro', ticket: '13-@Otro' }], timestamp: Date.now() - 1000, mesPremio: 'Octubre 2026', rawLines: 'x' }); });
  await page.waitForTimeout(500);
  const arcadeTxt = await page.textContent('#arcadeList');
  check(arcadeTxt.includes('@Arc · Nº 12') && arcadeTxt.includes('@Otro · Nº 13') && !arcadeTxt.includes('12-@Arc'), 'Arcade: "@usuario · Nº" sin repetir el nombre');
  check(await ev(() => document.getElementById('instruccionesElegidos').open), 'instrucciones abiertas con un ganador reciente');
  const tamPC = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await ev(() => window.__DB__.set('sorteo_actual', { ganador: { user: '@Viejo', ticket: '1-@Viejo' }, arcadeGroup: [], timestamp: Date.now() - 5 * 86400000, mesPremio: 'Septiembre 2026', rawLines: 'x' }));
  await page.waitForTimeout(500);
  check(!(await ev(() => document.getElementById('instruccionesElegidos').open)), 'móvil: instrucciones plegadas con un ganador antiguo');
  await page.setViewportSize(tamPC);
  await page.waitForTimeout(200);
  check(await ev(() => document.getElementById('instruccionesElegidos').open), 'PC: al volver a pantalla ancha las instrucciones se abren');

  // ===== Parte 1: buscador global, ficha de usuario y "¿Estoy en el sorteo?" =====
  await page.setViewportSize({ width: 390, height: 844 });
  await ev(() => {
    window.__DB__.set('historial_ganadores', {
      f1: { user: '@Fichado', fecha: 'Enero 2026', timestamp: 1000 },
      f2: { user: '@fichado', fecha: 'Marzo 2026', timestamp: 2000 },
      f3: { user: '@Fichado', fecha: 'Abril 2026', timestamp: 3000, especial: true, premioEspecial: 'Mando' },
      f4: { user: '@Otra', fecha: 'Mayo 2026', timestamp: 4000 }
    });
    window.__DB__.set('hall_of_fame_juegos', { '@fichado': { user: '@Fichado', total: 50 }, '@otra': { user: '@Otra', total: 90 } });
    window.__DB__.set('sorteo_actual', null);
    document.getElementById('listInput').value = '1-@Fichado\n2-@Otra\n3-@Fichado\n4-@Tercero';
  });
  await page.waitForTimeout(500);
  await page.fill('#buscadorGlobal', 'fich');
  await page.waitForTimeout(300);
  const res1 = await page.textContent('#resultadosGlobal');
  check(await page.isVisible('#resultadosGlobal') && res1.includes('@Fichado') && res1.includes('🏆 2') && res1.includes('👾 50') && res1.includes('🎟️ 2'), 'buscador: encuentra al usuario con sus datos ' + JSON.stringify(res1));
  await page.waitForTimeout(600);
  check(!(await page.textContent('#resultadosGlobal')).includes('Ningún juego'), 'buscador: si encuentra usuarios no dice "ningún juego"');
  await page.click('.resultado-usuario[data-user="@Fichado"]');
  await page.waitForTimeout(300);
  const ficha = await page.textContent('#fichaUsuarioModal');
  check(await page.isVisible('#fichaUsuarioModal') && !(await page.isVisible('#resultadosGlobal')), 'buscador: al pulsar se abre la ficha');
  check(ficha.includes('@Fichado') && ficha.includes('2victorias') && ficha.includes('#2 del HoF') && ficha.includes('Enero 2026') && ficha.includes('Marzo 2026') && ficha.includes('Mando'), 'ficha: victorias (sin distinguir mayúsculas), HoF y especiales ' + JSON.stringify(ficha));
  check(ficha.includes('2boletos este mes · 50.00%'), 'ficha: boletos y probabilidad de este mes');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check(!(await page.isVisible('#fichaUsuarioModal')), 'ficha: se cierra con Escape');
  // Juegos
  await page.fill('#buscadorGlobal', 'metal');
  await page.waitForTimeout(800);
  const res2 = await page.textContent('#resultadosGlobal');
  check(res2.includes('Metal Slug') && res2.includes('Metal Gear Solid') && res2.includes('ya se ha elegido'), 'buscador: encuentra juegos ya elegidos ' + JSON.stringify(res2));
  await page.fill('#buscadorGlobal', 'zelda');
  await page.waitForTimeout(800);
  check((await page.textContent('#resultadosGlobal')).includes('Ningún juego con ese nombre'), 'buscador: avisa si el juego no se ha elegido');
  await page.fill('#buscadorGlobal', '@meta');
  await page.waitForTimeout(500);
  check(!(await page.textContent('#resultadosGlobal')).includes('Juegos'), 'buscador: con @ solo busca usuarios');
  await page.fill('#buscadorGlobal', '');
  await page.waitForTimeout(200);
  // Nombres pulsables en las listas
  await ev(() => seleccionarPestanaListas('hof'));
  await page.waitForTimeout(300);
  await page.click('#hallOfFameList .enlace-usuario[data-user="@Otra"]');
  await page.waitForTimeout(300);
  check(await page.isVisible('#fichaUsuarioModal') && (await page.textContent('#fichaUsuarioNombre')).includes('@Otra'), 'ficha: se abre al pulsar un nombre del Hall of Fame');
  await ev(() => cerrarFichaUsuario());
  await ev(() => seleccionarPestanaListas('ganadores'));
  // ¿Estoy en el sorteo?
  await ev(() => abrirProbabilidadesModal());
  await page.fill('#buscarmeInput', 'fichado');
  await page.waitForTimeout(200);
  const yo = await page.textContent('#buscarmeResultado');
  check(yo.includes('@Fichado') && yo.includes('2 boletos') && yo.includes('Nº 1, 3') && yo.includes('50.00%'), '¿Estoy?: encuentra al usuario sin @ ni mayúsculas ' + JSON.stringify(yo));
  await page.fill('#buscarmeInput', '@nadie');
  await page.waitForTimeout(200);
  check((await page.textContent('#buscarmeResultado')).includes('no aparece'), '¿Estoy?: avisa si no está');
  await ev(() => cerrarProbabilidadesModal());
  // Sin desplazamiento horizontal con los resultados abiertos
  await page.fill('#buscadorGlobal', 'fich'); await page.waitForTimeout(300);
  check(await ev(() => document.documentElement.scrollWidth <= window.innerWidth), 'buscador: sin desplazamiento horizontal en móvil');
  await page.fill('#buscadorGlobal', '');

  // ===== Parte 2: franja de estado y barra de accesos =====
  await page.setViewportSize({ width: 390, height: 844 });
  if (await ev(() => isAdminLoggedIn)) await ev(() => ocultarPanelAdmin());
  await ev(() => window.__DB__.set('sorteo_actual', { status: 'programado', targetTime: Date.now() + 2 * 86400000 + 5 * 3600000 + 1800000, rawLines: 'x' }));
  await page.waitForTimeout(1200);
  const mesPrevio = await db('mes_sorteo');
  await ev(() => window.__DB__.set('mes_sorteo', 'Noviembre'));
  await page.waitForTimeout(1200);
  let estado = await page.textContent('#estadoSorteo');
  check(await page.isVisible('#estadoSorteo') && estado.includes('Sorteo de Noviembre:') && estado.includes('faltan 2d 5h'), 'franja: sorteo del mes con cuenta atrás ' + JSON.stringify(estado));
  check(await ev(() => { const e = document.getElementById('estadoSorteo'); return e.innerText.includes('Noviembre:') && !e.innerText.includes('Sorteo de') && e.getBoundingClientRect().height < 40; }), 'móvil: franja con el mes en una línea');
  check(!(await page.textContent('#mainTitle')).includes('Noviembre'), 'el título no repite el mes');
  await ev(() => window.__DB__.set('mes_sorteo', null));
  await page.waitForTimeout(300);
  estado = await page.textContent('#estadoSorteo');
  check(estado.includes('Próximo sorteo') && estado.includes('faltan 2d 5h'), 'franja: sin mes guardado, "Próximo sorteo" ' + JSON.stringify(estado));
  await ev((m) => window.__DB__.set('mes_sorteo', m), mesPrevio);
  await page.waitForTimeout(300);
  await ev(() => window.__DB__.set('sorteo_actual', { status: 'programado', targetTime: Date.now() + 90000, rawLines: 'x' }));
  await page.waitForTimeout(1200);
  estado = await page.textContent('#estadoSorteo');
  check(/faltan 01:\d\d/.test(estado), 'franja: en la última hora cuenta en minutos y segundos ' + JSON.stringify(estado));
  await ev(() => window.__DB__.set('sorteo_actual', { status: 'procesando', targetTime: Date.now() - 1000, rawLines: 'x' }));
  await page.waitForTimeout(1200);
  check((await page.textContent('#estadoSorteo')).includes('en directo'), 'franja: "en directo" mientras se procesa');
  await ev(() => { const t = Date.now(); window.__DB__.set('sorteo_actual', { ganador: { user: '@Franja', ticket: '9-@Franja' }, timestamp: t, revealAt: t + 2500, mesPremio: 'Octubre 2026', rawLines: 'x' }); });
  await page.waitForTimeout(800);
  estado = await page.textContent('#estadoSorteo');
  check(estado.includes('en directo') && !estado.includes('@Franja'), 'franja: no revela al ganador durante la cuenta atrás');
  await page.waitForTimeout(2600);
  estado = await page.textContent('#estadoSorteo');
  check(estado.includes('Ganador de Octubre 2026') && estado.includes('@Franja'), 'franja: muestra al ganador tras la revelación');
  await page.click('#estadoSorteo .enlace-usuario'); await page.waitForTimeout(300);
  check(await page.isVisible('#fichaUsuarioModal'), 'franja: el ganador abre su ficha');
  await ev(() => cerrarFichaUsuario());
  await ev(() => window.__DB__.set('sorteo_actual', null)); await page.waitForTimeout(1200);
  check((await page.textContent('#estadoSorteo')).includes('pendiente de programar'), 'franja: sin sorteo, pendiente de programar');
  // Barra de accesos en móvil
  const barra = await ev(() => { const b = document.querySelector('.barra-accesos').getBoundingClientRect(); return { abajo: Math.abs(b.bottom - innerHeight) < 2, ancho: Math.abs(b.width - innerWidth) < 2, alto: b.height, relleno: parseFloat(getComputedStyle(document.body).paddingBottom) }; });
  check(barra.abajo && barra.ancho && barra.relleno >= barra.alto, 'barra: fija abajo en móvil sin tapar el contenido ' + JSON.stringify(barra));
  await page.click('.barra-accesos button:nth-child(3)'); await page.waitForTimeout(700);
  check(await ev(() => document.getElementById('colListas').dataset.tab === 'hof') && await ev(() => { const r = document.getElementById('colListas').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight - 150; }), 'barra: HoF abre su pestaña y la muestra en pantalla');
  await page.click('.barra-accesos button:nth-child(5)'); await page.waitForTimeout(800);
  check(await ev(() => document.activeElement && document.activeElement.id === 'buscadorGlobal' && scrollY < 5), 'barra: Buscar sube y pone el cursor en el buscador');
  await ev(() => seleccionarPestanaListas('ganadores'));
  // Barra en PC
  // Ventana baja para que la página tenga que desplazarse
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.waitForTimeout(300);
  await ev(() => window.scrollTo(0, 800)); await page.waitForTimeout(300);
  check(await ev(() => { const b = document.querySelector('.barra-accesos').getBoundingClientRect(); return b.top >= 0 && b.top < 20 && b.width <= 562; }), 'barra: en PC queda fija arriba al bajar');
  await page.click('.barra-accesos button:nth-child(4)'); await page.waitForTimeout(800);
  check(await ev(() => { const r = document.getElementById('historyCard').getBoundingClientRect(), b = document.querySelector('.barra-accesos').getBoundingClientRect(); return r.top >= b.bottom - 1 && r.top < innerHeight - 100; }), 'barra: en PC Historial baja a su tarjeta sin quedar tapada');
  await ev(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 1440, height: 900 });

  // ===== Parte 3: podio, barras, contadores, esqueletos y destello =====
  await page.setViewportSize({ width: 1440, height: 900 });
  check(await ev(() => document.querySelectorAll('.esqueleto').length === 0), 'esqueletos: desaparecen al llegar los datos');
  await ev(() => {
    window.__DB__.set('hall_of_fame_juegos', {
      '@a1': { user: '@Primero', total: 200 }, '@a2': { user: '@Segundo', total: 150 }, '@a3': { user: '@Tercero', total: 100 },
      '@a4': { user: '@Cuarto', total: 50 }, '@a5': { user: '@Quinto', total: 20 }
    });
    isHoFExpanded = false; hofSearchQuery = ''; refrescarHistorialAntiSpoiler();
  });
  await page.waitForTimeout(1400);
  const podio = await ev(() => [...document.querySelectorAll('#hallOfFameList .podio .podio-puesto')].map(p => [p.className.replace('podio-puesto ', ''), p.querySelector('.podio-nombre').textContent, p.querySelector('.contador').textContent]));
  check(JSON.stringify(podio) === JSON.stringify([['puesto-2', '@Segundo', '150'], ['puesto-1', '@Primero', '200'], ['puesto-3', '@Tercero', '100']]), 'podio: 2º, 1º y 3º con sus juegos ' + JSON.stringify(podio));
  check(await ev(() => document.querySelectorAll('#hallOfFameList > li.custom-item').length === 0), 'podio: plegado solo se ve el podio');
  await ev(() => toggleHoFView()); await page.waitForTimeout(300);
  const filas = await ev(() => [...document.querySelectorAll('#hallOfFameList > li.custom-item')].map(li => [li.textContent.includes('#4') || li.textContent.includes('#5'), li.style.background]));
  check(filas.length === 2 && filas.every(f => f[0]) && / 25(\.0)?%,/.test(filas[0][1]) && / 10(\.0)?%,/.test(filas[1][1]), 'podio: al desplegar, el resto con barras proporcionales ' + JSON.stringify(filas));
  await page.click('#hallOfFameList .podio .puesto-1 .podio-nombre'); await page.waitForTimeout(300);
  check((await page.textContent('#fichaUsuarioNombre')).includes('@Primero'), 'podio: el nombre abre la ficha');
  await ev(() => { cerrarFichaUsuario(); toggleHoFView(); });
  await ev(() => hofSearchQuery = 'cuar'); await ev(() => refrescarHistorialAntiSpoiler()); await page.waitForTimeout(300);
  check(await ev(() => !document.querySelector('#hallOfFameList .podio') && document.querySelector('#hallOfFameList').textContent.includes('@Cuarto')), 'podio: al buscar se ve la lista normal');
  await ev(() => { hofSearchQuery = ''; refrescarHistorialAntiSpoiler(); });
  // Destello del ganador
  await ev(() => window.__DB__.set('sorteo_actual', { ganador: { user: '@Brillo', ticket: '3-@Brillo' }, arcadeGroup: [], timestamp: Date.now(), mesPremio: 'Octubre 2026', rawLines: 'x' }));
  await page.waitForTimeout(400);
  check(await ev(() => document.getElementById('winnerCard').classList.contains('destello')), 'destello: el ganador aparece con destello');
  // Barras en Ganadores
  check(await ev(() => [...document.querySelectorAll('#winnersCountList li.custom-item')].every(li => li.style.background.includes('linear-gradient'))), 'ganadores: filas con barra de progreso');

  // ===== Parte 4: instalable como app =====
  const manifiesto = JSON.parse(fs.readFileSync(path.join(REPO, 'manifest.webmanifest'), 'utf8'));
  check(manifiesto.display === 'standalone' && manifiesto.start_url === './' && manifiesto.icons.length === 3, 'app: manifiesto con modo app, inicio y tres iconos');
  check(manifiesto.icons.every(i => fs.existsSync(path.join(REPO, i.src))), 'app: los iconos del manifiesto existen');
  check(await ev(() => !!document.querySelector('link[rel="manifest"][href="manifest.webmanifest"]') && !!document.querySelector('meta[name="theme-color"]')), 'app: la página enlaza el manifiesto');
  check(!(await page.isVisible('#instalarAppBtn')), 'app: el botón de instalar está oculto si el navegador no lo ofrece');
  await ev(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__instalado = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  await page.waitForTimeout(200);
  check(await page.isVisible('#instalarAppBtn'), 'app: aparece "Instalar app" cuando el navegador lo ofrece');
  await page.click('#instalarAppBtn'); await page.waitForTimeout(200);
  check(await ev(() => window.__instalado === true) && !(await page.isVisible('#instalarAppBtn')), 'app: al pulsarlo se abre la instalación y el botón desaparece');

  // ===== PC: con las listas recogidas, las dos columnas acaban igual =====
  await page.setViewportSize({ width: 1440, height: 900 });
  await ev(() => { isWinnersExpanded = false; isHoFExpanded = false; isHistoryExpanded = false; refrescarHistorialAntiSpoiler(); });
  await page.waitForTimeout(400);
  const alturas = () => ev(() => {
    const b = id => document.querySelector(id).getBoundingClientRect();
    return { buscador: Math.round(b('.tarjeta-instrucciones').bottom), historial: Math.round(b('#historyCard').bottom), altoBuscador: Math.round(b('.tarjeta-instrucciones').height) };
  });
  const recogido = await alturas();
  check(Math.abs(recogido.buscador - recogido.historial) <= 1, 'PC: recogido, buscador e Historial acaban a la misma altura ' + JSON.stringify(recogido));
  await ev(() => toggleHoFView()); await page.waitForTimeout(400);
  const desplegado = await alturas();
  check(desplegado.altoBuscador <= recogido.altoBuscador + 1 && desplegado.historial > desplegado.buscador, 'PC: al desplegar una lista el buscador vuelve a su tamaño ' + JSON.stringify(desplegado));
  await ev(() => toggleHoFView()); await page.waitForTimeout(300);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  check(await ev(() => { const t = document.querySelector('.tarjeta-instrucciones').getBoundingClientRect(); return t.height < 600; }), 'móvil: la tarjeta del buscador no se estira');

  // ===== PC: la recreativa en marcha ocupa el hueco de la tarjeta del ganador =====
  const sorteoAntes = await db('sorteo_actual');
  await page.setViewportSize({ width: 1440, height: 900 });
  await ev(() => window.__DB__.set('sorteo_actual', { ganador: { user: '@Hueco', ticket: '1-@Hueco' }, arcadeGroup: ['@a', '@b', '@c', '@d', '@e'].map((u, i) => ({ user: u, ticket: (i + 2) + '-' + u })), timestamp: Date.now(), mesPremio: 'Octubre 2026', rawLines: 'x' }));
  await page.waitForTimeout(600);
  const caja = id => ev((sel) => { const e = document.querySelector(sel).getBoundingClientRect(); const c = document.querySelector('.col-principal').getBoundingClientRect(); return { ancho: Math.round(e.width), alto: Math.round(e.height), col: Math.round(c.width), reel: Math.round(document.getElementById('slotReel1').getBoundingClientRect().height) }; }, id);
  const ganadorPC = await caja('#winnerCard');
  await ev(() => window.__DB__.set('sorteo_actual', { status: 'programado', targetTime: Date.now() + 86400000, rawLines: 'x' }));
  await page.waitForTimeout(600);
  const slotPC = await caja('#slotMachineCard');
  check(slotPC.ancho === slotPC.col && slotPC.ancho === ganadorPC.ancho, 'PC: la recreativa ocupa todo el ancho, como el ganador ' + JSON.stringify({ slotPC, ganadorPC }));
  check(Math.abs(slotPC.alto - ganadorPC.alto) <= 20 && slotPC.reel >= 150, 'PC: la recreativa tiene la altura del ganador y rodillos grandes ' + JSON.stringify({ slotPC, ganadorPC }));
  check(await ev(() => document.documentElement.scrollWidth <= window.innerWidth), 'PC: la recreativa grande no desborda');
  // Instrucciones siempre abiertas en PC, aunque el ganador sea antiguo
  await ev(() => window.__DB__.set('sorteo_actual', { ganador: { user: '@Viejo', ticket: '1-@Viejo' }, arcadeGroup: [], timestamp: Date.now() - 40 * 86400000, mesPremio: 'Agosto 2026', rawLines: 'x' }));
  await page.waitForTimeout(400);
  check(await ev(() => document.getElementById('instruccionesElegidos').open), 'PC: instrucciones abiertas aunque el ganador sea antiguo');
  await page.click('#instruccionesElegidos summary'); await page.waitForTimeout(150);
  check(await ev(() => document.getElementById('instruccionesElegidos').open && getComputedStyle(document.querySelector('#instruccionesElegidos summary strong'), '::after').content === 'none'), 'PC: las instrucciones no se pueden plegar y no muestran flecha');
  check(await ev(() => Math.abs(document.querySelector('.tarjeta-instrucciones').getBoundingClientRect().bottom - document.getElementById('historyCard').getBoundingClientRect().bottom) <= 1), 'PC: con las instrucciones abiertas las columnas siguen acabando igual');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const slotMovil = await caja('#slotMachineCard');
  check(slotMovil.alto < 400 && slotMovil.reel < 90, 'móvil: la recreativa mantiene su tamaño ' + JSON.stringify(slotMovil));
  await page.click('#instruccionesElegidos summary'); await page.waitForTimeout(150);
  check(!(await ev(() => document.getElementById('instruccionesElegidos').open)), 'móvil: las instrucciones se siguen pudiendo plegar');
  await ev((s) => window.__DB__.set('sorteo_actual', s), sorteoAntes);
  await page.waitForTimeout(400);

  // Visitor doesn't write Telegram list
  check(!errors.some(x => !/Telegram|Sheets|Cloudflare|Failed to load|500|Error iniciando sesión|integrity|Error en la copia previa|Error añadiendo ganadores manuales|Error guardando la lista de participantes/.test(x)), 'sin errores JS inesperados: ' + JSON.stringify(errors.filter(x => !/Telegram|Sheets|Cloudflare|Failed to load|500|Error iniciando sesión|integrity|Error en la copia previa|Error añadiendo ganadores manuales|Error guardando la lista de participantes/.test(x))));
  await browser.close();
  console.log(failures ? `${failures} FALLOS` : 'TODO OK');
  process.exit(failures ? 1 : 0);
})();
