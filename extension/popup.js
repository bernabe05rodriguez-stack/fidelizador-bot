document.getElementById('btnGuardar').addEventListener('click', () => {
  const numero = document.getElementById('miNumero').value;
  const sala = document.getElementById('sala').value;
  
  if(!numero || !sala) return alert("Por favor completa ambos campos.");
  
  chrome.storage.local.set({ 'fid_num': numero, 'fid_sala': sala }, () => {
    alert('Datos guardados. Ahora ve a WhatsApp Web y presiona F5.');
  });
});