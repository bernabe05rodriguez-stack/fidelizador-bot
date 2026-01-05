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
const TIEMPO_MIN = 15000; // 15 segundos
const TIEMPO_MAX = 25000; // 25 segundos

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
let respuestasPendientes = {};
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
      if (!existe) salas[salaID].push({ id: socket.id, numero: miNumero });
      else existe.id = socket.id;

      logDashboard(`[+] Conectado: ${miNumero} en sala ${salaID}`);
      actualizarDashboard();

      // Notificar a todos que cambiaron los contadores
      io.emit("rooms_update", getRoomsWithCounts());

      iniciarBucleAleatorio(salaID);
    } catch (e) {
      console.error("❌ Error en unirse:", e);
    }
  });

  socket.on("disconnect", (reason) => {
    // logDashboard(`🔴 Socket desconectado: ${socket.id} (${reason})`);

    let cambio = false;
    for (const salaID in salas) {
      const antes = salas[salaID].length;
      salas[salaID] = salas[salaID].filter((u) => u.id !== socket.id);

      if (salas[salaID].length < antes) {
        logDashboard(`[-] Desconectado un usuario de ${salaID}`);
        cambio = true;
      }
    }
    if (cambio) {
      actualizarDashboard();
      io.emit("rooms_update", getRoomsWithCounts());
    }
  });
});

function iniciarBucleAleatorio(salaID) {
  if (loopsActivos[salaID]) return;

  loopsActivos[salaID] = true;
  logDashboard(`>>> 🚀 MOTOR INICIADO PARA SALA: ${salaID}`);

  const ejecutarCiclo = () => {
    try {
      // Verificar si la sala sigue existiendo en allowedRooms, si no, detener el loop?
      // Por ahora lo dejamos correr para los que están dentro.

      const usuarios = salas[salaID];

      if (!usuarios || usuarios.length < 2) {
        setTimeout(ejecutarCiclo, 5000);
        return;
      }

      const deudores = usuarios.filter((u) => respuestasPendientes[u.numero]);

      if (deudores.length > 0) {
        // RESPONDER
        const emisor = deudores[Math.floor(Math.random() * deudores.length)];
        const destino = respuestasPendientes[emisor.numero];
        const receptor = usuarios.find((u) => u.numero === destino);

        if (receptor) {
          const texto =
            FRASES_RESPUESTA[Math.floor(Math.random() * FRASES_RESPUESTA.length)];
          logDashboard(`↺ RESPUESTA: ${emisor.numero} -> ${destino}`);
          io.to(emisor.id).emit("orden_servidor", {
            accion: "escribir",
            destino: receptor.numero,
            mensaje: texto,
          });
        }

        delete respuestasPendientes[emisor.numero];
      } else {
        // INICIAR
        const emisor = usuarios[Math.floor(Math.random() * usuarios.length)];
        let receptor = usuarios[Math.floor(Math.random() * usuarios.length)];
        while (receptor.id === emisor.id) {
          receptor = usuarios[Math.floor(Math.random() * usuarios.length)];
        }

        const texto =
          FRASES_INICIO[Math.floor(Math.random() * FRASES_INICIO.length)];
        logDashboard(`➤ INICIO: ${emisor.numero} -> ${receptor.numero}`);
        io.to(emisor.id).emit("orden_servidor", {
          accion: "escribir",
          destino: receptor.numero,
          mensaje: texto,
        });

        respuestasPendientes[receptor.numero] = emisor.numero;
      }

      const delay = Math.floor(
        Math.random() * (TIEMPO_MAX - TIEMPO_MIN + 1) + TIEMPO_MIN
      );
      // logDashboard(`[Reloj] Sala ${salaID}: Próximo mensaje en ${Math.round(delay / 1000)}s`);
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
