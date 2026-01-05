// background.js - Service Worker
try {
  importScripts('socket.io.js');
} catch (e) {
  console.error("Error importando socket.io.js:", e);
}

const URL_SERVIDOR = "http://fidelizador.online";
let socket = null;
let currentSala = null;
let currentNumero = null;

// --- GESTIÓN DE CONEXIÓN SOCKET.IO ---
function conectarSocket(sala, numero) {
  if (socket && socket.connected) {
    // Si ya estamos conectados y son los mismos datos, no hacer nada
    if (currentSala === sala && currentNumero === numero) return;
    socket.disconnect();
  }

  currentSala = sala;
  currentNumero = numero;

  console.log(`[Background] Conectando a ${URL_SERVIDOR} como ${numero} en sala ${sala}`);

  // Configurar nueva conexión
  socket = io(URL_SERVIDOR, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5
  });

  socket.on('connect', () => {
    console.log("[Background] Socket conectado ID:", socket.id);
    // Unirse a la sala
    socket.emit('unirse', { sala: sala, miNumero: numero });
  });

  socket.on('orden_servidor', (msg) => {
    console.log("[Background] Orden recibida:", msg);
    // Reenviar a la pestaña activa de WhatsApp
    enviarAWhatsApp(msg);
  });

  socket.on('disconnect', (reason) => {
    console.log("[Background] Desconectado:", reason);
  });
}

function desconectarSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentSala = null;
  currentNumero = null;
}

// --- COMUNICACIÓN CON CONTENT SCRIPT ---
function enviarAWhatsApp(msg) {
  // Buscar pestañas de WhatsApp Web
  chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, (tabs) => {
    if (tabs && tabs.length > 0) {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'ORDEN', payload: msg })
          .catch(err => console.log("Error enviando a tab:", err)); // Ignorar si tab no listo
      });
    } else {
      console.log("⚠️ No hay pestañas de WhatsApp abiertas para ejecutar la orden.");
    }
  });
}

// --- MONITOR DE STORAGE ---
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    chrome.storage.local.get(['fid_sala', 'fid_num'], (data) => {
      if (data.fid_sala && data.fid_num) {
        conectarSocket(data.fid_sala, data.fid_num);
      } else {
        desconectarSocket();
      }
    });
  }
});

// Inicializar al arrancar
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['fid_sala', 'fid_num'], (data) => {
    if (data.fid_sala && data.fid_num) {
      conectarSocket(data.fid_sala, data.fid_num);
    }
  });
});

// También al instalar/recargar extensión
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['fid_sala', 'fid_num'], (data) => {
    if (data.fid_sala && data.fid_num) {
      conectarSocket(data.fid_sala, data.fid_num);
    }
  });
});

// --- KEEP ALIVE (Service Worker Hack) ---
// Mantener vivo el SW mientras haya una conexión entrante desde el content script
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keep-alive") {
    console.log("[Background] Keep-Alive conectado");
    port.onDisconnect.addListener(() => {
      console.log("[Background] Keep-Alive desconectado");
    });

    // Si conectamos desde content script, aseguramos que el socket esté activo
    chrome.storage.local.get(['fid_sala', 'fid_num'], (data) => {
        if (data.fid_sala && data.fid_num) {
          if (!socket || !socket.connected) {
             conectarSocket(data.fid_sala, data.fid_num);
          }
        }
    });
  }
});
