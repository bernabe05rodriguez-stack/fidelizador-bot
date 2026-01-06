// background.js
// Este es el service worker. Se encarga de mantener la conexión con el server y hablar con la pestaña de WhatsApp.

// Manejo de errores que no agarramos en otro lado
self.addEventListener('error', (evento) => {
  console.error("Ups, error en Background:", evento.error || evento.message);
});

self.addEventListener('unhandledrejection', (evento) => {
  console.error("Promesa rechazada no manejada:", evento.reason);
});

// Importamos la librería de Socket.IO. Si falla esto, no anda nada.
try {
  importScripts('socket.io.js');
} catch (error) {
  console.error("CRITICO: No pude cargar socket.io.js", error);
}

const URL_SERVIDOR = "http://fidelizador.online";
let socket = null;
let salaActual = null;
let miNumeroActual = null;
let intervaloHeartbeat = null; // Para enviar latidos

// Función principal para conectarnos al socket
function conectarAlSocket(sala, numero) {
  // Chequeo básico por si no cargó la librería
  if (typeof io === 'undefined') {
    console.error("No existe 'io'. Algo salió mal con la importación.");
    return;
  }

  // Si ya estoy conectado con los mismos datos, no hago nada
  if (socket && socket.connected) {
    if (salaActual === sala && miNumeroActual === numero) return;
    // Si cambiaron los datos, desconecto para reconectar
    socket.disconnect();
  }

  salaActual = sala;
  miNumeroActual = numero;

  console.log(`Intentando conectar a ${URL_SERVIDOR} | Usuario: ${numero} | Sala: ${sala}`);

  try {
    // IMPORTANTE: Forzamos websocket porque en Service Worker el polling suele fallar
    socket = io(URL_SERVIDOR, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      transports: ['websocket'], // Esto es clave para que no se caiga
      forceNew: true
    });

    socket.on('connect', () => {
      console.log("Socket conectado ok. ID:", socket.id);
      // Le aviso al server que me uno
      socket.emit('unirse', { sala: sala, miNumero: numero });

      // ARRANCAMOS HEARTBEAT
      iniciarHeartbeat();
    });

    socket.on('connect_error', (err) => {
      console.error("Error de conexión:", err.message);
    });

    // Cuando el server me manda una orden (escribirle a alguien)
    socket.on('orden_servidor', (msg) => {
      console.log("Me llegó una orden del server:", msg);
      enviarOrdenAContentScript(msg);
    });

    // Guardar configuración que viene del server
    socket.on('config_cliente', (config) => {
      console.log("Recibida configuración del servidor:", config);
      chrome.storage.local.set({ client_config: config });
    });

    socket.on('disconnect', (razon) => {
      console.log("Se desconectó el socket:", razon);
      pararHeartbeat();
    });

    // --- MANEJO DE EXPULSIÓN / ELIMINACIÓN DE SALA ---
    socket.on('usuario_expulsado', () => {
        console.warn("HE SIDO EXPULSADO POR ADMIN.");
        limpiarYSalir("Has sido desconectado por el administrador.");
    });

    socket.on('sala_eliminada', () => {
        console.warn("LA SALA FUE ELIMINADA.");
        limpiarYSalir("La sala ha sido eliminada. Deteniendo operaciones.");
    });

    socket.on('error_sala', (msg) => {
        console.warn("Error de sala:", msg);
        limpiarYSalir(msg);
    });

  } catch (excepcion) {
    console.error("Excepción al crear el socket:", excepcion);
  }
}

function iniciarHeartbeat() {
    pararHeartbeat();
    // Enviamos 'latido' cada 5 segundos para decir "estoy vivo"
    intervaloHeartbeat = setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('heartbeat');
        }
    }, 5000);
}

function pararHeartbeat() {
    if (intervaloHeartbeat) {
        clearInterval(intervaloHeartbeat);
        intervaloHeartbeat = null;
    }
}

function desconectarDelSocket() {
  pararHeartbeat();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  salaActual = null;
  miNumeroActual = null;
}

