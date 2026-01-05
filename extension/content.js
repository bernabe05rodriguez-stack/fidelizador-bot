// --- CONFIGURACIÓN ---
// Ya no conectamos el socket aquí para evitar errores de Mixed Content.
// La conexión la maneja el Background Script.

// Iniciar Keep-Alive y listeners
setTimeout(() => iniciar(), 3000);

let keepAlivePort = null;

function iniciar() {
    chrome.storage.local.get(['fid_num', 'fid_sala'], (data) => {
        if (!data.fid_num || !data.fid_sala) {
            console.log("Fidelizador: Falta configurar número y sala en el icono.");
            return;
        }

        console.log("✅ Fidelizador iniciado en Content Script. Conectando a Background...");
        conectarKeepAlive();

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
    // 1. BUSCAR EN LA BARRA LATERAL
    const buscador = document.querySelector('div[contenteditable="true"][data-tab="3"]');
    if(!buscador) return console.error("No encuentro el buscador de WhatsApp");
    
    // Limpiar y escribir el número
    buscador.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, telefono);
    
    // Esperar a que WhatsApp procese el número
    await esperar(1500);

    // 2. PRESIONAR ENTER (Truco para buscar en la base de datos global)
    const enterEvent = new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, keyCode: 13, key: 'Enter', code: 'Enter'
    });
    buscador.dispatchEvent(enterEvent);

    // Esperar a que cargue el chat (o aparezca el botón de buscar)
    await esperar(3000);

    // Si aparece un resultado en la lista (el contacto), le damos click
    const primerResultado = document.querySelector('div[role="listitem"]'); 
    if(primerResultado) {
        primerResultado.click();
        await esperar(2000); // Esperar que abra el chat
    }

    // 3. ESCRIBIR EL MENSAJE Y ENVIAR
    const cajaChat = document.querySelector('div[contenteditable="true"][data-tab="10"]');
    if(cajaChat) {
        cajaChat.focus();
        document.execCommand('insertText', false, mensaje);
        await esperar(1000); // Pausa humana
        
        // Buscar botón enviar
        const btnEnviar = document.querySelector('button[aria-label="Send"]') || 
                          document.querySelector('span[data-icon="send"]');
        
        if(btnEnviar) {
            btnEnviar.click();
            console.log("✅ Mensaje enviado.");
        }
    } else {
        console.error("❌ No se pudo abrir el chat.");
    }
}

function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }
