// Pruebas del Worker de Cloudflare (worker/worker.js) con Firebase, GitHub,
// Firebase Auth y Telegram simulados. Uso: npm test (desde la carpeta tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// worker.js es un módulo ES sin package.json propio: se importa desde una copia .mjs
const dir = path.dirname(fileURLToPath(import.meta.url));
const copia = path.join(os.tmpdir(), `worker-${process.pid}.mjs`);
fs.copyFileSync(path.join(dir, '..', 'worker', 'worker.js'), copia);
const { default: worker } = await import(pathToFileURL(copia).href);
fs.unlinkSync(copia);

let webhookActual = '', tgMsgId = 500, telegram = [], telegramFalla = false, telegramFallaChat = null, githubFalla = false, failPutRuta = null, tmeCalls = 0, tmeFalla = false, alLeer = null, conflictos = 0;
let db = {}, etagN = 0, github = [], urls = [], failPutResult = false;
const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
const parts = p => p.split('/').filter(Boolean);
const get = p => { let c = db; for (const k of parts(p)) { if (c == null) return null; c = c[k]; } return c === undefined ? null : c; };
const setp = (p, v) => { const ks = parts(p); let c = db; for (const k of ks.slice(0, -1)) { c[k] = c[k] || {}; c = c[k]; } if (v === null) delete c[ks.at(-1)]; else c[ks.at(-1)] = clone(v); };
const etagOf = p => 'E' + JSON.stringify(get(p)).length + '_' + Buffer.from(JSON.stringify(get(p))).toString('base64').slice(-12);
globalThis.fetch = async (url, opt = {}) => {
  urls.push(url);
  if (url.startsWith('https://identitytoolkit.googleapis.com')) {
    const tok = JSON.parse(opt.body).idToken;
    if (!url.includes('key=APIKEY')) return new Response('{}', { status: 400 });
    if (tok === 'tok-admin') return new Response(JSON.stringify({ users: [{ localId: 'UID_ADMIN' }] }));
    if (tok === 'tok-otro') return new Response(JSON.stringify({ users: [{ localId: 'UID_OTRO' }] }));
    return new Response('{"error":{}}', { status: 400 });
  }
  if (url.startsWith('https://t.me/')) { tmeCalls++; if (tmeFalla) return new Response('caído', { status: 500 }); return new Response('<html>telegram ' + tmeCalls + '</html>'); }
  if (url.startsWith('https://api.telegram.org/')) {
    const cuerpo = JSON.parse(opt.body);
    if (telegramFalla || (telegramFallaChat && cuerpo.chat_id === telegramFallaChat)) return new Response('{"ok":false}', { status: 500 });
    telegram.push({ ...cuerpo, url });
    if (url.endsWith('/getWebhookInfo')) return new Response(JSON.stringify({ ok: true, result: { url: webhookActual } }));
    if (url.endsWith('/setWebhook')) { webhookActual = cuerpo.url; return new Response('{"ok":true,"result":true}'); }
    if (url.endsWith('/forwardMessage')) return new Response(JSON.stringify({ ok: true, result: { message_id: ++tgMsgId } }));
    return new Response('{"ok":true}');
  }
  if (url.startsWith('https://api.github.com')) {
    const body = JSON.parse(opt.body);
    if (githubFalla) return new Response('{"message":"Bad credentials"}', { status: 401 });
    github.push(JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')));
    return new Response('{}', { status: 201 });
  }
  const u = new URL(url); const p = u.pathname.replace(/\.json$/, '');
  const method = opt.method || 'GET';
  if (method === 'GET') { const r = new Response(JSON.stringify(get(p)), { headers: { ETag: etagOf(p) } }); if (alLeer && alLeer(p)) alLeer = null; return r; }
  if (method === 'PUT') {
    const im = opt.headers && opt.headers['If-Match'];
    if (im && im !== '*' && im !== etagOf(p)) { conflictos++; return new Response('conflict', { status: 412 }); }
    const v = JSON.parse(opt.body);
    if (failPutResult && p === '/sorteo_actual' && v.ganador) return new Response('boom', { status: 500 });
    if (failPutRuta && p.startsWith(failPutRuta)) return new Response('boom', { status: 500 });
    setp(p, v); return new Response(opt.body);
  }
  throw new Error('método ' + method);
};
let fails = 0; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const env = { GITHUB_TOKEN: 'x' };
const run = (e = env) => worker.scheduled({}, e, {});
const lista = '1-@Alfa\n2-@Beta.\n3-@Gamma\n4-@Delta\n5-@Eps';
const programado = (extra = {}) => ({ status: 'programado', targetTime: Date.now() - 1000, rawLines: lista, rawBlacklist: '', mesPremio: 'Octubre 2026', sorteoEspecial: false, premioEspecial: '', ...extra });
const quiet = console.log; const qerr = console.error;
console.log = () => {}; console.error = () => {};
const out = []; const P = (c, m) => out.push([c, m]);

// a. sorteo normal
db = { sorteo_actual: programado(), historial_ganadores: { '-old': { user: '@Viejo', fecha: 'Sep', timestamp: 1 } } };
await run();
let h = Object.entries(db.historial_ganadores);
P(db.sorteo_actual.ganador && !db.sorteo_actual.status, 'a: resultado guardado');
P(h.length === 2 && h.some(([k]) => k.startsWith('sorteo_')), 'a: una entrada nueva en historial con clave fija');
P(db.sorteo_actual.arcadeGroup.every(x => x.user !== '@Beta.') && db.sorteo_actual.arcadeGroup.some(x => x.user === '@Beta'), 'a: @Beta. se registra como usuario @Beta');
P(github.length === 1 && github[0].tipoBackup === 'Backup automático después del sorteo' && Object.keys(github[0].historial_ganadores).length === 2, 'a: backup automático con datos de Firebase');
P(!db.sorteo_actual.tiradaPendiente, 'a: resultado final sin campos temporales');
{
  const nueva = Object.entries(db.historial_ganadores).find(([k]) => k.startsWith('sorteo_'))[1];
  P(JSON.stringify(nueva.participantes) === '[{"user":"@Alfa","boletos":1},{"user":"@Beta","boletos":1},{"user":"@Gamma","boletos":1},{"user":"@Delta","boletos":1},{"user":"@Eps","boletos":1}]' && nueva.arcade.length === 5 && nueva.arcade.includes(nueva.user), 'a: el historial guarda participantes y grupo Arcade (para la ficha)');
}
P(db.sorteo_actual.arcadeGroup.length === 5, 'a: grupo arcade de 5');
// e. ya hecho: no repite
await run();
P(Object.keys(db.historial_ganadores).length === 2, 'e: segunda ejecución no hace nada');

// b. fallo a medias y retoma
db = { sorteo_actual: programado() }; github = []; failPutResult = true;
await run();
P(db.sorteo_actual.status === 'procesando' && db.sorteo_actual.tiradaPendiente, 'b: queda en procesando con ganador guardado');
const g1 = db.sorteo_actual.tiradaPendiente.ganador.user;
P(Object.keys(db.historial_ganadores).length === 1, 'b: historial escrito antes del fallo');
failPutResult = false;
await run();
P(db.sorteo_actual.status === 'procesando', 'b: no retoma antes de 5 min');
db.sorteo_actual.processingAt = Date.now() - 6 * 60000;
await run();
P(db.sorteo_actual.ganador && db.sorteo_actual.ganador.user === g1, 'b: retoma con el MISMO ganador');
P(Object.keys(db.historial_ganadores).length === 1, 'b: sigue habiendo UNA sola entrada en historial');

// c. sin participantes
db = { sorteo_actual: programado({ rawLines: 'hola\nnadie' }) };
await run();
P(db.sorteo_actual.status === 'error' && /participantes/.test(db.sorteo_actual.error), 'c: sin participantes queda en error');
P(db.sorteo_actual.rawLines === 'hola\nnadie', 'c: conserva la lista original');
const snapC = JSON.stringify(db); await run();
P(JSON.stringify(db) === snapC && !db.historial_ganadores, 'c: en error el cron no reintenta');

// d. todos en lista negra
db = { sorteo_actual: programado({ rawLines: '1-@A\n2-@B', rawBlacklist: '@a\n@b' }) };
await run();
P(db.sorteo_actual.status === 'error' && /Lista Negra/.test(db.sorteo_actual.error), 'd: todos en lista negra queda en error');

// f. no ha llegado la hora
db = { sorteo_actual: programado({ targetTime: Date.now() + 60000 }) };
await run();
P(db.sorteo_actual.status === 'programado', 'f: antes de la hora no hace nada');

// i. conflicto de bloqueo: otro cambia el dato entre lectura y bloqueo
db = { sorteo_actual: programado() };
const realFetch = globalThis.fetch; let first = true;
globalThis.fetch = async (url, opt = {}) => { const r = await realFetch(url, opt); if (first && (opt.method || 'GET') === 'GET' && url.includes('sorteo_actual')) { first = false; db.sorteo_actual.rawLines += '\n6-@Nuevo'; } return r; };
await run();
globalThis.fetch = realFetch;
P(db.sorteo_actual.status === 'programado' && !db.historial_ganadores, 'i: si cambia entre lectura y bloqueo, no sortea');

// g. secreto
urls = []; db = { sorteo_actual: programado() };
await run({ GITHUB_TOKEN: 'x', FIREBASE_SECRET: 's3cr3t' });
const fbUrls = urls.filter(u => u.includes('firebasedatabase'));
P(fbUrls.length > 0 && fbUrls.every(u => u.includes('auth=s3cr3t')), 'g: con FIREBASE_SECRET todas las llamadas a Firebase llevan auth');
urls = []; db = { sorteo_actual: programado() }; await run();
P(urls.filter(u => u.includes('firebasedatabase')).every(u => !u.includes('auth=')), 'g: sin secreto, sin auth (como ahora)');

// h. /backup ignora el cuerpo
github = []; db = { historial_ganadores: { k: { user: '@Real' } }, mes_sorteo: 'Octubre' };
const envAdmin = { GITHUB_TOKEN: 'x', ADMIN_UIDS: 'UID_ADMIN', FIREBASE_API_KEY: 'APIKEY' };
const res = await worker.fetch(new Request('https://w/backup', { method: 'POST', headers: { Authorization: 'Bearer tok-admin' }, body: JSON.stringify({ historial_ganadores: { x: { user: '@FALSO' } } }) }), envAdmin);
const jr = await res.json();
P(res.status === 200 && jr.ok && jr.archivo.startsWith('backups/'), 'h: /backup responde ok y archivo');
P(github.length === 1 && JSON.stringify(github[0]).includes('@Real') && !JSON.stringify(github[0]).includes('@FALSO'), 'h: backup con datos de Firebase, no del cuerpo');
P(github[0].tipoBackup === 'Backup manual desde la web', 'h: tipo manual');
github = []; db = { historial_ganadores: { k: { user: '@Real' } }, config_sorteo_especial: { activo: true, premio: 'Mando' }, juegos_proximo_sorteo: { mes: 'Noviembre', juegosMes: [], juegosArcade: [] }, sorteo_participantes_raw: '1-@Real' };
await worker.fetch(new Request('https://w/backup', { method: 'POST', headers: { Authorization: 'Bearer tok-admin' }, body: '{}' }), envAdmin);
P(github.length === 1 && github[0].config_sorteo_especial.premio === 'Mando' && github[0].juegos_proximo_sorteo.mes === 'Noviembre' && github[0].sorteo_participantes_raw === '1-@Real', 'h: la copia incluye casilla especial, juegos del mes y lista de participantes');
const r405 = await worker.fetch(new Request('https://w/backup'), env);
P(r405.status === 405, 'h: GET /backup → 405');
github = [];
const sinUids = await worker.fetch(new Request('https://w/backup', { method: 'POST', headers: { Authorization: 'Bearer tok-admin' }, body: '{}' }), env);
const sinUidsVacio = await worker.fetch(new Request('https://w/backup', { method: 'POST', headers: { Authorization: 'Bearer tok-admin' }, body: '{}' }), { ...envAdmin, ADMIN_UIDS: ' ' });
P(sinUids.status === 401 && sinUidsVacio.status === 401 && github.length === 0, 'h: sin ADMIN_UIDS (o vacío) nadie puede pedir copias → 401');


// j. autorización de /backup con ADMIN_UIDS
const envAuth = { GITHUB_TOKEN: 'x', ADMIN_UIDS: 'UID_ADMIN, UID_DOS', FIREBASE_API_KEY: 'APIKEY' };
const post = (h = {}) => worker.fetch(new Request('https://w/backup', { method: 'POST', headers: h, body: '{}' }), envAuth);
github = [];
P((await post()).status === 401, 'j: sin token → 401');
P((await post({ Authorization: 'Bearer basura' })).status === 401, 'j: token inválido → 401');
P((await post({ Authorization: 'Bearer tok-otro' })).status === 401, 'j: cuenta no admin → 401');
P(github.length === 0, 'j: ningún backup sin autorización');
const ok = await post({ Authorization: 'Bearer tok-admin' });
P(ok.status === 200 && github.length === 1, 'j: admin → backup creado');
P((await worker.fetch(new Request('https://w/backup', { method: 'POST', headers: { Authorization: 'Bearer tok-admin' } }), { ...envAuth, FIREBASE_API_KEY: undefined })).status === 401, 'j: sin FIREBASE_API_KEY → 401');
const opt = await worker.fetch(new Request('https://w/backup', { method: 'OPTIONS' }), envAuth);
P(opt.headers.get('Access-Control-Allow-Headers').includes('Authorization'), 'j: CORS permite Authorization');


// k. errores devuelven JSON con CORS
const realF = globalThis.fetch;
globalThis.fetch = async (url, opt) => { if (url.includes('identitytoolkit')) throw new Error('red caída'); return realF(url, opt); };
let rk = await post({ Authorization: 'Bearer tok-admin' });
P(rk.status === 500 && rk.headers.get('Access-Control-Allow-Origin') && (await rk.json()).ok === false, 'k: fallo verificando token → 500 con CORS (no Failed to fetch)');
globalThis.fetch = async (url, opt) => { if (url.includes('firebasedatabase')) return new Response('{"error":"Unauthorized"}', { status: 401 }); return realF(url, opt); };
rk = await post({ Authorization: 'Bearer tok-admin' });
const jk = await rk.json();
P(rk.status === 500 && rk.headers.get('Access-Control-Allow-Origin') && jk.error.includes('FIREBASE_SECRET'), 'k: secreto mal → mensaje que lo indica');
globalThis.fetch = realF;

// l. lista negra privada (web nueva)
const progNuevo = (extra = {}) => { const p = programado(extra); delete p.rawBlacklist; return p; };
let elegidos = new Set();
for (let i = 0; i < 25; i++) {
  const t = Date.now() - 1000 - i;
  db = { sorteo_actual: progNuevo({ targetTime: t, rawLines: '1-@Alfa\n2-@Beta\n3-@Gamma' }), sorteo_privado: { rawBlacklist: '@alfa\n@beta', targetTime: t } };
  await run();
  elegidos.add(db.sorteo_actual.ganador.user);
}
P(elegidos.size === 1 && elegidos.has('@Gamma'), 'l: respeta la lista negra privada (25 sorteos, siempre @Gamma)');
P(!('rawBlacklist' in db.sorteo_actual) && !('log' in db.sorteo_actual), 'l: el resultado público no lleva lista negra ni registro');
P(Array.isArray(db.sorteo_privado.log) && db.sorteo_privado.log.some(l => l.includes('Lista Negra') || l.includes('GANADORA')), 'l: el registro se guarda en sorteo_privado');
P(db.sorteo_privado.rawBlacklist === '@alfa\n@beta', 'l: la lista negra sigue en sorteo_privado');
P(db.sorteo_actual.revealAt - Date.now() > 25000 && db.sorteo_actual.revealAt - Date.now() <= 30000, 'l: revealAt unos 30 s en el futuro');

// lock público sin log ni lista negra
db = { sorteo_actual: programado({ rawBlacklist: '@zzz' }) }; failPutResult = true;
await run(); failPutResult = false;
P(db.sorteo_actual.status === 'procesando' && !('rawBlacklist' in db.sorteo_actual) && !('log' in db.sorteo_actual.tiradaPendiente), 'l: el bloqueo público no lleva lista negra ni registro');
db.sorteo_actual.processingAt = Date.now() - 6 * 60000; await run();
P(db.sorteo_actual.ganador && !('rawBlacklist' in db.sorteo_actual), 'l: retomado tras fallo, sigue sin lista negra pública');

// compatibilidad: web antigua con lista negra en sorteo_actual
db = { sorteo_actual: programado({ rawLines: '1-@A\n2-@B', rawBlacklist: '@a' }) };
await run();
P(db.sorteo_actual.ganador.user === '@B' && !('rawBlacklist' in db.sorteo_actual), 'l: web antigua: usa su lista negra y no la publica');

// no se encuentra la lista negra de este sorteo
db = { sorteo_actual: progNuevo(), sorteo_privado: { rawBlacklist: '@x', targetTime: 123 } };
await run();
P(db.sorteo_actual.status === 'error' && /Lista Negra de este sorteo/.test(db.sorteo_actual.error), 'l: lista negra de otro sorteo → error, no sortea');
db = { sorteo_actual: progNuevo() };
await run();
P(db.sorteo_actual.status === 'error', 'l: sin sorteo_privado → error, no sortea');

// l2. Con dos líneas idénticas, el grupo Arcade sale alrededor de la línea premiada
{
  const original = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = arr => { arr[0] = 6; return arr; };   // posición 6: el segundo "3-@C"
  db = { sorteo_actual: programado({ rawLines: '1-@A\n2-@B\n3-@C\n4-@D\n5-@E\n6-@F\n3-@C\n7-@G\n8-@H' }) };
  await run();
  crypto.getRandomValues = original;
  const grupo = (db.sorteo_actual.arcadeGroup || []).map(p => p.user).join(',');
  P(db.sorteo_actual.ganador.user === '@C' && grupo === '@E,@F,@C,@G,@H', 'l2: grupo Arcade alrededor de la línea repetida premiada ' + grupo);
}

// p. cambio de mes automático 25 h después de un sorteo programado
{
  db = { sorteo_actual: programado(), mes_sorteo: 'Octubre' };
  const antes = Date.now(); await run();
  const espera = db.sorteo_actual.cambioMesAt - antes;
  P(db.sorteo_actual.ganador && espera >= 25 * 3600000 && espera < 25 * 3600000 + 60000 && db.mes_sorteo === 'Octubre', 'p: el sorteo programado guarda la hora del cambio de mes (25 h) sin cambiarlo aún');
  db = { sorteo_prueba: programado(), mes_sorteo: 'Octubre' }; await run();
  P(db.sorteo_prueba.ganador && !('cambioMesAt' in db.sorteo_prueba), 'p: la tirada de prueba no programa cambio de mes');

  const conGanador = (extra = {}) => ({ ganador: { user: '@A', ticket: '1-@A' }, arcadeGroup: [], timestamp: 1, mesPremio: 'Octubre 2026', rawLines: 'x', ...extra });
  db = { sorteo_actual: conGanador({ cambioMesAt: Date.now() + 60000 }), mes_sorteo: 'Octubre' }; await run();
  P(db.mes_sorteo === 'Octubre' && db.sorteo_actual.ganador, 'p: antes de las 25 h no cambia nada');
  db = { sorteo_actual: conGanador(), mes_sorteo: 'Octubre' }; await run();
  P(db.mes_sorteo === 'Octubre' && db.sorteo_actual.ganador, 'p: un sorteo sin hora de cambio (inmediato o antiguo) no cambia el mes');

  db = { sorteo_actual: conGanador({ cambioMesAt: Date.now() - 1000 }), mes_sorteo: 'Octubre' }; await run();
  P(db.mes_sorteo === 'Noviembre' && JSON.stringify(db.sorteo_actual) === '{"status":"inactivo"}', 'p: pasadas las 25 h, Octubre → Noviembre y el sorteo queda inactivo');
  await run();
  P(db.mes_sorteo === 'Noviembre', 'p: el mes no avanza dos veces');
  db = { sorteo_actual: conGanador({ cambioMesAt: Date.now() - 1000 }), mes_sorteo: 'Diciembre' }; await run();
  P(db.mes_sorteo === 'Enero', 'p: Diciembre → Enero');
  db = { sorteo_actual: conGanador({ cambioMesAt: Date.now() - 1000, mesPremio: 'Marzo 2027' }) }; await run();
  P(db.mes_sorteo === 'Abril', 'p: sin mes guardado usa el del premio (Marzo → Abril)');
  db = { sorteo_actual: conGanador({ cambioMesAt: Date.now() - 1000, especial: true, premioEspecial: 'Bolsa' }), mes_sorteo: 'Octubre' }; await run();
  P(db.mes_sorteo === 'Noviembre', 'p: también tras un Sorteo Especial programado');

  // Un admin programa otro sorteo justo entre la lectura y la escritura: no se pisa
  db = { sorteo_actual: conGanador({ cambioMesAt: Date.now() - 1000 }), mes_sorteo: 'Octubre' };
  // La 1ª lectura de sorteo_actual es la del sorteo; la 2ª, la del cambio de mes
  let lecturas = 0; conflictos = 0;
  alLeer = ruta => { if (ruta !== '/sorteo_actual' || ++lecturas < 2) return false; db.sorteo_actual = { status: 'programado', targetTime: Date.now() + 86400000, rawLines: 'y' }; return true; };
  await run();
  P(lecturas === 2 && conflictos === 1 && db.sorteo_actual.status === 'programado' && db.mes_sorteo === 'Octubre', 'p: si el sorteo cambia mientras tanto, no se pisa ni se cambia el mes');
  alLeer = null;
}

// m. proxy de Telegram solo desde la web
const tg = h => worker.fetch(new Request('https://w/?url=x', { headers: h }), env);
P((await tg({})).status === 403, 'm: proxy sin Origin → 403');
P((await tg({ Origin: 'https://malo.com' })).status === 403, 'm: proxy desde otra web → 403');
const rOk = await tg({ Origin: 'https://kb-retro.github.io' });
P(rOk.status === 200 && (await rOk.text()).includes('telegram') && rOk.headers.get('Access-Control-Allow-Origin') === 'https://kb-retro.github.io', 'm: proxy desde la web → 200');
P((await tg({ Referer: 'https://kb-retro.github.io/Sorteo-HoF-Patrulla-Retro/' })).status === 200, 'm: proxy con Referer de la web → 200');
// Copia de 1 minuto del canal
const tgUrl = (q, h) => worker.fetch(new Request('https://w/?url=x' + q, { headers: h }), env);
const web = { Origin: 'https://kb-retro.github.io' };
tmeCalls = 0;
const c1 = await (await tgUrl('', web)).text(); const c2 = await (await tgUrl('', web)).text();
P(tmeCalls === 0 && c1 === c2, 'm: las visitas seguidas usan la copia, sin descargar el canal otra vez');
const tgAdmin = (q, h) => worker.fetch(new Request('https://w/?url=x' + q, { headers: h }), envAuth);
await tgAdmin('&fresco=1', web); await tgAdmin('&fresco=1', { ...web, Authorization: 'Bearer tok-otro' });
P(tmeCalls === 0, 'm: "fresco=1" sin sesión de admin (o de otra cuenta) usa la copia');
const c3 = await (await tgAdmin('&fresco=1', { ...web, Authorization: 'Bearer tok-admin' })).text();
P(tmeCalls === 1 && c3.includes('telegram 1'), 'm: "fresco=1" de un admin descarga el canal de nuevo');
tmeFalla = true;
const rCaido = await tgAdmin('&fresco=1', { ...web, Authorization: 'Bearer tok-admin' });
P(rCaido.status === 200 && (await rCaido.text()) === c3, 'm: si Telegram falla, se sirve la última copia');
// Un Worker recién arrancado (sin copia) con Telegram caído responde 502 con CORS
const copia2 = path.join(os.tmpdir(), `worker2-${process.pid}.mjs`);
fs.copyFileSync(path.join(dir, '..', 'worker', 'worker.js'), copia2);
const { default: worker2 } = await import(pathToFileURL(copia2).href);
fs.unlinkSync(copia2);
const r502 = await worker2.fetch(new Request('https://w/?url=x', { headers: web }), env);
P(r502.status === 502 && r502.headers.get('Access-Control-Allow-Origin') === 'https://kb-retro.github.io', 'm: sin copia y con Telegram caído → 502 con CORS');
tmeFalla = false;

// n. avisos de Telegram
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn) => { fn(); return 0; };   // sin esperar los 30 s
const envTg = { GITHUB_TOKEN: 'x', TELEGRAM_BOT_TOKEN: 'BOT123', TELEGRAM_CHAT_ID: '@canal_sorteo' };
telegram = []; urls = [];
db = { sorteo_actual: programado({ rawLines: '7-@Ganador', mesPremio: 'Noviembre 2026' }) };
await run(envTg);
P(telegram.length === 1 && telegram[0].chat_id === '@canal_sorteo' && telegram[0].url.includes('/botBOT123/sendMessage'), 'n: anuncia el resultado en el canal configurado');
P(telegram[0].text.includes('@Ganador') && telegram[0].text.includes('Boleto Nº 7') && telegram[0].text.includes('Noviembre 2026') && telegram[0].text.includes('kb-retro.github.io'), 'n: el mensaje lleva ganador, boleto, mes y enlace');
telegram = [];
db = { sorteo_actual: programado({ rawLines: '1-@Ana\n2-@Bea\n3-@Carla\n4-@Dani\n5-@Eva\n6-@Fede', rawBlacklist: '@ana\n@bea\n@dani\n@eva\n@fede' }) };
await run(envTg);
const txtArcade = telegram[0].text;
P(txtArcade.includes('Eligen el Arcade del Mes (5 usuarios)') && ['@Ana (Nº 1)', '@Bea (Nº 2)', '@Carla (Nº 3) 🏆', '@Dani (Nº 4)', '@Eva (Nº 5)'].every(x => txtArcade.includes('• ' + x)), 'n: lista los 5 que eligen Arcade, con el ganador marcado');
P(txtArcade.indexOf('@Ana') < txtArcade.indexOf('@Bea') && txtArcade.indexOf('@Bea') < txtArcade.indexOf('@Carla (Nº 3)') && txtArcade.indexOf('@Carla (Nº 3)') < txtArcade.indexOf('@Dani'), 'n: en el mismo orden que la web');
telegram = [];
db = { sorteo_actual: programado({ sorteoEspecial: true, premioEspecial: 'Mando retro' }) };
await run(envTg);
P(telegram.length === 1 && telegram[0].text.includes('Sorteo Especial') && telegram[0].text.includes('Mando retro'), 'n: sorteo especial con su premio');
P(telegram[0].text.includes('Eligen el Arcade del Mes (5 usuarios)') && telegram[0].text.includes('🎁 Premio:'), 'n: el sorteo especial también lista a los del Arcade, con su premio');
telegram = [];
db = { sorteo_actual: programado({ rawLines: 'nadie' }) };
await run(envTg);
P(telegram.length === 0, 'n: un error no se anuncia en el canal público');
await run({ ...envTg, TELEGRAM_ADMIN_CHAT_ID: '-100999' });
P(telegram.length === 0, 'n: un sorteo ya en error no vuelve a avisar');
db = { sorteo_actual: programado({ rawLines: 'nadie' }) };
await run({ ...envTg, TELEGRAM_ADMIN_CHAT_ID: '-100999' });
P(telegram.length === 1 && telegram[0].chat_id === '-100999' && telegram[0].text.includes('no se ha podido realizar'), 'n: el error se avisa solo al chat de admins');
telegram = []; telegramFalla = true;
db = { sorteo_actual: programado() };
await run(envTg);
P(db.sorteo_actual.ganador && !db.sorteo_actual.status, 'n: si Telegram falla, el sorteo se completa igual');
telegramFalla = false; telegram = []; urls = [];
db = { sorteo_actual: programado() };
await run();
P(!urls.some(u => u.includes('api.telegram.org')), 'n: sin secretos de Telegram no se envía nada');

