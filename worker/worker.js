export default {

  // =========================================================
  // CRON AUTOMÁTICO
  // =========================================================

  async scheduled(event, env, ctx) {

    try {

      console.log("======================================");
      console.log("CRON EJECUTADO:", new Date().toISOString());
      console.log("======================================");

      const firebaseBase =
        "https://sorteo-hof-default-rtdb.europe-west1.firebasedatabase.app";

      const sorteoUrl =
        `${firebaseBase}/sorteo_actual.json`;

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
        // Verificar si se quedó atascado en procesando por más de 5 minutos (300000 ms)
        if (sorteo.status === "procesando" && sorteo.processingAt) {
            const tiempoProcesando = Date.now() - sorteo.processingAt;
            if (tiempoProcesando > 300000) {
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

      // -------------------------------------------------------
      // 4. BLOQUEO ATÓMICO
      // -------------------------------------------------------

      const datosProcesando = {
        ...sorteo,
        status: "procesando",
        processingAt: Date.now()
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

      // -------------------------------------------------------
      // 5. EJECUTAR SORTEO
      // -------------------------------------------------------

      const rawLinesStr = sorteo.rawLines || "";
      const rawBlacklistStr = sorteo.rawBlacklist || "";

      const rawLines = rawLinesStr.split("\n");
      const rawBlacklist = rawBlacklistStr.split("\n");

      // -------------------------------------------------------
      // 6. CREAR LISTA DE PARTICIPANTES
      // -------------------------------------------------------

      let participantesValidos = [];

      rawLines.forEach(function(line) {
        let lineaLimpia = line.trim();
        if (!lineaLimpia) return;

        // Corrección de expresión regular
        const matchUser = lineaLimpia.match(/@[\w_.-]+/i);

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
        console.error("❌ No se encontraron participantes válidos.");
        // Devolver el estado a programado para que no quede bloqueado
        await fetch(sorteoUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sorteo)
        });
        return;
      }

      // -------------------------------------------------------
      // 7. LISTA NEGRA
      // -------------------------------------------------------

      const blacklist = rawBlacklist
          .map(function(u) { return u.trim().toLowerCase(); })
          .filter(function(u) { return u.length > 0; });

      // -------------------------------------------------------
      // 8. ELECCIÓN ALEATORIA CRIPTOGRÁFICAMENTE SEGURA
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
      // 9. BUSCAR GANADOR
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

      // -------------------------------------------------------
      // 10. COMPROBAR QUE HAY GANADOR
      // -------------------------------------------------------

      if (!ganadorEncontrado) {
        console.error("❌ No se pudo encontrar un ganador.");
        await fetch(sorteoUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sorteo)
        });
        return;
      }

      console.log("🏆 GANADOR:", ganadorEncontrado.user);

      // -------------------------------------------------------
      // 11. BUSCAR 2 ANTERIORES + GANADOR + 2 POSTERIORES
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

      const arcadeGroup = anteriores.concat([ganadorEncontrado], posteriores);

      // -------------------------------------------------------
      // 12. FECHA DEL SORTEO
      // -------------------------------------------------------

      const ahoraFecha = new Date();
      const nombresMeses = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
      ];
      const fechaFormateada = `${nombresMeses[ahoraFecha.getUTCMonth()]} ${ahoraFecha.getUTCFullYear()}`;
      const mesPremio = sorteo.mesPremio || fechaFormateada;
      const timestamp = Date.now();

      // -------------------------------------------------------
      // 13. GUARDAR GANADOR EN HISTORIAL
      // -------------------------------------------------------

      const historialUrl = `${firebaseBase}/historial_ganadores.json`;
      const historialResponse = await fetch(historialUrl, {
          method: "POST",
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
      // 14. CREAR RESULTADO FINAL
      // -------------------------------------------------------

      const resultadoFinal = {
        ganador: ganadorEncontrado,
        arcadeGroup: arcadeGroup,
        log: log,
        timestamp: timestamp,
        mesPremio: mesPremio,
        especial: !!sorteo.sorteoEspecial,
        premioEspecial: sorteo.sorteoEspecial ? String(sorteo.premioEspecial || '').trim() : '',
        rawLines: rawLinesStr,        // <- SE AÑADE LA LISTA ORIGINAL
        rawBlacklist: rawBlacklistStr // <- SE AÑADE LA LISTA NEGRA ORIGINAL
      };

      // -------------------------------------------------------
      // 15. GUARDAR RESULTADO EN sorteo_actual
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
      // 16. HACER BACKUP AUTOMÁTICO
      // -------------------------------------------------------

      console.log("💾 Creando backup automático...");
      try {
        await crearBackupAutomatico(firebaseBase, env);
      } catch (backupError) {
        console.error("⚠️ Fallo en el backup automático, pero el sorteo terminó con éxito:", backupError);
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
      "Access-Control-Allow-Origin": "https://kb-retro.github.io",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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
        const backupData = await request.json();
        if (!backupData || typeof backupData !== "object") {
          return new Response(
            JSON.stringify({ ok: false, error: "Datos de backup inválidos" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const resultado = await subirBackupGitHub(backupData, env);
        return new Response(
          JSON.stringify(resultado),
          { status: resultado.ok ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

      } catch (error) {
        console.error("Error creando backup:", error);
        return new Response(
          JSON.stringify({ ok: false, error: "Error interno creando backup" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // =========================================================
    // 2. PROXY DE TELEGRAM
    // =========================================================

    const timestamp = Date.now();
    const telegramUrl = `https://t.me/s/retrojuegodelmes?before=${timestamp}`;
    const response = await fetch(telegramUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await response.text();

    return new Response(html, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/html; charset=utf-8"
      }
    });
  }
};


// =========================================================
// FUNCIÓN PARA CREAR BACKUP AUTOMÁTICO
// =========================================================

async function crearBackupAutomatico(firebaseBase, env) {
  const resultados = await Promise.all([
      fetch(`${firebaseBase}/historial_ganadores.json`),
      fetch(`${firebaseBase}/sorteo_actual.json`),
      fetch(`${firebaseBase}/mes_sorteo.json`),
      fetch(`${firebaseBase}/regalos.json`),
      fetch(`${firebaseBase}/hall_of_fame_juegos.json`)
  ]);

  if (resultados.some(response => !response.ok)) {
    throw new Error("No se pudieron leer todos los datos para crear el backup.");
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
    tipoBackup: "Backup automático después del sorteo"
  };

  const resultado = await subirBackupGitHub(backupData, env);

  if (!resultado.ok) {
    throw new Error("El sorteo se realizó, pero el backup en GitHub falló.");
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
