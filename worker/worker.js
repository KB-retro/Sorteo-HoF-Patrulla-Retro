const FIREBASE_BASE =
  "https://sorteo-hof-default-rtdb.europe-west1.firebasedatabase.app";

// Si 5 minutos después de bloquear el sorteo sigue en "procesando",
// otra ejecución del cron lo retoma.
const MAX_PROCESANDO_MS = 300000;

// Cuenta atrás de los rodillos antes de mostrar al ganador de un sorteo programado.
const REVEAL_MS = 30000;

// Única web desde la que se puede usar el Worker.
const ORIGEN_WEB = "https://kb-retro.github.io";
const URL_WEB_SORTEO = "https://kb-retro.github.io/Sorteo-HoF-Patrulla-Retro/";

// Envía un mensaje de texto con el bot de Telegram. Si faltan el token o el
// chat, no hace nada. Un fallo de Telegram nunca interrumpe el sorteo.
async function enviarTelegram(env, chatId, texto) {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    const respuesta = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texto, disable_web_page_preview: true })
    });
    if (!respuesta.ok) {
      console.error("⚠️ Telegram rechazó el mensaje:", respuesta.status, await respuesta.text());
    }
  } catch (error) {
    console.error("⚠️ No se pudo enviar el mensaje de Telegram:", error);
  }
}

function textoResultadoTelegram(ganador, mesPremio, especial, premioEspecial) {
  const numero = String(ganador.ticket || "").match(/^(\d+)/);
  const lineas = [
    especial
      ? `🎁 ¡Ya tenemos ganador del Sorteo Especial de ${mesPremio}!`
      : `🏆 ¡Ya tenemos ganador del Sorteo HoF de ${mesPremio}!`,
    "",
    `👤 ${ganador.user}`,
    numero ? `🎟️ Boleto Nº ${numero[1]}` : `🎟️ ${ganador.ticket}`
  ];
  if (especial && premioEspecial) lineas.push(`🎁 Premio: ${premioEspecial}`);
  lineas.push("", `🌐 ${URL_WEB_SORTEO}`);
  return lineas.join("\n");
}

// URL REST de Firebase para una ruta. Si existe el secreto FIREBASE_SECRET
// en Cloudflare se usa para autenticarse; si no existe, funciona como antes.
function firebaseUrl(env, ruta) {
  const url = `${FIREBASE_BASE}/${ruta}.json`;
  return env.FIREBASE_SECRET
    ? `${url}?auth=${encodeURIComponent(env.FIREBASE_SECRET)}`
    : url;
}

// Comprueba que la petición viene de un administrador de la web.
// Mientras no exista el secreto ADMIN_UIDS en Cloudflare, se permite todo
// (como hasta ahora), para poder activarlo sin cortar el servicio.
async function esPeticionDeAdmin(request, env) {
  if (!env.ADMIN_UIDS) return true;

  const cabecera = request.headers.get("Authorization") || "";
  const idToken = cabecera.startsWith("Bearer ") ? cabecera.slice(7).trim() : "";
  if (!idToken || !env.FIREBASE_API_KEY) return false;

  // Firebase Auth valida el token y nos dice de qué cuenta es.
  const respuesta = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: idToken })
    }
  );
  if (!respuesta.ok) return false;

  const datos = await respuesta.json();
  const uid = datos.users && datos.users[0] && datos.users[0].localId;
  const permitidos = env.ADMIN_UIDS.split(",").map(u => u.trim()).filter(Boolean);
  return !!uid && permitidos.includes(uid);
}

