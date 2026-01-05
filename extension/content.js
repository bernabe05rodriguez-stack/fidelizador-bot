// --- CONFIGURACIÓN ---
// Ya no conectamos el socket aquí para evitar errores de Mixed Content.
// La conexión la maneja el Background Script.

// Iniciar Keep-Alive y listeners
setTimeout(() => iniciar(), 3000);

// Listener para detectar configuración sin recargar página
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.fid_sala || changes.fid_num)) {
        iniciar();
    }
});

let keepAlivePort = null;
let monitorInterval = null;
let isFidelizadorRunning = false;

function iniciar() {
    if (isFidelizadorRunning) return;

    chrome.storage.local.get(['fid_num', 'fid_sala'], (data) => {
        if (!data.fid_num || !data.fid_sala) {
            console.log("Fidelizador: Falta configurar número y sala en el icono.");
            return;
        }

        isFidelizadorRunning = true;
        console.log("✅ Fidelizador iniciado en Content Script. Conectando a Background...");
        conectarKeepAlive();
        iniciarMonitorSesion();

        // Verificar si hay trabajo pendiente tras recarga (NUEVA LÓGICA)
        checkPendingJob();

        // Escuchar mensajes (solo una vez para evitar duplicados si 'iniciar' se llama varias veces)
        if (!window.hasFidelizadorListener) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (message.type === 'ORDEN' && message.payload) {
                    console.log(`🤖 ORDEN RECIBIDA (desde Background): Escribir a ${message.payload.destino}`);
                    abrirChatNuevo(message.payload.destino, message.payload.mensaje);
                }
            });
            window.hasFidelizadorListener = true;
        }
    });
}

function iniciarMonitorSesion() {
    if (monitorInterval) clearInterval(monitorInterval);
    monitorInterval = setInterval(() => {
        // Verificar si estamos logueados buscando elementos clave de la UI
        const isLogged = document.getElementById('pane-side') || document.querySelector('#side');

        // También podemos chequear si existe el canvas del QR (lo cual indica NO logueado)
        const qrCanvas = document.querySelector('canvas[aria-label="Scan me!"]');

        if (!isLogged && qrCanvas) {
             console.log("⚠️ DETECTADO LOGOUT O PANTALLA DE QR.");
             chrome.runtime.sendMessage({ type: 'LOGOUT_DETECTED' });
             clearInterval(monitorInterval); // Dejar de monitorear
        }
    }, 5000);
}

function conectarKeepAlive() {
    if (keepAlivePort) {
        try { keepAlivePort.disconnect(); } catch(e) {}
    }

    try {
        keepAlivePort = chrome.runtime.connect({ name: "keep-alive" });
        keepAlivePort.onDisconnect.addListener(() => {
            console.log("⚠️ Desconectado del Background. Reintentando en 10s...");
            keepAlivePort = null;
            setTimeout(conectarKeepAlive, 10000);
        });
    } catch (e) {
        console.error("Error conectando a background:", e);
        setTimeout(conectarKeepAlive, 10000);
    }
}

// --- FUNCIÓN DE CONTROL DE WHATSAPP ---
async function abrirChatNuevo(telefono, mensaje) {
    console.log(`🤖 Iniciando chat con ${telefono} (Método Link Injection)...`);

    // Guardar trabajo pendiente (Backup por si hay recarga)
    await chrome.storage.local.set({
        pending_job: {
            telefono,
            mensaje,
            timestamp: Date.now()
        }
    });

    // Limpiar número (solo dígitos)
    const cleanPhone = telefono.replace(/\D/g, '');

    // Intentar navegación interna sin recarga mediante click en link
    // Esto aprovecha el router interno de WhatsApp si es posible
    const link = document.createElement('a');
    link.href = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
    link.style.display = 'none';
    document.body.appendChild(link);

    console.log(`Clicking internal link to: ${cleanPhone}`);
    link.click();

    // Limpieza
    setTimeout(() => {
        if (link.parentNode) link.parentNode.removeChild(link);
    }, 1000);

    // Intentamos procesar inmediatamente (si no hubo recarga)
    // Si hubo recarga, checkPendingJob lo retomará.
    procesarEnvio(mensaje);
}

function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// --- FUNCIONES DE AUTOMATIZACION (NUEVA LÓGICA) ---

async function checkPendingJob() {
    // Usamos await en chrome.storage.local.get?
    // En MV3 puede retornar promesa, pero para ser seguros con el código existente,
    // usaremos un wrapper o callback. Aquí asumimos soporte de Promesa que es estándar en MV3 moderno.
    try {
        const data = await chrome.storage.local.get(['pending_job']);
        const job = data.pending_job;
        if (job) {
            console.log("Found pending job:", job);
            await procesarEnvio(job.mensaje);
            // Limpiar trabajo una vez procesado (o si falló para no buclear eternamente)
            await chrome.storage.local.remove('pending_job');
        }
    } catch (e) {
        console.error("Error checking pending job:", e);
    }
}

async function procesarEnvio(mensaje) {
    console.log("Waiting for chat input...");
    // 60s timeout para dar tiempo a cargar WhatsApp
    const cajaChat = await waitForElement('div[contenteditable="true"][data-tab="10"]', 60000);

    if (!cajaChat) {
        console.error("Timeout waiting for chat input.");
        return;
    }

    // Asegurar foco
    cajaChat.focus();

    // Pegar mensaje (comando nativo funciona mejor que manipular value en React)
    document.execCommand('insertText', false, mensaje);

    // Esperar 2s
    console.log(`Waiting 2000ms with message pasted...`);
    await esperar(2000);

    // Enviar
    const btnEnviar = document.querySelector('button[aria-label="Send"]') ||
                      document.querySelector('span[data-icon="send"]');
    if (btnEnviar) {
         const clickable = btnEnviar.closest('button') || btnEnviar;
         clickable.click();
    } else {
        const enterSend = new KeyboardEvent('keydown', {
            bubbles: true, cancelable: true, keyCode: 13, key: 'Enter', code: 'Enter'
        });
        cajaChat.dispatchEvent(enterSend);
    }
    console.log("✅ Mensaje enviado (Lógica nueva).");

    // Esperar 2s después de enviar
    await esperar(2000);

    // Limpiar trabajo una vez procesado con éxito
    chrome.storage.local.remove('pending_job');
}

function waitForElement(selector, timeout) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        if (timeout) {
            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        }
    });
}
