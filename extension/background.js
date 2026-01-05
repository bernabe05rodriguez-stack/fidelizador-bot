// background.js - Service Worker

// --- GLOBAL ERROR HANDLING ---
self.addEventListener('error', (event) => {
  console.error("[Background] Uncaught Error:", event.error || event.message);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error("[Background] Unhandled Rejection:", event.reason);
});

// --- IMPORT SOCKET.IO ---
try {
  importScripts('socket.io.js');
} catch (e) {
  console.error("[Background] CRITICAL: Failed to import socket.io.js", e);
}

const URL_SERVIDOR = "http://fidelizador.online";
let socket = null;
let currentSala = null;
let currentNumero = null;

// --- GESTIÓN DE CONEXIÓN SOCKET.IO ---
function conectarSocket(sala, numero) {
  if (typeof io === 'undefined') {
    console.error("[Background] CRITICAL: 'io' is not defined. Cannot connect.");
    return;
  }

  if (socket && socket.connected) {
    if (currentSala === sala && currentNumero === numero) return;
    socket.disconnect();
  }

  currentSala = sala;
  currentNumero = numero;

  console.log(`[Background] Conectando a ${URL_SERVIDOR} como ${numero} en sala ${sala}`);

  try {
    // Configurar nueva conexión FORZANDO WEBSOCKET
    socket = io(URL_SERVIDOR, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      transports: ['websocket'], // IMPORTANT: Force WebSocket to avoid XHR/Polling issues in SW
      forceNew: true
    });

    socket.on('connect', () => {
      console.log("[Background] Socket conectado ID:", socket.id);
      socket.emit('unirse', { sala: sala, miNumero: numero });
    });

    socket.on('connect_error', (err) => {
      console.error("[Background] Connection Error:", err.message);
    });

    socket.on('orden_servidor', (msg) => {
      console.log("[Background] Orden recibida:", msg);
      enviarAWhatsApp(msg);
    });

    socket.on('disconnect', (reason) => {
      console.log("[Background] Desconectado:", reason);
    });

  } catch (e) {
    console.error("[Background] Exception while creating socket:", e);
  }
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
  chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, (tabs) => {
    if (tabs && tabs.length > 0) {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'ORDEN', payload: msg })
          .catch(err => console.log("Error enviando a tab (tab cerrada?):", err));
      });
    } else {
      console.log("⚠️ No hay pestañas de WhatsApp abiertas.");
    }
  });
}

// --- MONITOR DE STORAGE ---
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {

    // 1. CAMBIO DE SALA/NUMERO (Conexión/Desconexión)
    if (changes.fid_sala || changes.fid_num) {
      chrome.storage.local.get(['fid_sala', 'fid_num'], (data) => {
        if (data.fid_sala && data.fid_num) {
          conectarSocket(data.fid_sala, data.fid_num);
        } else {
          // Si tenía socket y ahora no hay datos, es un logout explicito
          if (socket && socket.connected) {
             socket.emit('abandonar'); // Avisar al server antes de cortar
             setTimeout(desconectarSocket, 200);
          } else {
             desconectarSocket();
          }
        }
      });
    }

    // 2. CAMBIO DE PAUSA
    if (changes.fid_paused) {
      const nuevoEstado = changes.fid_paused.newValue;
      if (socket && socket.connected) {
        console.log(`[Background] Enviando pausa: ${nuevoEstado}`);
        socket.emit('pausar', nuevoEstado);
      }
    }
  }
});

// --- MENSAJES DESDE CONTENT SCRIPT (Logout detectado) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOGOUT_DETECTED') {
    console.log("[Background] LOGOUT DETECTED -> Limpiando sesión");

    // Avisar al server (si es posible)
    if (socket && socket.connected) socket.emit('abandonar');

    // Limpiar storage para evitar reconexión
    chrome.storage.local.remove(['fid_sala', 'fid_paused'], () => {
       desconectarSocket();
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

// Al instalar/recargar extensión
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['fid_sala', 'fid_num'], (data) => {
    if (data.fid_sala && data.fid_num) {
      conectarSocket(data.fid_sala, data.fid_num);
    }
  });
});

// --- KEEP ALIVE ---
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keep-alive") {
    // console.log("[Background] Keep-Alive ping received");

    // Check connection on keep-alive
    chrome.storage.local.get(['fid_sala', 'fid_num'], (data) => {
        if (data.fid_sala && data.fid_num) {
          if (!socket || !socket.connected) {
             conectarSocket(data.fid_sala, data.fid_num);
          }
        }
    });

    port.onDisconnect.addListener(() => {
      // console.log("[Background] Keep-Alive port closed");
    });
  }
});
