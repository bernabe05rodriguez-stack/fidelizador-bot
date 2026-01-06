// content.js
// Este script corre dentro de la página de WhatsApp Web.

// --- CONFIG DEFAULT POR SI NO HAY SERVER ---
let clientConfig = {
  selectors: {
    chatBox: 'div[contenteditable="true"][data-tab="10"]',
    btnSend: 'button[aria-label="Send"]',
    btnSendAlt: 'span[data-icon="send"]',
    sidePane: '#pane-side',
    sidePaneAlt: '#side',
    logoutCanvas: 'canvas'
  },
  timeouts: {
    navWait: 1000,
    chatLoad: 60000,
    prePaste: 2000,
    preSend: 2000,
    postSend: 2000
  }
};

// Intentar cargar config desde storage al inicio
chrome.storage.local.get(['client_config'], (data) => {
    if (data.client_config) {
        console.log("Configuración remota cargada.");
        clientConfig = data.client_config;
    }
    // Iniciamos la espera inteligente
    iniciarEsperaDeCarga();
});

// Escuchar cambios de config en tiempo real
chrome.storage.onChanged.addListener((cambios, area) => {
    if (area === 'local' && cambios.client_config) {
        console.log("Configuración actualizada en caliente.");
        clientConfig = cambios.client_config.newValue;
    }
});

let puertoKeepAlive = null;
let intervaloMonitor = null;
let yaEstaCorriendo = false;
let intervaloEsperaCarga = null;

// --- COLA DE TRABAJO ---
let colaDeTrabajo = [];
let procesandoCola = false;

function iniciarEsperaDeCarga() {
    if (intervaloEsperaCarga) clearInterval(intervaloEsperaCarga);

    console.log("Esperando que WhatsApp Web termine de cargar...");

    // Polling cada 500ms para ver si ya está el panel lateral
    intervaloEsperaCarga = setInterval(() => {
        const sidePane = document.querySelector(clientConfig.selectors.sidePane) ||
                         document.querySelector(clientConfig.selectors.sidePaneAlt);

        if (sidePane) {
            console.log("WhatsApp Web cargado. Iniciando bot...");
            clearInterval(intervaloEsperaCarga);
            intervaloEsperaCarga = null;
            arrancarBot();
        }
    }, 500);
}

// Si cambia la config en el storage (desde el popup), reiniciamos si es necesario
chrome.storage.onChanged.addListener((cambios, area) => {
    if (area === 'local' && (cambios.fid_sala || cambios.fid_num)) {
        // Si cambian credenciales, re-verificamos estado
        yaEstaCorriendo = false;
        iniciarEsperaDeCarga();
    }
});


function arrancarBot() {
    if (yaEstaCorriendo) return;

    chrome.storage.local.get(['fid_num', 'fid_sala'], (datos) => {
        if (!datos.fid_num || !datos.fid_sala) {
            console.log("Fidelizador: Faltan datos (número o sala). Esperando configuración.");
            return;
        }

        yaEstaCorriendo = true;
        console.log("Fidelizador activo. Iniciando conexión con Background...");
        mantenerVivaLaConexion();
        monitorearSesion();

        // Cargar cola persistida y trabajos pendientes
        cargarColaYPendientes();

        // Escuchar órdenes del background (solo agrego el listener una vez)
        if (!window.tieneListenerFidelizador) {
            chrome.runtime.onMessage.addListener((mensaje, sender, responder) => {
                if (mensaje.type === 'ORDEN' && mensaje.payload) {
                    console.log(`Orden recibida: Escribir a ${mensaje.payload.destino}`);
                    agregarACola(mensaje.payload.destino, mensaje.payload.mensaje);
                }
            });
            window.tieneListenerFidelizador = true;
        }
    });
}