// o. tiradas de prueba
telegram = []; github = []; urls = [];
const envTodo = { ...envTg, TELEGRAM_ADMIN_CHAT_ID: '-100999' };
const realFuturo = programado({ targetTime: Date.now() + 5 * 3600000 });   // fuera de la hora del recordatorio
db = { sorteo_actual: realFuturo, historial_ganadores: { h1: { user: '@Viejo' } },
       sorteo_prueba: { status: 'programado', targetTime: Date.now() - 1000, rawLines: '1-@Uno\n2-@Dos\n3-@Tres', rawBlacklist: '@uno\n@dos', mesPremio: 'Octubre 2026', prueba: true } };
await run(envTodo);
const sp = db.sorteo_prueba;
P(sp.ganador && sp.ganador.user === '@Tres' && sp.prueba === true && sp.revealAt > Date.now(), 'o: la prueba se sortea, respeta su lista negra y tiene cuenta atrás');
P(Array.isArray(sp.log) && sp.rawBlacklist === '@uno\n@dos', 'o: la prueba guarda su registro y su lista negra (nodo privado)');
P(Object.keys(db.historial_ganadores).length === 1, 'o: la prueba no toca el historial');
P(github.length === 0, 'o: la prueba no hace backup en GitHub');
P(telegram.length === 0 && !urls.some(u => u.includes('api.telegram.org')), 'o: la prueba no envía nada a Telegram (ni al chat de admins)');
P(JSON.stringify(db.sorteo_actual) === JSON.stringify(realFuturo), 'o: la prueba no toca el sorteo real programado');
db.sorteo_prueba = { status: 'programado', targetTime: Date.now() - 1000, rawLines: 'nadie', prueba: true };
telegram = [];
await run(envTodo);
P(db.sorteo_prueba.status === 'error' && telegram.length === 0, 'o: prueba fallida queda en error sin avisar por Telegram');
// real y prueba a la vez
telegram = []; github = [];
db = { sorteo_actual: programado({ rawLines: '9-@Real' }),
       sorteo_prueba: { status: 'programado', targetTime: Date.now() - 1000, rawLines: '5-@Probando', rawBlacklist: '', prueba: true } };
