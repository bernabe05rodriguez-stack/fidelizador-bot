// content.js
// Este script corre dentro de la página de WhatsApp Web.

// Arrancamos todo después de unos segundos para dar tiempo a que cargue el DOM
setTimeout(() => arrancarBot(), 3000);

// Si cambia la config en el storage (desde el popup), reiniciamos
chrome.storage.onChanged.addListener((cambios, area) => {
    if (area === 'local' && (cambios.fid_sala || cambios.fid_num)) {
        arrancarBot();
    }
    // Si cambia la cola, y no estamos procesando, tal vez deberíamos arrancar?
    // Mejor lo manejamos internamente.
});

let puertoKeepAlive = null;
let intervaloMonitor = null;
let yaEstaCorriendo = false;

// --- COLA DE TRABAJO ---
let colaDeTrabajo = [];
let procesandoCola = false;

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
        // Buscamos paneles típicos de la interfaz logueada
        const estaLogueado = document.getElementById('pane-side') || document.querySelector('#side');

        // Si aparece CUALQUIER canvas en el body y NO estamos logueados, es el QR casi seguro.
        // (El chat normal no suele tener un canvas suelto en el body o landing wrapper).
        const hayCanvas = document.querySelector('canvas');

        // También podemos chequear texto de landing si queremos ser más específicos
        // pero con canvas suele bastar para la landing de WP Web.

        if (!estaLogueado && hayCanvas) {
             console.log("Parece que se cerró la sesión o estamos en el QR.");
             chrome.runtime.sendMessage({ type: 'LOGOUT_DETECTED' });
             clearInterval(intervaloMonitor);
        }
    }, 2000); // Chequeamos más seguido (2s)
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
    // Si clickeamos el link estando deslogueados, WP Web recarga la página y entramos en loop infinito.
    const estaLogueado = document.getElementById('pane-side') || document.querySelector('#side');
    if (!estaLogueado) {
        console.warn("Detectado intento de envío sin sesión activa. Abortando para evitar recarga.");
        // Forzamos chequeo de logout inmediato
        const hayCanvas = document.querySelector('canvas');
        if (hayCanvas) {
            chrome.runtime.sendMessage({ type: 'LOGOUT_DETECTED' });
        }
        return; // Salimos sin hacer nada
    }

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

    // Esperamos un poquito para que empiece la navegación antes de buscar el chat
    // No es estrictamente necesario porque esperarElemento lo maneja, pero ayuda a la estabilidad.
    await esperarUnToque(1000);

    // Si no recarga la página, seguimos derecho. Si recarga, 'chequearTrabajoPendiente' (ahora cargarColaYPendientes) se encarga.
    await procesarElEnvioDelMensaje(mensaje);
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

async function procesarElEnvioDelMensaje(mensaje) {
    console.log("Esperando que aparezca la caja de chat...");
    // Le damos hasta 60 segundos por si internet está lento
    const cajaChat = await esperarElemento('div[contenteditable="true"][data-tab="10"]', 60000);

    if (!cajaChat) {
        console.error("No apareció la caja de chat. Abortando.");
        // Si falló, lo borramos de pending para no trabar.
        // Idealmente podríamos reintentar poniéndolo en cola de nuevo, pero simple es mejor.
         chrome.storage.local.remove('pending_job');
        return;
    }

    // 1. Abrir chat (ya hecho) -> Esperar 2s
    console.log("Chat detectado. Esperando 2 segundos antes de pegar...");
    await esperarUnToque(2000);

    cajaChat.focus();

    // 2. Pegar mensaje
    console.log("Pegando mensaje...");
    // Usamos execCommand porque React a veces ignora cambios directos al value
    document.execCommand('insertText', false, mensaje);

    // 3. Esperar 2s
    console.log(`Mensaje pegado. Esperando 2 segundos para enviar...`);
    await esperarUnToque(2000);

    // 4. Enviar
    // Buscamos el botón de enviar
    const btnEnviar = document.querySelector('button[aria-label="Send"]') ||
                      document.querySelector('span[data-icon="send"]');

    if (btnEnviar) {
         // A veces el click está en un padre o hijo, aseguramos
         const elementoClickeable = btnEnviar.closest('button') || btnEnviar;
         simularClick(elementoClickeable); // Usamos simularClick para asegurar que React lo tome
    } else {
        // Si no está el botón (raro), probamos con Enter
        console.log("No encontré botón enviar, probando ENTER.");
        const enterEvent = new KeyboardEvent('keydown', {
            bubbles: true, cancelable: true, keyCode: 13, key: 'Enter', code: 'Enter'
        });
        cajaChat.dispatchEvent(enterEvent);
    }
    console.log("Mensaje enviado.");

    // Esperamos un poquito antes de dar por terminado para asegurar que se vaya
    await esperarUnToque(2000);

    // Limpiamos el pendiente SOLO AHORA que terminamos
    await chrome.storage.local.remove('pending_job');
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