async function cargarColaYPendientes() {
    try {
        const data = await chrome.storage.local.get(['cola_trabajo', 'pending_job']);

        // 1. Cargar cola persistida
        if (data.cola_trabajo && Array.isArray(data.cola_trabajo)) {
            colaDeTrabajo = data.cola_trabajo;
            console.log(`Cola cargada (${colaDeTrabajo.length} items).`);
        }

        // 2. Revisar si había un trabajo activo (pending_job) que se interrumpió
        const trabajo = data.pending_job;
        if (trabajo) {
            console.log("Encontré un trabajo pendiente (interrumpido):", trabajo);

            // Verificamos antigüedad (> 5 mins descarta)
            const ahora = Date.now();
            if (trabajo.timestamp && (ahora - trabajo.timestamp > 300000)) {
                 console.log("Trabajo pendiente muy viejo, descartando.");
                 await chrome.storage.local.remove('pending_job');
            } else {
                 // Lo ponemos PRIMERO en la cola para reintentarlo
                 colaDeTrabajo.unshift({ telefono: trabajo.telefono, mensaje: trabajo.mensaje });
                 await guardarCola();
                 // Y borramos el pending_job porque ahora está en la cola y se volverá a setear como pending cuando se procese
                 await chrome.storage.local.remove('pending_job');
            }
        }

        // Arrancamos a procesar si hay algo
        if (colaDeTrabajo.length > 0) {
            procesarCola();
        }

    } catch (e) {
        console.error("Error cargando cola/pendientes:", e);
    }
}

async function guardarCola() {
    await chrome.storage.local.set({ cola_trabajo: colaDeTrabajo });
}

async function agregarACola(telefono, mensaje) {
    colaDeTrabajo.push({ telefono, mensaje });
    await guardarCola();
    procesarCola();
}

async function procesarCola() {
    if (procesandoCola) return;
    procesandoCola = true;

    while (colaDeTrabajo.length > 0) {
        // Miramos el primero pero NO lo sacamos todavía del todo de la persistencia
        // hasta que empiece realmente (o lo sacamos y lo ponemos en pending_job)
        const trabajo = colaDeTrabajo[0];

        // Lo sacamos del array local
        colaDeTrabajo.shift();
        // Guardamos el array actualizado (sin este item)
        await guardarCola();

        try {
            await abrirChatYEnviar(trabajo.telefono, trabajo.mensaje);
        } catch (error) {
            console.error("Error procesando trabajo:", error);
        }
    }

    procesandoCola = false;
}

// Revisa periódicamente si seguimos logueados en WhatsApp
function monitorearSesion() {
    if (intervaloMonitor) clearInterval(intervaloMonitor);
    intervaloMonitor = setInterval(() => {
        // Buscamos paneles típicos de la interfaz logueada usando CONFIG
        const estaLogueado = document.querySelector(clientConfig.selectors.sidePane) ||
                             document.querySelector(clientConfig.selectors.sidePaneAlt);

        const hayCanvas = document.querySelector(clientConfig.selectors.logoutCanvas);

        if (!estaLogueado && hayCanvas) {
             console.log("Parece que se cerró la sesión o estamos en el QR.");
             chrome.runtime.sendMessage({ type: 'LOGOUT_DETECTED' });
             clearInterval(intervaloMonitor);
        }
    }, 2000);
}

// Conexión persistente para que el Service Worker no se duerma
function mantenerVivaLaConexion() {
    if (puertoKeepAlive) {
        try { puertoKeepAlive.disconnect(); } catch(e) {}
    }

    try {
        puertoKeepAlive = chrome.runtime.connect({ name: "keep-alive" });
        puertoKeepAlive.onDisconnect.addListener(() => {
            console.log("Se cortó la conexión con Background. Reintentando en 10s...");
            puertoKeepAlive = null;
            setTimeout(mantenerVivaLaConexion, 10000);
        });
    } catch (error) {
        console.error("Error al conectar keep-alive:", error);
        setTimeout(mantenerVivaLaConexion, 10000);
    }
}

// --- LÓGICA DE AUTOMATIZACIÓN ---

