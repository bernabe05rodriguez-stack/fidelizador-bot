// content.js
// Este script corre dentro de la página de WhatsApp Web.

// Arrancamos todo después de unos segundos para dar tiempo a que cargue el DOM
setTimeout(() => arrancarBot(), 3000);

// Si cambia la config en el storage (desde el popup), reiniciamos
chrome.storage.onChanged.addListener((cambios, area) => {
    if (area === 'local' && (cambios.fid_sala || cambios.fid_num)) {
        arrancarBot();
    }
});

let puertoKeepAlive = null;
let intervaloMonitor = null;
let yaEstaCorriendo = false;

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

        // Revisar si quedó algo colgado de antes (por si se refrescó la página)
        chequearTrabajoPendiente();

        // Escuchar órdenes del background (solo agrego el listener una vez)
        if (!window.tieneListenerFidelizador) {
            chrome.runtime.onMessage.addListener((mensaje, sender, responder) => {
                if (mensaje.type === 'ORDEN' && mensaje.payload) {
                    console.log(`Orden recibida: Escribir a ${mensaje.payload.destino}`);
                    abrirChatYEnviar(mensaje.payload.destino, mensaje.payload.mensaje);
                }
            });
            window.tieneListenerFidelizador = true;
        }
    });
}

// Revisa periódicamente si seguimos logueados en WhatsApp
function monitorearSesion() {
    if (intervaloMonitor) clearInterval(intervaloMonitor);
    intervaloMonitor = setInterval(() => {
        // Buscamos paneles típicos de la interfaz logueada
        const estaLogueado = document.getElementById('pane-side') || document.querySelector('#side');

        // Si aparece el canvas del código QR, es que nos fuimos
        const canvasQR = document.querySelector('canvas[aria-label="Scan me!"]');

        if (!estaLogueado && canvasQR) {
             console.log("Parece que se cerró la sesión o estamos en el QR.");
             chrome.runtime.sendMessage({ type: 'LOGOUT_DETECTED' });
             clearInterval(intervaloMonitor);
        }
    }, 5000);
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
    console.log(`Iniciando proceso para: ${telefono}`);

    // Guardo esto por seguridad, por si la página recarga en el medio
    await chrome.storage.local.set({
        pending_job: {
            telefono,
            mensaje,
            timestamp: Date.now()
        }
    });

    const telefonoLimpio = telefono.replace(/\D/g, '');

    // Truco: inyectamos un link y le hacemos click para usar el router interno de React de WhatsApp
    // Así evitamos recargar toda la página.
    const link = document.createElement('a');
    link.href = `https://web.whatsapp.com/send?phone=${telefonoLimpio}`;
    link.style.display = 'none';
    document.body.appendChild(link);

    console.log(`Click en link interno hacia: ${telefonoLimpio}`);
    link.click();

    // Borro el link después de un ratito
    setTimeout(() => {
        if (link.parentNode) link.parentNode.removeChild(link);
    }, 1000);

    // Si no recarga la página, seguimos derecho. Si recarga, 'chequearTrabajoPendiente' se encarga.
    procesarElEnvioDelMensaje(mensaje);
}

function esperarUnToque(ms) { return new Promise(r => setTimeout(r, ms)); }

// Se mantiene simularClick por ser útil
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

// Función vieja confiable para revisar si hay jobs colgados
async function chequearTrabajoPendiente() {
    try {
        const data = await chrome.storage.local.get(['pending_job']);
        const trabajo = data.pending_job;
        if (trabajo) {
            console.log("Encontré un trabajo pendiente:", trabajo);
            await procesarElEnvioDelMensaje(trabajo.mensaje);
            // Ya está, lo borramos
            await chrome.storage.local.remove('pending_job');
        }
    } catch (e) {
        console.error("Error chequeando pendientes:", e);
    }
}

async function procesarElEnvioDelMensaje(mensaje) {
    console.log("Esperando que aparezca la caja de chat...");
    // Le damos hasta 60 segundos por si internet está lento
    const cajaChat = await esperarElemento('div[contenteditable="true"][data-tab="10"]', 60000);

    if (!cajaChat) {
        console.error("No apareció la caja de chat. Abortando.");
        return;
    }

    cajaChat.focus();

    // Usamos execCommand porque React a veces ignora cambios directos al value
    document.execCommand('insertText', false, mensaje);

    console.log(`Mensaje pegado. Esperando 2 segs para enviar...`);
    await esperarUnToque(2000);

    // Buscamos el botón de enviar
    const btnEnviar = document.querySelector('button[aria-label="Send"]') ||
                      document.querySelector('span[data-icon="send"]');

    if (btnEnviar) {
         // A veces el click está en un padre o hijo, aseguramos
         const elementoClickeable = btnEnviar.closest('button') || btnEnviar;
         elementoClickeable.click();
    } else {
        // Si no está el botón (raro), probamos con Enter
        const enterEvent = new KeyboardEvent('keydown', {
            bubbles: true, cancelable: true, keyCode: 13, key: 'Enter', code: 'Enter'
        });
        cajaChat.dispatchEvent(enterEvent);
    }
    console.log("Mensaje enviado.");

    // Esperamos un poquito antes de dar por terminado
    await esperarUnToque(2000);

    // Limpiamos el pendiente
    chrome.storage.local.remove('pending_job');
}

// Utilidad para esperar que aparezca algo en el DOM
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
