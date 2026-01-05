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
const TIEMPO_MIN = 10000; // 10 segundos
const TIEMPO_MAX = 20000; // 20 segundos

const FRASES_INICIO = [
  "Hola, estás?",
  "Consulta rápida.",
  "Buenas.",
  "Che, te puedo llamar?",
  "Hola, agendame.",
  "Disculpa la hora.",
  "Estás operativo?",
  "Buen día.",
];

const FRASES_RESPUESTA = [
  "Sí, dime.",
  "Ahora no puedo.",
  "Dale, te aviso.",
  "Sisi, todo bien.",
  "Estoy manejando.",
  "Hablamos luego.",
  "Ok.",
  "Dale genial.",
];

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
      allowedRooms = allowedRooms.filter(r => r !== name);
      saveRooms();
      logDashboard(`🗑 Sala eliminada por Admin: ${name}`);
      // Opcional: Desconectar usuarios de esa sala?
      // Por ahora no, solo se impide que entren nuevos.
    }
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

      if (!salas[salaID]) salas[salaID] = [];

      const existe = salas[salaID].find((u) => u.numero === miNumero);
      if (!existe) salas[salaID].push({ id: socket.id, numero: miNumero, paused: false });
      else {
        existe.id = socket.id;
        existe.paused = false; // Resetear pausa al reconectar
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

function iniciarBucleAleatorio(salaID) {
  if (loopsActivos[salaID]) return;

  loopsActivos[salaID] = true;
  logDashboard(`>>> 🚀 MOTOR INICIADO PARA SALA: ${salaID}`);

  const ejecutarCiclo = () => {
    try {
      const todosUsuarios = salas[salaID];

      // Filtrar usuarios activos (no pausados)
      const activos = (todosUsuarios || []).filter(u => !u.paused);

      if (activos.length < 2) {
        // Esperamos un poco y reintentamos
        setTimeout(ejecutarCiclo, 5000);
        return;
      }

      // ELEGIR PAREJA ALEATORIA (SIMULTÁNEO)
      const emisor = activos[Math.floor(Math.random() * activos.length)];
      let receptor = activos[Math.floor(Math.random() * activos.length)];

      // Asegurar que no sea el mismo número
      // (Usamos while con limite para evitar loops infinitos si solo hay 1 válido repetido por error)
      let intentos = 0;
      while (receptor.numero === emisor.numero && intentos < 10) {
        receptor = activos[Math.floor(Math.random() * activos.length)];
        intentos++;
      }

      if (receptor.numero !== emisor.numero) {
        // 1. Emisor le habla a Receptor
        const texto1 = FRASES_INICIO[Math.floor(Math.random() * FRASES_INICIO.length)];
        io.to(emisor.id).emit("orden_servidor", {
            accion: "escribir",
            destino: receptor.numero,
            mensaje: texto1,
        });

        // 2. Receptor le habla a Emisor (simultaneo, frase aleatoria)
        const texto2 = FRASES_RESPUESTA[Math.floor(Math.random() * FRASES_RESPUESTA.length)];
        // Nota: El usuario pidió simplificar, mensajes aleatorios. Usamos frases de respuesta o inicio indistintamente?
        // El usuario dijo "mensajes aleatorios". Usaremos un mix o lo que sea.
        // Vamos a usar FRASES_INICIO también para que parezca charla nueva, o una de RESPUESTA.
        // El código anterior usaba FRASES_RESPUESTA solo si era respuesta.
        // Usemos FRASES_INICIO para ambos para que sea charla proactiva mutua, o un random de ambas.

        io.to(receptor.id).emit("orden_servidor", {
            accion: "escribir",
            destino: emisor.numero,
            mensaje: texto2,
        });

        logDashboard(`➤ INTERACCIÓN DOBLE: ${emisor.numero} ↔ ${receptor.numero}`);
      }

      const delay = Math.floor(
        Math.random() * (TIEMPO_MAX - TIEMPO_MIN + 1) + TIEMPO_MIN
      );
      setTimeout(ejecutarCiclo, delay);
    } catch (e) {
      console.error("❌ Error en ejecutarCiclo:", e);
      setTimeout(ejecutarCiclo, 5000);
    }
  };

  setTimeout(ejecutarCiclo, 3000);
}

// keep-alive
setInterval(() => {
  console.log("🫀 keep-alive", new Date().toISOString());
}, 30000);

// ✅ SOLO ESTE LISTEN
server.listen(PORT, "0.0.0.0", () => {
  console.log(`>>> SERVIDOR ACTIVO EN PUERTO ${PORT}`);
  console.log(">>> Healthcheck: /health");
});