export default {

  // =========================================================
  // CRON AUTOMÁTICO
  // =========================================================

  async scheduled(event, env, ctx) {

    try {

      console.log("======================================");
      console.log("CRON EJECUTADO:", new Date().toISOString());
      console.log("======================================");

      const sorteoUrl = firebaseUrl(env, "sorteo_actual");

      // -------------------------------------------------------
      // 1. LEER SORTEO ACTUAL + ETAG
      // -------------------------------------------------------

      const lectura = await fetch(sorteoUrl, {
        headers: {
          "X-Firebase-ETag": "true"
        }
      });

      if (!lectura.ok) {
        throw new Error(
          `Firebase respondió ${lectura.status} al leer sorteo_actual`
        );
      }

      const sorteo = await lectura.json();
      const etag = lectura.headers.get("ETag");

      console.log("DATOS DE FIREBASE:", JSON.stringify(sorteo));

      // -------------------------------------------------------
      // 2. COMPROBAR SI HAY SORTEO PROGRAMADO
      // -------------------------------------------------------

      if (!sorteo) {
        console.log("No hay datos de sorteo.");
        return;
      }

      if (sorteo.status !== "programado") {
        // Verificar si se quedó atascado en procesando por más de 5 minutos
        if (sorteo.status === "procesando" && sorteo.processingAt) {
            const tiempoProcesando = Date.now() - sorteo.processingAt;
            if (tiempoProcesando > MAX_PROCESANDO_MS) {
                console.log("⚠️ El sorteo anterior se quedó atascado en 'procesando'. Retomando...");
            } else {
                console.log("El sorteo se está procesando actualmente por otro proceso.");
                return;
            }
        } else {
            console.log("No hay ningún sorteo programado.");
            return;
        }
      }

      if (!sorteo.targetTime) {
        console.log("El sorteo está marcado como programado pero no tiene targetTime.");
        return;
      }

      const ahora = Date.now();

      console.log("Hora actual:", new Date(ahora).toISOString());
      console.log("Hora del sorteo:", new Date(sorteo.targetTime).toISOString());

      // -------------------------------------------------------
      // 3. TODAVÍA NO HA LLEGADO LA HORA
      // -------------------------------------------------------

      if (ahora < Number(sorteo.targetTime)) {
        console.log("Todavía no ha llegado la hora del sorteo.");
        return;
      }

      console.log("⚠️ HA LLEGADO LA HORA DEL SORTEO.");

      // La lista negra no es pública: la web la guarda en "sorteo_privado",
      // que solo leen los admins y el Worker, junto con el targetTime de su
      // sorteo. Los sorteos programados con la web antigua la llevan aún en
      // sorteo_actual.
      const privadoUrl = firebaseUrl(env, "sorteo_privado");
      const lecturaPrivado = await fetch(privadoUrl);
      if (!lecturaPrivado.ok) {
        throw new Error(`Firebase respondió ${lecturaPrivado.status} al leer sorteo_privado`);
      }
      const privado = (await lecturaPrivado.json()) || {};

      // El sorteo público, sin la lista negra (se elimina si venía de la web antigua).
      const { rawBlacklist: blacklistAntigua, ...sorteoPublico } = sorteo;

      let rawBlacklistStr = null;
      if (typeof blacklistAntigua === "string") {
        rawBlacklistStr = blacklistAntigua;
      } else if (Number(privado.targetTime) === Number(sorteo.targetTime)) {
        rawBlacklistStr = privado.rawBlacklist || "";
      }

      // -------------------------------------------------------
      // 4. ELEGIR GANADOR (O REUTILIZAR EL YA ELEGIDO)
      // -------------------------------------------------------

      // Si una ejecución anterior se quedó a medias, el ganador ya está
      // guardado en el bloqueo: se reutiliza para no sortear dos veces.
      let tirada = sorteo.status === "procesando" ? sorteo.tiradaPendiente : null;

      if (tirada && tirada.ganador) {
        console.log("♻️ Reutilizando el ganador ya elegido:", tirada.ganador.user);
      } else {
        // Si no se encuentra la lista negra de ESTE sorteo, no se sortea:
        // es más seguro avisar al admin que sortear sin ella.
        tirada = rawBlacklistStr === null
          ? { error: "No se encontró la Lista Negra de este sorteo. Vuelve a programarlo." }
          : realizarTirada(sorteo.rawLines || "", rawBlacklistStr);

        if (tirada.error) {
          console.error("❌ " + tirada.error);
          // Se marca como error para que el cron no lo reintente cada minuto
          // y el administrador vea el aviso en la web.
          const marcaError = await fetch(sorteoUrl, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "If-Match": etag || "*"
            },
            body: JSON.stringify({
              ...sorteoPublico,
              status: "error",
              error: tirada.error,
              errorAt: Date.now()
            })
          });
          // El aviso de error va solo al chat de los admins (si está configurado).
          if (marcaError.ok) {
            await enviarTelegram(env, env.TELEGRAM_ADMIN_CHAT_ID,
              `⚠️ El sorteo programado no se ha podido realizar.\n\nMotivo: ${tirada.error}\n\nRevisa el panel de admin: ${URL_WEB_SORTEO}`);
          }
          return;
        }

        tirada.timestamp = Date.now();
      }

      // -------------------------------------------------------
      // 5. BLOQUEO ATÓMICO (GUARDANDO EL GANADOR ELEGIDO)
      // -------------------------------------------------------

      // El registro de la tirada ("log") nombra a los descartados por la Lista
      // Negra, así que no va en el bloqueo público sino en sorteo_privado.
      const datosProcesando = {
        ...sorteoPublico,
        status: "procesando",
        processingAt: Date.now(),
        tiradaPendiente: {
          ganador: tirada.ganador,
          arcadeGroup: tirada.arcadeGroup,
          timestamp: tirada.timestamp
        }
      };

      const bloqueo = await fetch(sorteoUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": etag || "*"
        },
        body: JSON.stringify(datosProcesando)
      });

      if (!bloqueo.ok) {
        const textoBloqueo = await bloqueo.text();
        console.log("🔒 OTRO PROCESO YA HA TOMADO EL SORTEO.", textoBloqueo);
        return;
      }

      console.log("🔒 SORTEO BLOQUEADO CORRECTAMENTE.");

      if (tirada.log) {
        const privadoResponse = await fetch(privadoUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rawBlacklist: rawBlacklistStr || "",
            targetTime: sorteo.targetTime,
            log: tirada.log
          })
        });
        if (!privadoResponse.ok) {
          console.error("⚠️ No se pudo guardar el registro privado del sorteo:", privadoResponse.status);
        }
      }

      const ganadorEncontrado = tirada.ganador;
      const timestamp = tirada.timestamp;

      console.log("🏆 GANADOR:", ganadorEncontrado.user);

      // -------------------------------------------------------
      // 6. FECHA DEL SORTEO
      // -------------------------------------------------------

      const ahoraFecha = new Date();
      const nombresMeses = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
      ];
      const fechaFormateada = `${nombresMeses[ahoraFecha.getUTCMonth()]} ${ahoraFecha.getUTCFullYear()}`;
      const mesPremio = sorteo.mesPremio || fechaFormateada;

      // -------------------------------------------------------
      // 7. GUARDAR GANADOR EN HISTORIAL
      // -------------------------------------------------------

      // Clave fija para este sorteo: si se retoma tras un fallo, se vuelve a
      // escribir la misma entrada en lugar de añadir un segundo ganador.
      const claveHistorial = `sorteo_${sorteo.targetTime}_${timestamp}`;
      const historialUrl = firebaseUrl(env, `historial_ganadores/${claveHistorial}`);
      const historialResponse = await fetch(historialUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user: ganadorEncontrado.user,
            ticket: ganadorEncontrado.ticket,
            fecha: mesPremio,
            mesPremio: mesPremio,
            timestamp: timestamp,
            especial: !!sorteo.sorteoEspecial,
            premioEspecial: sorteo.sorteoEspecial ? String(sorteo.premioEspecial || '').trim() : ''
          })
      });

      if (!historialResponse.ok) {
        throw new Error(`No se pudo guardar el historial. Firebase: ${historialResponse.status}`);
      }

      // -------------------------------------------------------
      // 8. CREAR RESULTADO FINAL
      // -------------------------------------------------------

      const resultadoFinal = {
        ganador: ganadorEncontrado,
        arcadeGroup: tirada.arcadeGroup,
        timestamp: timestamp,
        // La web muestra los rodillos con el número premiado y una cuenta
        // atrás hasta esta hora antes de enseñar al ganador.
        revealAt: Date.now() + REVEAL_MS,
        mesPremio: mesPremio,
        especial: !!sorteo.sorteoEspecial,
        premioEspecial: sorteo.sorteoEspecial ? String(sorteo.premioEspecial || '').trim() : '',
        rawLines: sorteo.rawLines || ""         // <- SE AÑADE LA LISTA ORIGINAL
      };

      // -------------------------------------------------------
      // 9. GUARDAR RESULTADO EN sorteo_actual
      // -------------------------------------------------------

      const resultadoResponse = await fetch(sorteoUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(resultadoFinal)
      });

      if (!resultadoResponse.ok) {
        throw new Error(`No se pudo guardar el resultado. Firebase: ${resultadoResponse.status}`);
      }

      console.log("✅ RESULTADO GUARDADO EN FIREBASE.");

      // -------------------------------------------------------
      // 10. HACER BACKUP AUTOMÁTICO
      // -------------------------------------------------------

      console.log("💾 Creando backup automático...");
      try {
        await crearBackupAutomatico(env, "Backup automático después del sorteo");
      } catch (backupError) {
        console.error("⚠️ Fallo en el backup automático, pero el sorteo terminó con éxito:", backupError);
      }

      // -------------------------------------------------------
      // 11. ANUNCIAR EL GANADOR EN TELEGRAM
      // -------------------------------------------------------

      // Se espera a que termine la cuenta atrás de la web para no
      // destripar el resultado antes de tiempo.
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const espera = resultadoFinal.revealAt - Date.now();
        if (espera > 0) await new Promise(resolve => setTimeout(resolve, espera));
        await enviarTelegram(env, env.TELEGRAM_CHAT_ID,
          textoResultadoTelegram(ganadorEncontrado, mesPremio, resultadoFinal.especial, resultadoFinal.premioEspecial));
      }

      console.log("======================================");
      console.log("🎉 SORTEO COMPLETADO CORRECTAMENTE");
      console.log("Ganador:", ganadorEncontrado.user);
      console.log("======================================");

    } catch (error) {
      console.error("❌ ERROR EJECUTANDO EL CRON:", error);
    }
  },


  // =========================================================
  // PETICIONES NORMALES DE LA WEB
  // =========================================================

  async fetch(request, env) {
    const urlObj = new URL(request.url);

    // =========================================================
    // CORS
    // =========================================================
    const corsHeaders = {
      "Access-Control-Allow-Origin": ORIGEN_WEB,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // =========================================================
    // 1. ENDPOINT PARA GUARDAR BACKUPS EN GITHUB
    // =========================================================

    if (urlObj.pathname === "/backup") {
      if (request.method !== "POST") {
        return new Response("Método no permitido", { status: 405, headers: corsHeaders });
      }
      try {
        if (!(await esPeticionDeAdmin(request, env))) {
          return new Response(
            JSON.stringify({ ok: false, error: "No autorizado. Inicia sesión como administrador." }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Los datos NO se toman de la petición: el Worker los lee él mismo
        // de Firebase, así nadie puede subir un backup con datos inventados.
        const resultado = await crearBackupAutomatico(env, "Backup manual desde la web");
        return new Response(
          JSON.stringify(resultado),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

      } catch (error) {
        console.error("Error creando backup:", error);
        // Siempre con cabeceras CORS: así la web muestra el motivo en lugar de "Failed to fetch".
        return new Response(
          JSON.stringify({ ok: false, error: "Error interno creando backup: " + (error && error.message ? error.message : "desconocido") }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // =========================================================
    // 2. PROXY DE TELEGRAM
    // =========================================================

    // Solo responde a peticiones hechas desde la web del sorteo, para que
    // nadie más gaste las peticiones gratuitas del Worker.
    const origen = request.headers.get("Origin") || "";
    const referer = request.headers.get("Referer") || "";
    if (origen !== ORIGEN_WEB && !referer.startsWith(ORIGEN_WEB + "/")) {
      return new Response("Acceso no permitido", { status: 403 });
    }

    const timestamp = Date.now();
    const telegramUrl = `https://t.me/s/retrojuegodelmes?before=${timestamp}`;
    const response = await fetch(telegramUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await response.text();

    return new Response(html, {
      headers: {
        "Access-Control-Allow-Origin": ORIGEN_WEB,
        "Vary": "Origin",
        "Content-Type": "text/html; charset=utf-8"
      }
    });
  }
};


// =========================================================
// TIRADA: ELEGIR GANADOR Y GRUPO ARCADE
// =========================================================

// Devuelve { ganador, arcadeGroup, log } o { error } si no hay ganador posible.
function realizarTirada(rawLinesStr, rawBlacklistStr) {

  // -------------------------------------------------------
  // CREAR LISTA DE PARTICIPANTES
  // -------------------------------------------------------

  let participantesValidos = [];

  rawLinesStr.split("\n").forEach(function(line) {
    let lineaLimpia = line.trim();
    if (!lineaLimpia) return;

    // Solo caracteres válidos en usuarios de Telegram (igual que en la web)
    const matchUser = lineaLimpia.match(/@\w+/);

    if (matchUser) {
      let boletoLimpio =
        lineaLimpia
          .replace(/PUNTO\s+EXTRA\s*/gi, "")
          .trim();

      participantesValidos.push({
        ticket: boletoLimpio,
        user: matchUser[0]
      });
    }
  });

  const total = participantesValidos.length;

  console.log("Participantes encontrados:", total);

  if (total === 0) {
    return { error: "No se encontraron participantes válidos en la lista." };
  }

  // -------------------------------------------------------
  // LISTA NEGRA
  // -------------------------------------------------------

  const blacklist = rawBlacklistStr.split("\n")
      .map(function(u) { return u.trim().toLowerCase(); })
      .filter(function(u) { return u.length > 0; });

  // -------------------------------------------------------
  // ELECCIÓN ALEATORIA CRIPTOGRÁFICAMENTE SEGURA
  // -------------------------------------------------------

  function obtenerIndiceCriptografico(max) {
    if (max <= 0) return 0;
    const maxUint32 = 0x100000000;
    const limiteEquitativo = maxUint32 - (maxUint32 % max);
    const array = new Uint32Array(1);
    let valor;
    do {
      crypto.getRandomValues(array);
      valor = array[0];
    } while (valor >= limiteEquitativo);
    return valor % max;
  }

  // -------------------------------------------------------
  // BUSCAR GANADOR
  // -------------------------------------------------------

  let log = [];
  let ganadorEncontrado = null;
  let indexGanador = -1;
  let listaCopia = participantesValidos.slice();

  while (listaCopia.length > 0) {
    const indexAleatorio = obtenerIndiceCriptografico(listaCopia.length);
    const entrada = listaCopia[indexAleatorio];
    const usuarioMinusculas = entrada.user.toLowerCase();

    if (blacklist.indexOf(usuarioMinusculas) !== -1) {
      log.push("❌ Descartado: " + entrada.ticket + " (" + entrada.user + " está en la Lista Negra)");
      listaCopia.splice(indexAleatorio, 1);
    } else {
      ganadorEncontrado = entrada;
      indexGanador = participantesValidos.findIndex(function(p) {
          return (p.ticket === entrada.ticket);
      });
      log.push("✅ ¡TIRADA GANADORA!: " + entrada.ticket);
      break;
    }
  }

  if (!ganadorEncontrado) {
    return { error: "Todos los participantes están en la Lista Negra." };
  }

  // -------------------------------------------------------
  // BUSCAR 2 ANTERIORES + GANADOR + 2 POSTERIORES
  // -------------------------------------------------------

  let anteriores = [];
  let posteriores = [];
  let usuariosUsados = {};

  usuariosUsados[ganadorEncontrado.user.toLowerCase()] = true;

  // ANTERIORES
  let curr = indexGanador - 1;
  let cntAnt = 0;
  while (anteriores.length < 2 && cntAnt < total) {
    if (curr < 0) { curr = total - 1; }
    const cand = participantesValidos[curr];
    if (!usuariosUsados[cand.user.toLowerCase()]) {
      anteriores.unshift(cand);
      usuariosUsados[cand.user.toLowerCase()] = true;
    }
    curr--;
    cntAnt++;
  }

  // POSTERIORES
  curr = indexGanador + 1;
  let cntPost = 0;
  while (posteriores.length < 2 && cntPost < total) {
    if (curr >= total) { curr = 0; }
    const cand = participantesValidos[curr];
    if (!usuariosUsados[cand.user.toLowerCase()]) {
      posteriores.push(cand);
      usuariosUsados[cand.user.toLowerCase()] = true;
    }
    curr++;
    cntPost++;
  }

  return {
    ganador: ganadorEncontrado,
    arcadeGroup: anteriores.concat([ganadorEncontrado], posteriores),
    log: log
  };
}


// =========================================================
// FUNCIÓN PARA CREAR BACKUP (LEE LOS DATOS DE FIREBASE)
// =========================================================

async function crearBackupAutomatico(env, tipoBackup) {
  const resultados = await Promise.all([
      fetch(firebaseUrl(env, "historial_ganadores")),
      fetch(firebaseUrl(env, "sorteo_actual")),
      fetch(firebaseUrl(env, "mes_sorteo")),
      fetch(firebaseUrl(env, "regalos")),
      fetch(firebaseUrl(env, "hall_of_fame_juegos"))
  ]);

  const fallida = resultados.find(response => !response.ok);
  if (fallida) {
    // 401 casi siempre significa que el secreto FIREBASE_SECRET está mal copiado.
    throw new Error(`Firebase respondió ${fallida.status} al leer los datos` +
      (fallida.status === 401 ? " (revisa el secreto FIREBASE_SECRET)." : "."));
  }

  const historial = await resultados[0].json();
  const sorteoActual = await resultados[1].json();
  const mesSorteo = await resultados[2].json();
  const regalos = await resultados[3].json();
  const hallOfFameJuegos = await resultados[4].json();

  const backupData = {
    historial_ganadores: historial || null,
    sorteo_actual: sorteoActual || null,
    mes_sorteo: mesSorteo || null,
    regalos: regalos || null,
    hall_of_fame_juegos: hallOfFameJuegos || null,
    tipoBackup: tipoBackup
  };

  const resultado = await subirBackupGitHub(backupData, env);

  if (!resultado.ok) {
    throw new Error("GitHub rechazó el backup (revisa el secreto GITHUB_TOKEN).");
  }

  console.log("💾 BACKUP GUARDADO:", resultado.archivo);
  return resultado;
}


// =========================================================
// FUNCIÓN PARA SUBIR BACKUP A GITHUB
// =========================================================

async function subirBackupGitHub(backupData, env) {
  const ahora = new Date();
  const año = ahora.getUTCFullYear();
  const mes = String(ahora.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getUTCDate()).padStart(2, "0");
  const hora = String(ahora.getUTCHours()).padStart(2, "0");
  const minuto = String(ahora.getUTCMinutes()).padStart(2, "0");
  const segundo = String(ahora.getUTCSeconds()).padStart(2, "0");

  const nombreArchivo = `backup_${año}-${mes}-${dia}_${hora}-${minuto}-${segundo}.json`;
  const rutaGithub = `backups/${año}/${mes}/${nombreArchivo}`;

  const contenido = JSON.stringify({ fechaBackup: ahora.toISOString(), ...backupData }, null, 2);

  const contenidoBase64 = btoa(unescape(encodeURIComponent(contenido)));
  const githubUrl = `https://api.github.com/repos/KB-retro/Backups-Sorteo-HoF/contents/${rutaGithub}`;

  const githubResponse = await fetch(githubUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "Sorteo-HoF-Patrulla-Retro"
      },
      body: JSON.stringify({
        message: `Backup automático ${año}-${mes}-${dia} ${hora}:${minuto}:${segundo}`,
        content: contenidoBase64
      })
  });

  const githubResult = await githubResponse.text();

  if (!githubResponse.ok) {
    console.error("Error GitHub:", githubResult);
    return { ok: false, error: "GitHub rechazó el backup" };
  }

  return { ok: true, archivo: rutaGithub };
}