await run(envTodo);
P(db.sorteo_actual.ganador.user === '@Real' && db.sorteo_prueba.ganador.user === '@Probando', 'o: real y prueba a la vez se resuelven cada uno en su sitio');
P(Object.values(db.historial_ganadores).map(h => h.user).join() === '@Real' && github.length === 1 && telegram.length === 1 && telegram[0].text.includes('@Real') && !telegram[0].text.includes('@Probando'), 'o: solo el real va al historial, al backup y a Telegram');
// un fallo en la prueba no afecta al real
db = { sorteo_actual: programado({ rawLines: '9-@Real' }), sorteo_prueba: { status: 'procesando', targetTime: 1, processingAt: Date.now() - 600000, tiradaPendiente: { ganador: null } } };
await run(envTodo);
P(db.sorteo_actual.ganador && db.sorteo_actual.ganador.user === '@Real', 'o: un problema en la prueba no impide el sorteo real');

// q. avisos de error al chat de los admins
{
  const envAv = { GITHUB_TOKEN: 'x', TELEGRAM_BOT_TOKEN: 'BOT123', TELEGRAM_CHAT_ID: '@canal_sorteo', TELEGRAM_ADMIN_CHAT_ID: '-100999' };
  const aAdmins = () => telegram.filter(t => t.chat_id === '-100999');
  telegram = [];
  db = { sorteo_actual: programado() };
  await run(envAv);
  P(aAdmins().length === 0, 'q: un sorteo sin problemas no avisa a los admins');

  telegram = []; failPutRuta = '/historial_ganadores';
  db = { sorteo_actual: programado() };
  await run(envAv); failPutRuta = null;
  P(aAdmins().length === 1 && aAdmins()[0].text.includes('historial') && aAdmins()[0].text.includes('5 minutos') && !telegram.some(t => t.chat_id === '@canal_sorteo'), 'q: si no se guarda el historial, aviso a los admins (nada en el canal)');

  telegram = []; failPutResult = true;
  db = { sorteo_actual: programado() };
  await run(envAv); failPutResult = false;
  P(aAdmins().length === 1 && aAdmins()[0].text.includes('resultado'), 'q: si no se guarda el resultado, aviso a los admins');

  telegram = []; githubFalla = true;
  db = { sorteo_actual: programado({ rawLines: '3-@Suerte' }) };
  await run(envAv); githubFalla = false;
  P(db.sorteo_actual.ganador && aAdmins().length === 1 && aAdmins()[0].text.includes('copia automática') && aAdmins()[0].text.includes('@Suerte'), 'q: si falla la copia en GitHub, aviso a los admins con el ganador');
  P(telegram.some(t => t.chat_id === '@canal_sorteo'), 'q: aunque falle la copia, se anuncia el ganador en el canal');

  telegram = []; telegramFallaChat = '@canal_sorteo';
  db = { sorteo_actual: programado({ rawLines: '3-@Suerte' }) };
  await run(envAv); telegramFallaChat = null;
  P(aAdmins().length === 1 && aAdmins()[0].text.includes('no pudo anunciarlo'), 'q: si el canal rechaza el anuncio, aviso a los admins');

  telegram = []; failPutRuta = '/mes_sorteo';
  db = { sorteo_actual: { ganador: { user: '@A', ticket: '1-@A' }, arcadeGroup: [], timestamp: 1, mesPremio: 'Octubre 2026', cambioMesAt: Date.now() - 1000 }, mes_sorteo: 'Octubre' };
  await run(envAv); failPutRuta = null;
  P(db.mes_sorteo === 'Octubre' && aAdmins().length === 1 && aAdmins()[0].text.includes('Noviembre') && aAdmins()[0].text.includes('a mano'), 'q: si no se puede cambiar el mes, aviso a los admins');

  telegram = []; failPutResult = true; githubFalla = true;
  db = { sorteo_prueba: { status: 'programado', targetTime: Date.now() - 1000, rawLines: '1-@Uno', rawBlacklist: '', prueba: true } };
  await run(envAv); failPutResult = false; githubFalla = false;
  P(telegram.length === 0, 'q: las tiradas de prueba nunca avisan');

  telegram = []; githubFalla = true;
  db = { sorteo_actual: programado() };
  await run({ GITHUB_TOKEN: 'x', TELEGRAM_BOT_TOKEN: 'BOT123', TELEGRAM_CHAT_ID: '@canal_sorteo' }); githubFalla = false;
  P(telegram.length === 1 && telegram[0].chat_id === '@canal_sorteo', 'q: sin TELEGRAM_ADMIN_CHAT_ID no se avisa a nadie más');
}

