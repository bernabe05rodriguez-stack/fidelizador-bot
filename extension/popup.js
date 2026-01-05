// CONFIGURACIÓN
const URL_SERVIDOR = "http://fidelizador.online";

const btnUnirte = document.getElementById('btnUnirte');
const listaSalas = document.getElementById('listaSalas');
const roomsContainer = document.getElementById('roomsContainer');
const statusMsg = document.getElementById('status');
const inputNumero = document.getElementById('miNumero');

// Secciones
const joinSection = document.getElementById('joinSection');
const controlsSection = document.getElementById('controlsSection');

// Elementos de info
const savedSalaEl = document.getElementById('savedSala');
const savedNumEl = document.getElementById('savedNum');
const statusLabel = document.getElementById('statusLabel');

// Botones de control
const btnPausar = document.getElementById('btnPausar');
const btnSalir = document.getElementById('btnSalir');

// Cargar datos guardados
chrome.storage.local.get(['fid_num', 'fid_sala', 'fid_paused'], (data) => {
  if (data.fid_num) {
    inputNumero.value = data.fid_num;
  }

  if (data.fid_sala && data.fid_num) {
    // ESTAMOS EN SALA
    mostrarControles(data);
  } else {
    // NO ESTAMOS EN SALA
    joinSection.style.display = 'block';
  }
});

function mostrarControles(data) {
  joinSection.style.display = 'none';
  controlsSection.style.display = 'block';

  savedSalaEl.innerText = data.fid_sala;
  savedNumEl.innerText = data.fid_num;

  actualizarUIEstado(data.fid_paused);
}

function actualizarUIEstado(isPaused) {
  if (isPaused) {
    statusLabel.innerText = "PAUSADO";
    statusLabel.style.color = "#f59e0b";
    btnPausar.innerText = "REANUDAR";
  } else {
    statusLabel.innerText = "ACTIVO";
    statusLabel.style.color = "green";
    btnPausar.innerText = "PAUSAR";
  }
}

// LOGICA BOTONES CONTROL
btnPausar.addEventListener('click', () => {
  chrome.storage.local.get(['fid_paused'], (data) => {
    const newState = !data.fid_paused;
    chrome.storage.local.set({ fid_paused: newState }, () => {
      actualizarUIEstado(newState);
    });
  });
});

btnSalir.addEventListener('click', () => {
  if (confirm("¿Seguro que quieres salir de la sala?")) {
    chrome.storage.local.remove(['fid_sala', 'fid_paused'], () => {
      // Nota: No borramos el número para que sea fácil volver a entrar
      location.reload(); // Recargar popup para volver a inicio
    });
  }
});

let socket = null;

function conectarYListar() {
  if (socket && socket.connected) {
    socket.emit('get_rooms');
    return;
  }

  statusMsg.innerText = "Conectando al servidor...";
  
  socket = io(URL_SERVIDOR);

  socket.on('connect', () => {
    statusMsg.innerText = "Conectado. Buscando salas...";
    socket.emit('get_rooms');
  });

  socket.on('rooms_list', (rooms) => {
    mostrarSalas(rooms);
    statusMsg.innerText = "";
  });
  
  socket.on('rooms_update', (rooms) => {
    mostrarSalas(rooms);
  });

  socket.on('connect_error', () => {
    statusMsg.innerText = "Error al conectar con fidelizador.online";
  });
}

function mostrarSalas(rooms) {
  listaSalas.style.display = 'block';
  roomsContainer.innerHTML = '';

  if (!rooms || rooms.length === 0) {
    roomsContainer.innerHTML = '<span style="font-size:0.8rem; color:#888">No hay salas disponibles.</span>';
    return;
  }

  rooms.forEach(room => {
    const div = document.createElement('div');
    div.className = 'room-item';

    const spanName = document.createElement('span');
    spanName.className = 'room-name';
    spanName.innerText = room.name;

    const spanCount = document.createElement('span');
    spanCount.className = 'room-count';
    spanCount.innerText = `${room.count} usu`;

    div.appendChild(spanName);
    div.appendChild(spanCount);

    div.addEventListener('click', () => {
      guardarYSalir(room.name);
    });

    roomsContainer.appendChild(div);
  });
}

function guardarYSalir(salaNombre) {
  const rawNumero = inputNumero.value;
  if (!rawNumero) return alert("Por favor ingresa tu número.");

  // Limpiar número (solo dígitos)
  const cleanNumero = rawNumero.replace(/\D/g, '');

  if (cleanNumero.length < 5) return alert("El número parece inválido.");

  chrome.storage.local.set({ 'fid_num': cleanNumero, 'fid_sala': salaNombre, 'fid_paused': false }, () => {
    alert(`Te has unido a la sala "${salaNombre}".\n\nSi WhatsApp ya está abierto, recarga la página (F5) para activar.`);
    window.close(); // Cerrar popup
  });
}

btnUnirte.addEventListener('click', () => {
  if (!inputNumero.value) return alert("Ingresa tu número primero.");
  // Guardamos el número aunque no elija sala aún, por comodidad
  const cleanNumero = inputNumero.value.replace(/\D/g, '');
  if(cleanNumero.length > 5) {
      chrome.storage.local.set({ 'fid_num': cleanNumero });
  }
  conectarYListar();
});
