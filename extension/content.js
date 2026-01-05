// --- CONFIGURACIÓN ---
// Ya no conectamos el socket aquí para evitar errores de Mixed Content.
// La conexión la maneja el Background Script.

// Iniciar Keep-Alive y listeners
setTimeout(() => iniciar(), 3000);

let keepAlivePort = null;
let monitorInterval = null;

function iniciar() {
    chrome.storage.local.get(['fid_num', 'fid_sala'], (data) => {
        if (!data.fid_num || !data.fid_sala) {
            console.log("Fidelizador: Falta configurar número y sala en el icono.");
            return;
        }

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
    // 1. LIMPIAR BÚSQUEDA PREVIA (IMPORTANTE)
    const btnBorrarBusqueda = document.querySelector('span[data-icon="x-alt"]') || document.querySelector('span[data-icon="search-container-clean"]');
    if (btnBorrarBusqueda) {
        btnBorrarBusqueda.click();
        await esperar(500);
    }

    // 2. BUSCAR EN LA BARRA LATERAL
    const buscador = document.querySelector('div[contenteditable="true"][data-tab="3"]');
    if(!buscador) return console.error("No encuentro el buscador de WhatsApp");
    
    // --- FIX: LIMPIEZA ROBUSTA ---
    // Usamos textContent para forzar vaciado visual antes del insertText
    buscador.focus();
    buscador.textContent = '';
    // Pequeña espera para que React note el cambio si es necesario,
    // aunque execCommand insertText suele ser lo que React "escucha".
    await esperar(50);

    document.execCommand('insertText', false, telefono);
    
    // Esperar a que WhatsApp procese el número
    await esperar(1200);

    // 3. PRESIONAR ENTER (Para forzar búsqueda en la DB)
    const enterEvent = new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, keyCode: 13, key: 'Enter', code: 'Enter'
    });
    buscador.dispatchEvent(enterEvent);

    // Esperar resultados
    await esperar(3000);

    // 4. SELECCIONAR RESULTADO
    const resultados = document.querySelectorAll('div[role="listitem"]');
    if (resultados && resultados.length > 0) {
        console.log("Clickeando resultado...");
        // --- FIX: CLICK ROBUSTO (Mousedown -> Mouseup -> Click) ---
        simularClick(resultados[0]);
    } else {
        console.warn("No se encontraron resultados en la búsqueda.");
    }

    await esperar(2500); // Esperar cambio de chat

    // --- FIX: SAFETY CHECK (Evitar escribir si la búsqueda sigue activa) ---
    // Si el buscador todavía tiene texto, significa que NO se abrió el chat.
    if (buscador.textContent && buscador.textContent.trim().length > 0) {
        console.error("⛔ ABORTANDO: La búsqueda sigue activa. El chat no se abrió correctamente.");
        // Intentamos limpiar para la próxima
        buscador.textContent = '';
        return;
    }

    // 5. ESCRIBIR EL MENSAJE
    const cajaChat = document.querySelector('div[contenteditable="true"][data-tab="10"]');
    if(cajaChat) {
        cajaChat.focus();
        
        // Escribir mensaje
        document.execCommand('insertText', false, mensaje);
        await esperar(800);

        // 6. ENVIAR (Click + Enter por si acaso)
        const btnEnviar = document.querySelector('button[aria-label="Send"]') || 
                          document.querySelector('span[data-icon="send"]');
        
        if(btnEnviar) {
            // Click en el contenedor del icono a veces funciona mejor si el icono es un span
            // Buscamos el padre button si es un span
            const clickable = btnEnviar.closest('button') || btnEnviar;
            clickable.click();
            console.log("✅ Mensaje enviado (click).");
        } else {
            // Intentar ENTER en la caja de chat
            const enterSend = new KeyboardEvent('keydown', {
                bubbles: true, cancelable: true, keyCode: 13, key: 'Enter', code: 'Enter'
            });
            cajaChat.dispatchEvent(enterSend);
            console.log("✅ Mensaje enviado (enter).");
        }
    } else {
        console.error("❌ No se pudo abrir el chat (no veo la caja de texto).");
    }
}

function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

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