// r. recordatorio en el canal antes del sorteo
{
  const envR = { GITHUB_TOKEN: 'x', TELEGRAM_BOT_TOKEN: 'BOT123', TELEGRAM_CHAT_ID: '@canal_sorteo', TELEGRAM_ADMIN_CHAT_ID: '-100999' };
  // Sorteo dentro de dos horas
  const objetivo = Date.now() + 2 * 3600000;
  telegram = [];
  db = { sorteo_actual: programado({ targetTime: objetivo, rawLines: '1-@Ana\n2-@Bea\n3-@ana PUNTO EXTRA\nsin usuario', mesPremio: 'Noviembre 2026' }) };
  await run(envR);
  const rec = telegram.filter(t => t.chat_id === '@canal_sorteo');
  const horaEsp = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(objetivo);
  P(rec.length === 1 && rec[0].text.includes('⏰') && rec[0].text.includes('Sorteo HoF de Noviembre 2026') && rec[0].text.includes('a las ' + horaEsp) && rec[0].text.includes('kb-retro.github.io'), 'r: faltando menos de 3 h se envía el recordatorio al canal con mes, hora y enlace');
  P(rec.length === 1 && rec[0].text.includes('3 boletos de 2 participantes'), 'r: el recordatorio cuenta boletos y personas distintas');
  P(db.sorteo_actual.status === 'programado' && db.estado_bot.recordatorio === objetivo, 'r: no toca el sorteo y apunta que ya se recordó');
  await run(envR); await run(envR);
  P(telegram.length === 1, 'r: solo se envía una vez por sorteo');
  db.sorteo_actual.targetTime = objetivo + 600000; await run(envR);
  P(telegram.length === 2, 'r: si se vuelve a programar a otra hora, hay recordatorio nuevo');

  telegram = [];
  db = { sorteo_actual: programado({ targetTime: Date.now() + 4 * 3600000 }) }; await run(envR);
  P(telegram.length === 0 && !db.estado_bot, 'r: faltando más de 3 h todavía no se envía');
  db = { sorteo_actual: programado({ targetTime: Date.now() + 5 * 60000 }) }; await run(envR);
  P(telegram.length === 0, 'r: faltando menos de 10 min no se envía');
  db = { sorteo_prueba: { status: 'programado', targetTime: Date.now() + 3600000, rawLines: '1-@Uno', prueba: true } }; await run(envR);
  P(telegram.length === 0, 'r: las tiradas de prueba no tienen recordatorio');
  db = { sorteo_actual: programado({ targetTime: Date.now() + 3600000 }) }; await run({ GITHUB_TOKEN: 'x' });
  P(telegram.length === 0 && !db.estado_bot, 'r: sin secretos de Telegram no se envía nada');
  db = { sorteo_actual: programado({ targetTime: Date.now() + 3600000, sorteoEspecial: true, premioEspecial: 'Mando retro', mesPremio: 'Diciembre 2026' }) }; await run(envR);
  P(telegram.length === 1 && telegram[0].text.includes('Sorteo Especial de Diciembre 2026') && telegram[0].text.includes('Premio: Mando retro'), 'r: Sorteo Especial con su premio');
  telegram = [];
  db = { sorteo_actual: programado({ targetTime: Date.now() + 3600000 }), estado_bot: { recordatorio: 1 } };
  const realF2 = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => { if (url.includes('estado_bot') && (opt.method || 'GET') === 'PUT') { db.estado_bot = { recordatorio: 999 }; } return realF2(url, opt); };
  await run(envR); globalThis.fetch = realF2;
  P(telegram.length === 0, 'r: si otra ejecución lo apunta a la vez, no se envía dos veces');
}

