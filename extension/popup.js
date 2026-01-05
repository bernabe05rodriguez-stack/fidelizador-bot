// CONFIGURACIÓN
const URL_SERVIDOR = "http://fidelizador.online";

const btnUnirte = document.getElementById('btnUnirte');
const listaSalas = document.getElementById('listaSalas');
const roomsContainer = document.getElementById('roomsContainer');
const statusMsg = document.getElementById('status');
const inputNumero = document.getElementById('miNumero');

// Cargar número guardado si existe
chrome.storage.local.get(['fid_num'], (data) => {
  if (data.fid_num) {
    inputNumero.value = data.fid_num;
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
    statusMsg.innerText = "Conectado. Obteniendo salas...";
    socket.emit('get_rooms');
  });

  socket.on('rooms_list', (rooms) => {
    mostrarSalas(rooms);
    statusMsg.innerText = "";
  });
  
  // Soporte para actualizaciones en tiempo real si el popup sigue abierto
  socket.on('rooms_update', (rooms) => {
    mostrarSalas(rooms);
  });

  socket.on('connect_error', () => {
    statusMsg.innerText = "Error de conexión.";
  });
}

function mostrarSalas(rooms) {
  listaSalas.style.display = 'block';
  roomsContainer.innerHTML = '';

  if (!rooms || rooms.length === 0) {
    roomsContainer.innerHTML = '<span style="font-size:0.8rem; color:#888">No hay salas disponibles. Contacta al admin.</span>';
    return;
  }

  rooms.forEach(room => {
    const btn = document.createElement('button');
    btn.style.width = "100%";
    btn.style.padding = "6px";
    btn.style.cursor = "pointer";
    btn.style.textAlign = "left";
    btn.innerText = `${room.name} (${room.count})`; // Nombre (Usuarios)

    btn.addEventListener('click', () => {
      guardarYSalir(room.name);
    });

    roomsContainer.appendChild(btn);
  });
}

function guardarYSalir(salaNombre) {
  const rawNumero = inputNumero.value;
  if (!rawNumero) return alert("Por favor ingresa tu número.");

  // Limpiar número (solo dígitos)
  const cleanNumero = rawNumero.replace(/\D/g, '');

  if (cleanNumero.length < 5) return alert("El número parece inválido.");

  chrome.storage.local.set({ 'fid_num': cleanNumero, 'fid_sala': salaNombre }, () => {
    alert(`Te has unido a la sala "${salaNombre}".\n\nVe a WhatsApp Web y presiona F5 para activar.`);
    window.close(); // Cerrar popup
  });
}

btnUnirte.addEventListener('click', () => {
  if (!inputNumero.value) return alert("Ingresa tu número primero.");
  conectarYListar();
});
