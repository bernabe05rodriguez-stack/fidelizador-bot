// popup.js
// Lógica de la ventanita de la extensión

const URL_SERVIDOR = "http://fidelizador.online";

// Referencias a elementos del DOM
const btnUnirte = document.getElementById('btnUnirte');
const listaSalas = document.getElementById('listaSalas');
const contenedorSalas = document.getElementById('roomsContainer');
const mensajeEstado = document.getElementById('status');
const inputNumero = document.getElementById('miNumero');

// Secciones
const seccionUnirse = document.getElementById('joinSection');
const seccionControles = document.getElementById('controlsSection');

// Infos
const labelSala = document.getElementById('savedSala');
const labelNum = document.getElementById('savedNum');
const labelEstado = document.getElementById('statusLabel');

// Botones
const btnPausar = document.getElementById('btnPausar');
const btnSalir = document.getElementById('btnSalir');

// Al abrir, chequeamos si ya hay datos guardados
chrome.storage.local.get(['fid_num', 'fid_sala', 'fid_paused'], (datos) => {
  if (datos.fid_num) {
    inputNumero.value = datos.fid_num;
  }

  if (datos.fid_sala && datos.fid_num) {
    // Ya estamos adentro
    mostrarPantallaControles(datos);
  } else {
    // Hay que unirse
    seccionUnirse.style.display = 'block';
  }
});

function mostrarPantallaControles(datos) {
  seccionUnirse.style.display = 'none';
  seccionControles.style.display = 'block';

  labelSala.innerText = datos.fid_sala;
  labelNum.innerText = datos.fid_num;

  actualizarVisualEstado(datos.fid_paused);
}

function actualizarVisualEstado(estaPausado) {
  if (estaPausado) {
    labelEstado.innerText = "PAUSADO";
    labelEstado.style.color = "#f59e0b"; // Naranja
    btnPausar.innerText = "REANUDAR";
  } else {
    labelEstado.innerText = "ACTIVO";
    labelEstado.style.color = "green";
    btnPausar.innerText = "PAUSAR";
  }
}

// -- Eventos de los botones --

btnPausar.addEventListener('click', () => {
  chrome.storage.local.get(['fid_paused'], (datos) => {
    const nuevoEstado = !datos.fid_paused;
    // Guardamos y actualizamos la UI
    chrome.storage.local.set({ fid_paused: nuevoEstado }, () => {
      actualizarVisualEstado(nuevoEstado);
    });
  });
});

btnSalir.addEventListener('click', () => {
  if (confirm("¿Seguro que querés salir de la sala?")) {
    chrome.storage.local.remove(['fid_sala', 'fid_paused'], () => {
      // El número no lo borro así es más fácil entrar la próxima
      location.reload();
    });
  }
});

let socketPopup = null;

function conectarYBuscarSalas() {
  if (socketPopup && socketPopup.connected) {
    socketPopup.emit('get_rooms'); // Pido salas de nuevo
    return;
  }

  mensajeEstado.innerText = "Conectando...";
  
  socketPopup = io(URL_SERVIDOR);

  socketPopup.on('connect', () => {
    mensajeEstado.innerText = "Conectado. Trayendo salas...";
    socketPopup.emit('get_rooms');
  });

  socketPopup.on('rooms_list', (salas) => {
    renderizarSalas(salas);
    mensajeEstado.innerText = "";
  });
  
  // Actualización en tiempo real
  socketPopup.on('rooms_update', (salas) => {
    renderizarSalas(salas);
  });

  socketPopup.on('connect_error', () => {
    mensajeEstado.innerText = "Error: No se pudo conectar a fidelizador.online";
  });
}

function renderizarSalas(salas) {
  listaSalas.style.display = 'block';
  contenedorSalas.innerHTML = '';

  if (!salas || salas.length === 0) {
    contenedorSalas.innerHTML = '<span style="font-size:0.8rem; color:#888">No encontré salas activas.</span>';
    return;
  }

  salas.forEach(sala => {
    const div = document.createElement('div');
    div.className = 'room-item';

    const nombreSala = document.createElement('span');
    nombreSala.className = 'room-name';
    nombreSala.innerText = sala.name;

    const contador = document.createElement('span');
    contador.className = 'room-count';
    contador.innerText = `${sala.count} usu`;

    div.appendChild(nombreSala);
    div.appendChild(contador);

    div.addEventListener('click', () => {
      guardarConfiguracion(sala.name);
    });

    contenedorSalas.appendChild(div);
  });
}

function guardarConfiguracion(nombreSala) {
  const numeroBruto = inputNumero.value;
  if (!numeroBruto) return alert("Che, poné tu número.");

  // Dejamos solo números
  const numeroLimpio = numeroBruto.replace(/\D/g, '');

  if (numeroLimpio.length < 5) return alert("Ese número parece muy corto, revisalo.");

  chrome.storage.local.set({
      'fid_num': numeroLimpio,
      'fid_sala': nombreSala,
      'fid_paused': false
  }, () => {
    alert(`Listo! Te uniste a "${nombreSala}".\n\nEl sistema va a arrancar solo en WhatsApp Web.`);
    window.close(); // Cerramos el popup
  });
}

btnUnirte.addEventListener('click', () => {
  if (!inputNumero.value) return alert("Primero ingresá tu número.");

  // Guardo el número provisorio
  const numeroLimpio = inputNumero.value.replace(/\D/g, '');
  if(numeroLimpio.length > 5) {
      chrome.storage.local.set({ 'fid_num': numeroLimpio });
  }

  conectarYBuscarSalas();
});