// s. avisos de menciones con foto
{
  const envM = { GITHUB_TOKEN: 'x', TELEGRAM_BOT_TOKEN: 'BOT123', TELEGRAM_CHAT_ID: '@canal_sorteo', TELEGRAM_MENCIONES_CHAT_ID: '777' };
  const metodo = t => t.url.split('/').pop();
  // Conexión automática del bot con el Worker (desde el cron)
  telegram = []; webhookActual = ''; db = {};
  await run(envM);
  const set = telegram.find(t => metodo(t) === 'setWebhook');
  P(set && webhookActual === 'https://dawn-band-8bc8.microbiops.workers.dev/telegram' && set.secret_token.length >= 32 && JSON.stringify(set.allowed_updates) === '["message","callback_query"]', 'm2: el cron conecta el bot con el Worker (solo mensajes y botones)');
  const clave = set.secret_token;
  telegram = []; await run(envM);
  P(!telegram.some(t => metodo(t) === 'setWebhook'), 'm2: no lo vuelve a conectar en cada minuto');
  // Sin el secreto no hace nada
  const copia3 = path.join(os.tmpdir(), `worker3-${process.pid}.mjs`);
  fs.copyFileSync(path.join(dir, '..', 'worker', 'worker.js'), copia3);
  const { default: worker3 } = await import(pathToFileURL(copia3).href);
  fs.unlinkSync(copia3);
  telegram = []; webhookActual = '';
  await worker3.scheduled({}, envTg, {});
  P(!telegram.some(t => ['getWebhookInfo', 'setWebhook'].includes(metodo(t))), 'm2: sin TELEGRAM_MENCIONES_CHAT_ID no se toca el bot');
  // Si el bot ya envía a otro sitio, no se cambia
  webhookActual = 'https://otro.programa/hook'; telegram = [];
  await worker3.scheduled({}, envM, {});
  P(webhookActual === 'https://otro.programa/hook' && !telegram.some(t => metodo(t) === 'setWebhook'), 'm2: si el bot ya se usa en otro sitio, no se toca');

  const enviar = (update, cabecera = clave, e = envM) => worker.fetch(new Request('https://w/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': cabecera, 'Content-Type': 'application/json' }, body: JSON.stringify(update) }), e);
  const grupo = { id: -1001234567890, type: 'supergroup', title: 'Patrulla' };
  const foto = (extra = {}) => ({ message: { message_id: 42, date: 1793563200, chat: grupo, from: { id: 5, username: 'Pepito' }, photo: [{ file_id: 'a' }], caption: 'Mi juego terminado @M_1_c_h_3_l', caption_entities: [{ type: 'mention', offset: 19, length: 12 }], ...extra } });

  telegram = [];
  P((await enviar(foto(), 'mala')).status === 401 && telegram.length === 0, 'm2: un envío sin la clave de Telegram se rechaza');
  P((await enviar(foto(), clave, { GITHUB_TOKEN: 'x' })).status === 404, 'm2: sin los secretos la ruta no existe');
  const r = await enviar(foto());
  const fw = telegram.find(t => metodo(t) === 'forwardMessage'), av = telegram.find(t => metodo(t) === 'sendMessage');
  P(r.status === 200 && fw && fw.chat_id === '777' && fw.from_chat_id === grupo.id && fw.message_id === 42, 'm2: foto con mención → se reenvía por privado');
  P(av && av.chat_id === '777' && av.text.includes('@Pepito te ha mencionado con una foto') && av.text.includes('01/11 a las 21:00') && av.text.includes('Mi juego terminado') && av.text.includes('https://t.me/c/1234567890/42') && av.reply_markup.inline_keyboard[0][0].callback_data === 'apuntado' && av.reply_parameters.message_id === tgMsgId, 'm2: aviso con autor, texto, enlace y botón para marcar ' + JSON.stringify(av && av.text));

  telegram = [];
  await enviar(foto({ caption: 'hola @m_1_C_h_3_L!', caption_entities: [] }));
  P(telegram.filter(t => metodo(t) === 'sendMessage').length === 1, 'm2: la mención funciona sin distinguir mayúsculas');
  telegram = [];
  await enviar(foto({ caption: 'mira esto', caption_entities: [{ type: 'text_mention', offset: 5, length: 4, user: { id: 777 } }] }));
  P(telegram.filter(t => metodo(t) === 'sendMessage').length === 1, 'm2: también al tocar su nombre (mención sin @)');
  telegram = [];
  await enviar(foto({ caption: 'varias', caption_entities: [], media_group_id: 'g1' }));
  await enviar(foto({ caption: '@M_1_c_h_3_l álbum', caption_entities: [], media_group_id: 'g1' }));
  await enviar(foto({ caption: undefined, caption_entities: undefined, media_group_id: 'g1' }));
  const avisosAlbum = telegram.filter(t => metodo(t) === 'sendMessage');
  P(avisosAlbum.length === 1 && avisosAlbum[0].text.includes('varias fotos'), 'm2: un álbum de varias fotos da un solo aviso');
  telegram = [];
  await enviar(foto({ document: { mime_type: 'image/png' }, photo: undefined }));
  P(telegram.filter(t => metodo(t) === 'sendMessage').length === 1, 'm2: también si la imagen se envía como archivo');

  telegram = [];
  await enviar(foto({ photo: undefined, text: 'hola @M_1_c_h_3_l', caption: undefined }));
  await enviar(foto({ caption: 'hola @Otro', caption_entities: [] }));
  await enviar(foto({ caption: 'hola @M_1_c_h_3_lx', caption_entities: [] }));
  await enviar(foto({ chat: { id: 9, type: 'private' } }));
  await enviar(foto({ from: { id: 777, username: 'M_1_c_h_3_l' } }));
  await enviar(foto({ document: { mime_type: 'application/pdf' }, photo: undefined }));
  P(telegram.length === 0, 'm2: sin foto, sin mención, otro usuario, chat privado o él mismo → nada');

  // Botón de apuntado
  const textoAviso = av.text;
  const pulsar = (data, chatId = 777) => enviar({ callback_query: { id: 'cb1', data, message: { message_id: 600, chat: { id: chatId, type: 'private' }, text: textoAviso } } });
  telegram = [];
  await pulsar('apuntado');
  const ed = telegram.find(t => metodo(t) === 'editMessageText');
  P(ed && ed.text.startsWith(textoAviso) && ed.text.includes('✅ Apuntado el ') && ed.reply_markup.inline_keyboard[0][0].callback_data === 'desmarcar' && telegram.some(t => metodo(t) === 'answerCallbackQuery'), 'm2: al pulsar el botón el aviso queda marcado como apuntado');
  telegram = [];
  await enviar({ callback_query: { id: 'cb2', data: 'desmarcar', message: { message_id: 600, chat: { id: 777, type: 'private' }, text: ed.text } } });
  const ed2 = telegram.find(t => metodo(t) === 'editMessageText');
  P(ed2 && ed2.text === textoAviso && ed2.reply_markup.inline_keyboard[0][0].callback_data === 'apuntado', 'm2: se puede desmarcar');
  telegram = [];
  await pulsar('apuntado', 12345);
  P(!telegram.some(t => metodo(t) === 'editMessageText') && telegram.some(t => metodo(t) === 'answerCallbackQuery'), 'm2: un botón fuera de su chat no cambia nada');
  telegram = [];
  P((await enviar('basura')).status === 200 && telegram.length === 0, 'm2: un envío raro se ignora sin errores');
}

globalThis.setTimeout = realTimeout;

console.log = quiet; console.error = qerr;
out.forEach(([c, m]) => check(c, m));
console.log(fails ? fails + ' FALLOS' : 'TODO OK');
process.exit(fails ? 1 : 0);
