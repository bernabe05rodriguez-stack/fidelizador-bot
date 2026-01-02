const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// IMPORTANTE: Easypanel nos dará un puerto, si no, usa el 3000
const port = process.env.PORT || 3000;

// Servir el panel de control
app.use(express.static(path.join(__dirname, 'public')));

// --- ⚡ CONFIGURACIÓN DE VELOCIDAD ⚡ ---
const TIEMPO_MIN = 15000;  // 15 segundos
const TIEMPO_MAX = 25000;  // 25 segundos

const FRASES_INICIO = ["Hola, estás?", "Consulta rápida.", "Buenas.", "Che, te puedo llamar?", "Hola, agendame.", "Disculpa la hora.", "Estás operativo?", "Buen día."];
const FRASES_RESPUESTA = ["Sí, dime.", "Ahora no puedo.", "Dale, te aviso.", "Sisi, todo bien.", "Estoy manejando.", "Hablamos luego.", "Ok.", "Dale genial."];

let salas = {}; 
let respuestasPendientes = {}; 
const loopsActivos = {};

function logDashboard(msg) {
    console.log(msg);
    io.emit('log_servidor', msg);
}

function actualizarDashboard() {
    io.emit('actualizar_panel', salas);
}

io.on("connection", (socket) => {
    socket.on("unirse", (data) => {
        const salaID = data.sala.toUpperCase();
        socket.join(salaID);
        
        if (!salas[salaID]) salas[salaID] = [];
        
        const existe = salas[salaID].find(u => u.numero === data.miNumero);
        if (!existe) salas[salaID].push({ id: socket.id, numero: data.miNumero });
        else existe.id = socket.id;

        logDashboard(`[+] Conectado: ${data.miNumero} en sala ${salaID}`);
        actualizarDashboard();
        
        iniciarBucleAleatorio(salaID);
    });

    socket.on("disconnect", () => {
        for (const salaID in salas) {
            const antes = salas[salaID].length;
            salas[salaID] = salas[salaID].filter(u => u.id !== socket.id);
            if(salas[salaID].length < antes) {
                logDashboard(`[-] Desconectado un usuario de ${salaID}`);
                actualizarDashboard();
            }
        }
    });
});

function iniciarBucleAleatorio(salaID) {
    if (loopsActivos[salaID]) return;
    loopsActivos[salaID] = true;
    logDashboard(`>>> 🚀 MOTOR INICIADO PARA SALA: ${salaID}`);

    const ejecutarCiclo = () => {
        const usuarios = salas[salaID];
        if (!usuarios || usuarios.length < 2) {
            setTimeout(ejecutarCiclo, 5000); 
            return;
        }

        const deudores = usuarios.filter(u => respuestasPendientes[u.numero]);

        if (deudores.length > 0) {
            // RESPONDER
            const emisor = deudores[Math.floor(Math.random() * deudores.length)];
            const destino = respuestasPendientes[emisor.numero];
            const receptor = usuarios.find(u => u.numero === destino);

            if (receptor) {
                const texto = FRASES_RESPUESTA[Math.floor(Math.random() * FRASES_RESPUESTA.length)];
                logDashboard(`↺ RESPUESTA: ${emisor.numero} -> ${destino}`);
                io.to(emisor.id).emit("orden_servidor", { accion: "escribir", destino: receptor.numero, mensaje: texto });
            }
            delete respuestasPendientes[emisor.numero];
        } else {
            // INICIAR
            const emisor = usuarios[Math.floor(Math.random() * usuarios.length)];
            let receptor = usuarios[Math.floor(Math.random() * usuarios.length)];
            while (receptor.id === emisor.id) receptor = usuarios[Math.floor(Math.random() * usuarios.length)];

            const texto = FRASES_INICIO[Math.floor(Math.random() * FRASES_INICIO.length)];
            logDashboard(`➤ INICIO: ${emisor.numero} -> ${receptor.numero}`);
            io.to(emisor.id).emit("orden_servidor", { accion: "escribir", destino: receptor.numero, mensaje: texto });
            respuestasPendientes[receptor.numero] = emisor.numero;
        }

        const delay = Math.floor(Math.random() * (TIEMPO_MAX - TIEMPO_MIN + 1) + TIEMPO_MIN);
        logDashboard(`[Reloj] Sala ${salaID}: Próximo mensaje en ${Math.round(delay/1000)}s`);
        setTimeout(ejecutarCiclo, delay);
    };
    setTimeout(ejecutarCiclo, 3000);
}

server.listen(port, () => {
    console.log(`>>> SERVIDOR NUBE ACTIVO EN PUERTO ${port}`);
});