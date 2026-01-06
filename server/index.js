/**
 * index.js (EasyPanel friendly - FORZADO A PUERTO 80)
 * - Express + Socket.IO
 * - Health endpoint (/health)
 * - Sirve /public
 * - Solo server.listen (NO app.listen)
 * - Puerto 80 para que EasyPanel lo publique como web
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

// ✅ FORZAMOS 80 (porque tu EasyPanel no está ruteando 3000)
const PORT = 80;

// --- PERSISTENCIA DE SALAS ---
const ROOMS_FILE = path.join(__dirname, "rooms.json");
let allowedRooms = [];

// Cargar salas al inicio
try {
  if (fs.existsSync(ROOMS_FILE)) {
    const data = fs.readFileSync(ROOMS_FILE, "utf-8");
    allowedRooms = JSON.parse(data || "[]");
    console.log("📂 Salas cargadas:", allowedRooms);
  } else {
    fs.writeFileSync(ROOMS_FILE, "[]");
  }
} catch (e) {
  console.error("❌ Error cargando salas:", e);
  allowedRooms = [];
}

function saveRooms() {
  try {
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(allowedRooms, null, 2));
    io.emit("rooms_update", getRoomsWithCounts()); // Notificar cambios a todos
  } catch (e) {
    console.error("❌ Error guardando salas:", e);
  }
}

// --- LOGS + ERRORES ---
process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ unhandledRejection:", reason);
});

// --- HEALTHCHECK ---
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

// --- STATIC PANEL ---
app.use(express.static(path.join(__dirname, "public")));

// Si no existe public/index.html, igual responde algo en /
app.get("/", (req, res) => {
  res.status(200).send("Servidor activo. Panel en /public (si existe).");
});

// --- ⚡ CONFIGURACIÓN DE VELOCIDAD ⚡ ---
const TIEMPO_MIN = 15000; // 15 segundos siempre
const TIEMPO_MAX = 15000; // 15 segundos siempre

const { FRASES_INICIO, FRASES_RESPUESTA } = require("./messages");

// --- CONFIGURACIÓN REMOTA DEL CLIENTE ---
// Esto permite actualizar selectores y tiempos sin tocar la extensión
const CLIENT_CONFIG = {
  selectors: {
    // Selectores combinados para mayor robustez
    chatBox: 'div[contenteditable="true"][data-tab], div[contenteditable="true"][role="textbox"], footer div[contenteditable="true"]',
    btnSend: 'span[data-icon="send"], button[aria-label="Send"], button[aria-label="Enviar"], div[role="button"] > span[data-icon="send"]',
    btnSendAlt: 'span[data-icon="send"]', // Fallback conservador
    sidePane: '#pane-side, #side, div[aria-label="Chat list"], div[aria-label="Lista de chats"]',
    sidePaneAlt: 'div[role="grid"]',
    logoutCanvas: 'canvas'
  },
  timeouts: {
    navWait: 1500,    // Espera un poco mas tras click
    chatLoad: 120000, // Timeout extendido a 2 min
    prePaste: 2000,   // Espera antes de pegar
    preSend: 2000,    // Espera antes de enviar
    postSend: 2000    // Espera antes de confirmar
  }
};

let salas = {};
const loopsActivos = {};

function logDashboard(msg) {
  console.log(msg);
  io.emit("log_servidor", msg);
}

function actualizarDashboard() {
  io.emit("actualizar_panel", salas);
}

function getRoomsWithCounts() {
  return allowedRooms.map(roomName => {
    const count = salas[roomName] ? salas[roomName].length : 0;
    return { name: roomName, count: count };
  });
}

io.on("connection", (socket) => {
  // logDashboard(`🟢 Socket conectado: ${socket.id}`); // Demasiado ruido si hay muchos

  // --- HEARTBEAT ---
  socket.on("heartbeat", () => {
    // Buscar al usuario en las salas y actualizar su timestamp
    for (const salaID in salas) {
      const u = salas[salaID].find(user => user.id === socket.id);
      if (u) {
        u.lastSeen = Date.now();
        // Si estaba marcado para borrar, lo salvamos (aunque el prune corre aparte)
      }
    }
  });

  // --- ADMIN ---
  socket.on("admin_login", (creds, callback) => {
    if (creds.user === "admin" && creds.pass === "Selena") {
      callback({ success: true });
    } else {
      callback({ success: false, msg: "Credenciales incorrectas" });
    }
  });

  socket.on("create_room", (roomName) => {
    const name = String(roomName || "").toUpperCase().trim();
    if (name && !allowedRooms.includes(name)) {
      allowedRooms.push(name);
      saveRooms();
      logDashboard(`🛠 Sala creada por Admin: ${name}`);
    }
  });

  socket.on("delete_room", (roomName) => {
    const name = String(roomName || "").toUpperCase().trim();
    if (name && allowedRooms.includes(name)) {
      // 1. Avisar a todos los usuarios de esa sala que se destruyó
      if (salas[name]) {
         salas[name].forEach(u => {
             io.to(u.id).emit("sala_eliminada");
         });
         delete salas[name]; // Eliminar de memoria
      }

      // 2. Eliminar de permitidas
      allowedRooms = allowedRooms.filter(r => r !== name);
      saveRooms();
      logDashboard(`🗑 Sala eliminada por Admin: ${name}`);

      actualizarDashboard();
      io.emit("rooms_update", getRoomsWithCounts());
    }
  });

  // NUEVO: Detalles para el admin
  socket.on("admin_room_details", (roomName, cb) => {
    const name = String(roomName || "").toUpperCase().trim();
    if (salas[name]) {
      // Devolvemos info extra
      cb(salas[name]);
    } else {
      cb([]);
    }
  });

  // NUEVO: Kick user
  socket.on("admin_kick_user", (socketId) => {
    io.to(socketId).emit("usuario_expulsado");
    // Forzamos desconexión del socket (el evento disconnect limpiará la sala)
    const s = io.sockets.sockets.get(socketId);
    if (s) s.disconnect(true);
    // Por si acaso, llamamos a eliminarUsuario directo si el disconnect falla
    eliminarUsuario(socketId);
    logDashboard(`🚫 Admin expulsó a: ${socketId}`);
  });

  // --- EXTENSION / PUBLIC ---
  socket.on("get_rooms", (cb) => {
    if (typeof cb === 'function') cb(getRoomsWithCounts());
    else socket.emit("rooms_list", getRoomsWithCounts());
  });

  socket.on("unirse", (data = {}) => {
    try {
      const salaID = String(data.sala || "").toUpperCase().trim();
      const miNumero = String(data.miNumero || "").trim();

      if (!salaID || !miNumero) {
        // logDashboard("⚠️ unirse(): falta sala o miNumero");
        return;
      }

      // 🔒 VERIFICACIÓN DE SALA PERMITIDA
      if (!allowedRooms.includes(salaID)) {
        console.log(`⛔ Intento de unirse a sala no permitida: ${salaID}`);
        socket.emit("error_sala", "La sala no existe o ha sido eliminada.");
        return;
      }

      socket.join(salaID);

      // Enviamos la configuración actualizada al cliente
      socket.emit("config_cliente", CLIENT_CONFIG);

      if (!salas[salaID]) salas[salaID] = [];

      const existe = salas[salaID].find((u) => u.numero === miNumero);
      if (!existe) {
          salas[salaID].push({
              id: socket.id,
              numero: miNumero,
              paused: false,
              joinedAt: Date.now(),
              lastSeen: Date.now() // Init
          });
      } else {
        existe.id = socket.id;
        existe.paused = false; // Resetear pausa al reconectar
        existe.joinedAt = Date.now(); // Reiniciar timer al reconectar
        existe.lastSeen = Date.now();
      }

      logDashboard(`[+] Conectado: ${miNumero} en sala ${salaID}`);
      actualizarDashboard();

      // Notificar a todos que cambiaron los contadores
      io.emit("rooms_update", getRoomsWithCounts());

      iniciarBucleAleatorio(salaID);
    } catch (e) {
      console.error("❌ Error en unirse:", e);
    }
  });

  socket.on("pausar", (estado) => {
    // Buscar usuario y marcarlo
    for (const salaID in salas) {
      const usuario = salas[salaID].find((u) => u.id === socket.id);
      if (usuario) {
        usuario.paused = estado;
        usuario.lastSeen = Date.now(); // Actividad
        logDashboard(`⏸ Usuario ${usuario.numero} pausa: ${estado}`);
      }
    }
  });

  socket.on("abandonar", () => {
    logDashboard(`👋 Usuario solicita abandonar: ${socket.id}`);
    eliminarUsuario(socket.id);
  });

  socket.on("disconnect", (reason) => {
    eliminarUsuario(socket.id);
  });
});

function eliminarUsuario(socketId) {
  let cambio = false;
  for (const salaID in salas) {
    const antes = salas[salaID].length;
    salas[salaID] = salas[salaID].filter((u) => u.id !== socketId);

    if (salas[salaID].length < antes) {
      logDashboard(`[-] Usuario fuera de sala ${salaID}`);
      cambio = true;
    }
  }
  if (cambio) {
    actualizarDashboard();
    io.emit("rooms_update", getRoomsWithCounts());
  }
}

// 🧟 LIMPIEZA DE ZOMBIES 🧟
// Eliminar usuarios que no envían heartbeat hace > 25 segundos
setInterval(() => {
    let cambio = false;
    const ahora = Date.now();
    for (const salaID in salas) {
        const antes = salas[salaID].length;
        // Filtramos solo los que han sido vistos hace menos de 25s
        salas[salaID] = salas[salaID].filter(u => (ahora - (u.lastSeen || 0)) < 25000);

        if (salas[salaID].length < antes) {
            logDashboard(`💀 ZOMBIE ELIMINADO en sala ${salaID}`);
            cambio = true;
        }
    }
    if (cambio) {
        actualizarDashboard();
        io.emit("rooms_update", getRoomsWithCounts());
    }
}, 10000); // Revisar cada 10s

function iniciarBucleAleatorio(salaID) {
  if (loopsActivos[salaID]) return;

  loopsActivos[salaID] = true;
  logDashboard(`>>> 🚀 MOTOR INICIADO PARA SALA: ${salaID}`);

  const ejecutarCiclo = () => {
    try {
      // Verificar si la sala aun existe
      if (!allowedRooms.includes(salaID)) {
          delete loopsActivos[salaID];
          return; // Stop loop
      }

      const todosUsuarios = salas[salaID];

      // Filtrar usuarios:
      // 1. No pausados
      // 2. Conectados hace > 5s (joinedAt)
      // 3. Vivos hace < 20s (lastSeen) -> SEGURIDAD EXTRA
      const ahora = Date.now();
      const activos = (todosUsuarios || []).filter(u =>
          !u.paused &&
          (ahora - (u.joinedAt || 0) > 5000) &&
          (ahora - (u.lastSeen || 0) < 20000)
      );

      if (activos.length < 2) {
        // Esperamos un poco y reintentamos
        setTimeout(ejecutarCiclo, 5000);
        return;
      }

      // ELEGIR PAREJA ALEATORIA (SIMULTÁNEO)
      const emisor = activos[Math.floor(Math.random() * activos.length)];
      let receptor = activos[Math.floor(Math.random() * activos.length)];

      // Asegurar que no sea el mismo número
      let intentos = 0;
      while (receptor.numero === emisor.numero && intentos < 10) {
        receptor = activos[Math.floor(Math.random() * activos.length)];
        intentos++;
      }

      if (receptor.numero !== emisor.numero) {
        // Verificar sockets conectados (doble check)
        const sEmisor = io.sockets.sockets.get(emisor.id);
        const sReceptor = io.sockets.sockets.get(receptor.id);

        if (sEmisor && sReceptor && sEmisor.connected && sReceptor.connected) {
             // 1. Emisor le habla a Receptor
            const texto1 = FRASES_INICIO[Math.floor(Math.random() * FRASES_INICIO.length)];
            io.to(emisor.id).emit("orden_servidor", {
                accion: "escribir",
                destino: receptor.numero,
                mensaje: texto1,
            });

            // 2. Receptor le habla a Emisor (simultaneo)
            const texto2 = FRASES_RESPUESTA[Math.floor(Math.random() * FRASES_RESPUESTA.length)];

            io.to(receptor.id).emit("orden_servidor", {
                accion: "escribir",
                destino: emisor.numero,
                mensaje: texto2,
            });

            logDashboard(`➤ INTERACCIÓN DOBLE: ${emisor.numero} ↔ ${receptor.numero}`);
        } else {
            // Si uno no tiene socket real, forzamos cleanup en proximo ciclo
            logDashboard("⚠️ Intento de par con socket desconectado.");
        }
      }

      // Espera 15s siempre
      setTimeout(ejecutarCiclo, 15000);
    } catch (e) {
      console.error("❌ Error en ejecutarCiclo:", e);
      setTimeout(ejecutarCiclo, 5000);
    }
  };

  setTimeout(ejecutarCiclo, 3000);
}

// keep-alive logs
setInterval(() => {
  console.log("🫀 Server alive", new Date().toISOString());
}, 60000);

// ✅ SOLO ESTE LISTEN
server.listen(PORT, "0.0.0.0", () => {
  console.log(`>>> SERVIDOR ACTIVO EN PUERTO ${PORT}`);
  console.log(">>> Healthcheck: /health");
});