async function abrirChatYEnviar(telefono, mensaje) {
    // 1. Verificar logueo ANTES de hacer nada.
    const estaLogueado = document.querySelector(clientConfig.selectors.sidePane) ||
                         document.querySelector(clientConfig.selectors.sidePaneAlt);

    if (!estaLogueado) {
        console.warn("Detectado intento de envío sin sesión activa. Abortando para evitar recarga.");
        const hayCanvas = document.querySelector(clientConfig.selectors.logoutCanvas);
        if (hayCanvas) {
            chrome.runtime.sendMessage({ type: 'LOGOUT_DETECTED' });
        }
        return;
    }

    console.log(`Iniciando proceso para: ${telefono}`);

    await chrome.storage.local.set({
        pending_job: {
            telefono,
            mensaje,
            timestamp: Date.now()
        }
    });

    const telefonoLimpio = telefono.replace(/\D/g, '');

    // Truco: inyectamos un link y le hacemos click para usar el router interno
    const link = document.createElement('a');
    link.href = `https://web.whatsapp.com/send?phone=${telefonoLimpio}`;
    link.style.display = 'none';
    document.body.appendChild(link);

    console.log(`Click en link interno hacia: ${telefonoLimpio}`);
    link.click();

    setTimeout(() => {
        if (link.parentNode) link.parentNode.removeChild(link);
    }, 1000);

    // Espera configurable
    await esperarUnToque(clientConfig.timeouts.navWait);

    await procesarElEnvioDelMensaje(mensaje);
}

function esperarUnToque(ms) { return new Promise(r => setTimeout(r, ms)); }

function simularClick(elemento) {
    const eventos = ['mousedown', 'mouseup', 'click'];
    eventos.forEach(tipo => {
        const evento = new MouseEvent(tipo, {
            bubbles: true,
            cancelable: true,
            view: window
        });
        elemento.dispatchEvent(evento);
    });
}

async function procesarElEnvioDelMensaje(mensaje) {
    console.log("Esperando que aparezca la caja de chat...");
    // Timeout configurable
    const cajaChat = await esperarElemento(clientConfig.selectors.chatBox, clientConfig.timeouts.chatLoad);

    if (!cajaChat) {
        console.error("No apareció la caja de chat. Abortando.");
         chrome.storage.local.remove('pending_job');
        return;
    }

    console.log(`Chat detectado. Esperando ${clientConfig.timeouts.prePaste}ms antes de pegar...`);
    await esperarUnToque(clientConfig.timeouts.prePaste);

    cajaChat.focus();

    console.log("Pegando mensaje...");
    document.execCommand('insertText', false, mensaje);

    console.log(`Mensaje pegado. Esperando ${clientConfig.timeouts.preSend}ms para enviar...`);
    await esperarUnToque(clientConfig.timeouts.preSend);

    // Buscamos botón enviar con selectores dinámicos
    const btnEnviar = document.querySelector(clientConfig.selectors.btnSend) ||
                      document.querySelector(clientConfig.selectors.btnSendAlt);

    if (btnEnviar) {
         const elementoClickeable = btnEnviar.closest('button') || btnEnviar;
         simularClick(elementoClickeable);
    } else {
        console.log("No encontré botón enviar, probando ENTER.");
        const enterEvent = new KeyboardEvent('keydown', {
            bubbles: true, cancelable: true, keyCode: 13, key: 'Enter', code: 'Enter'
        });
        cajaChat.dispatchEvent(enterEvent);
    }
    console.log("Mensaje enviado.");

    await esperarUnToque(clientConfig.timeouts.postSend);

    await chrome.storage.local.remove('pending_job');
}

function esperarElemento(selector, timeout) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observador = new MutationObserver(mutaciones => {
            if (document.querySelector(selector)) {
                observador.disconnect();
                resolve(document.querySelector(selector));
            }
        });

        observador.observe(document.body, {
            childList: true,
            subtree: true
        });

        if (timeout) {
            setTimeout(() => {
                observador.disconnect();
                resolve(null);
            }, timeout);
        }
    });
}
