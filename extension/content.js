// --- CONFIGURACIÓN ---
// --- CONFIGURA TU SERVIDOR AQUÍ ---
// 1. Despliega el servidor en Easypanel siguiendo la GUIA_DESPLIEGUE.md
// 2. Copia la URL de tu dominio (ej: https://fidelizador.tudominio.com/)
// 3. Pégala abajo entre las comillas:
const URL_SERVIDOR = "PONER_TU_URL_AQUI";
setTimeout(() => iniciar(), 3000);

function iniciar() {
    chrome.storage.local.get(['fid_num', 'fid_sala'], (data) => {
        // Si el usuario no configuró el popup, no hacemos nada
        if (!data.fid_num || !data.fid_sala) return console.log("Fidelizador: Falta configurar número y sala en el icono.");

        // Conexión al servidor
        const socket = io(URL_SERVIDOR); 

        socket.on("connect", () => {
            console.log("✅ Conectado a Sala:", data.fid_sala);
            // Nos unimos a la sala
            socket.emit("unirse", { sala: data.fid_sala, miNumero: data.fid_num });
        });

        // Escuchar órdenes del servidor
        socket.on("orden_servidor", async (msg) => {
            console.log(`🤖 ORDEN RECIBIDA: Escribir a ${msg.destino}`);
            await abrirChatNuevo(msg.destino, msg.mensaje);
        });
    });
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