// Función auxiliar para limpiar storage y alertar (si se pudiera)
function limpiarYSalir(motivo) {
    console.log("Limpiando y saliendo:", motivo);
    if (socket && socket.connected) socket.disconnect();

    // Borramos todo del storage local para evitar reconexión automática
    chrome.storage.local.remove(['fid_sala', 'fid_num', 'fid_paused'], () => {
        desconectarDelSocket();
        // Opcional: Avisar al content script para que muestre alert
        // (No crítico pero bueno para UX)
    });
}

// Le pasamos el mensaje a la pestaña activa de WhatsApp
function enviarOrdenAContentScript(mensaje) {
  chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, (pestañas) => {
    if (pestañas && pestañas.length > 0) {
      pestañas.forEach(pestana => {
        chrome.tabs.sendMessage(pestana.id, { type: 'ORDEN', payload: mensaje })
          .catch(err => console.log("No se pudo enviar a la pestaña (¿cerrada?):", err));
      });
    } else {
      console.log("Ojo: No encontré ninguna pestaña de WhatsApp abierta.");
    }
  });
}

// Escuchamos cambios en la configuración (Storage)
chrome.storage.onChanged.addListener((cambios, area) => {
  if (area === 'local') {

    // 1. Si cambia la sala o el número, hay que reconectar o desconectar
    if (cambios.fid_sala || cambios.fid_num) {
      chrome.storage.local.get(['fid_sala', 'fid_num'], (datos) => {
        if (datos.fid_sala && datos.fid_num) {
          conectarAlSocket(datos.fid_sala, datos.fid_num);
        } else {
          // Si faltan datos es porque el usuario salió (Logout)
          if (socket && socket.connected) {
             socket.emit('abandonar'); // Aviso prolijo al server
             setTimeout(desconectarDelSocket, 200);
          } else {
             desconectarDelSocket();
          }
        }
      });
    }

    // 2. Si el usuario pausa o despausa
    if (cambios.fid_paused) {
      const estadoPausa = cambios.fid_paused.newValue;
      if (socket && socket.connected) {
        console.log(`Cambiando estado de pausa a: ${estadoPausa}`);
        socket.emit('pausar', estadoPausa);
      }
    }
  }
});

// Mensajes que vienen desde el script de contenido (content.js)
chrome.runtime.onMessage.addListener((mensaje, sender, responder) => {
  // Si detectamos que se deslogueó de WhatsApp Web
  if (mensaje.type === 'LOGOUT_DETECTED') {
    console.log("Se detectó logout en la web -> Limpiando todo.");

    if (socket && socket.connected) socket.emit('abandonar');

    // Borro los datos para que no se vuelva a conectar solo
    chrome.storage.local.remove(['fid_sala', 'fid_paused'], () => {
       desconectarDelSocket();
    });
  }
});

// Al arrancar el navegador
chrome.runtime.onStartup.addListener(() => {
  verificarYConectar();
});

// Al instalar o recargar la extensión
chrome.runtime.onInstalled.addListener(() => {
  verificarYConectar();
});

function verificarYConectar() {
  chrome.storage.local.get(['fid_sala', 'fid_num'], (datos) => {
    if (datos.fid_sala && datos.fid_num) {
      conectarAlSocket(datos.fid_sala, datos.fid_num);
    }
  });
}

// --- KEEP ALIVE ---
// Truco para mantener vivo el Service Worker
chrome.runtime.onConnect.addListener((puerto) => {
  if (puerto.name === "keep-alive") {
    // Chequeamos conexión cada vez que el content script nos habla
    chrome.storage.local.get(['fid_sala', 'fid_num'], (datos) => {
        if (datos.fid_sala && datos.fid_num) {
          if (!socket || !socket.connected) {
             conectarAlSocket(datos.fid_sala, datos.fid_num);
          }
        }
    });

    puerto.onDisconnect.addListener(() => {
      // Se desconectó el puerto (posiblemente se cerró la pestaña)
    });
  }
});
