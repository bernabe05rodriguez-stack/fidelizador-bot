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
    console.log(`🤖 Iniciando chat con ${telefono}...`);

    // 1. ABRIR NUEVO CHAT (Ctrl+Alt+N)
    const newChatEvent = new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true,
        key: 'n', code: 'KeyN',
        ctrlKey: true, altKey: true
    });
    document.body.dispatchEvent(newChatEvent);
    
    // Esperar a que se abra el panel y cargue el input
    await esperar(1000);

    // 2. PEGAR NUMERO
    // Intentamos buscar el input visible en el panel de nuevo chat
    // Normalmente el foco se va ahí automáticamente.
    let searchInput = document.activeElement;
    if (!searchInput || !searchInput.getAttribute('contenteditable')) {
        // Fallback: buscamos input data-tab="3" que debería ser el del drawer si está abierto
        const possibleInputs = document.querySelectorAll('div[contenteditable="true"][data-tab="3"]');
        // Si hay varios, intentamos el último (usualmente el drawer está al final) o el que sea visible
        if (possibleInputs.length > 0) {
            searchInput = possibleInputs[possibleInputs.length - 1]; // Heurística
            searchInput.focus();
        } else {
            console.warn("No encontré input editable, intentando escribir en el elemento activo...");
        }
    }

    // Pegar número
    document.execCommand('insertText', false, telefono);

    // 3. ESPERAR 8 SEGUNDOS (Pedido por usuario)
    console.log("Esperando 8s para carga...");
    await esperar(8000);

    // 4. SELECCIONAR CHAT
    // Buscamos resultados visibles. El drawer de nuevo chat suele listar items con role="listitem"
    const resultados = document.querySelectorAll('div[role="listitem"]');

    if (resultados && resultados.length > 0) {
        console.log("Seleccionando chat...");
        // Click en el primer resultado (asumiendo que es el contacto buscado)
        simularClick(resultados[0]);
    } else {
        console.error("No se encontraron resultados.");
        // Fallback: Intentar Enter en el input por si acaso selecciona el único resultado
        if (searchInput) {
            const enterEvent = new KeyboardEvent('keydown', {
                bubbles: true, cancelable: true, keyCode: 13, key: 'Enter', code: 'Enter'
            });
            searchInput.dispatchEvent(enterEvent);
        }
    }

    // 5. ESPERAR 3 SEGUNDOS (Pedido por usuario)
    console.log("Esperando 3s tras selección...");
    await esperar(3000);

    // 6. PEGAR MENSAJE
    const cajaChat = document.querySelector('div[contenteditable="true"][data-tab="10"]');
    if (cajaChat) {
        cajaChat.focus();
        // Pegar mensaje
        document.execCommand('insertText', false, mensaje);

        // 7. ESPERAR 2-5 SEGUNDOS ALEATORIAMENTE
        const delay = Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000;
        console.log(`Esperando ${delay}ms antes de enviar...`);
        await esperar(delay);

        // 8. ENVIAR
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
        console.log("✅ Mensaje enviado.");

    } else {
        console.error("No se encontró la caja de chat.");
    }
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
