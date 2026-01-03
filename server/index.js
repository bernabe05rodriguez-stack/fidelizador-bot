/**
 * index.js (EasyPanel friendly - FORZADO A PUERTO 80)
 * - Express + Socket.IO
 * - Health endpoint (/health)
 * - Sirve /public
 * - Solo server.listen (NO app.listen)
 * - Puerto 80 para que EasyPanel lo publique como web (tu panel no rutea 3000)
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// ✅ FORZAMOS 80 (tu EasyPanel no está publicando 3000)
const PORT = 80;

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

// Si no existe public/index.html, al menos responde algo en /
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
  "Buen día."
];

const FRASES_RESPUESTA = [
  "Sí, dime.",
  "Ahora no puedo.",
  "Dale, te aviso.",
  "Sisi, todo bien.",
  "Estoy manejando.",
  "Hablamos luego.",
  "Ok.",
  "Dale genial."
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

io.on("connection", (socket) => {
  logDashboard(`🟢 Socket conectado: ${socket.id}`);

  socket.on("unirse", (data = {}) => {
    try {
      const salaID = String(data.sala || "").toUpperCase().trim();
      const miNumero = String(data.miNumero || "").trim();

      if (!salaID || !miNumero) {
        logDashboard("⚠️ unirse(): falta sala o miNumero");
        return;
      }

      socket.join(salaID);

      if (!salas[salaID]) salas[salaID] = [];

      const existe = salas[salaID].find((u) => u.numero === miNumero);
      if (!existe) salas[salaID].push({ id: socket.id, numero: miNumero });
      else existe.id = socket.id;

      logDashboard(`[+] Conectado: ${miNumero} en sala ${
