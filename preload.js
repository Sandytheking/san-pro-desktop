// preload.js - Versión corregida y segura para el error "object could not be cloned"
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('db', {
  run: (sql, params = []) => ipcRenderer.invoke('db:run', sql, params),
  all: (sql, params = []) => ipcRenderer.invoke('db:all', sql, params),
  get: (sql, params = []) => ipcRenderer.invoke('db:get', sql, params)
});

contextBridge.exposeInMainWorld('security', {
  hasPin: () => ipcRenderer.invoke('security:hasPin'),
  setPin: (pin) => ipcRenderer.invoke('security:setPin', pin),
  checkPin: (pin) => ipcRenderer.invoke('security:checkPin', pin)
});

// Licencia vía IPC - CORREGIDO: await dentro del preload
contextBridge.exposeInMainWorld('license', {
  getHardwareId: async () => {
    try {
      const result = await ipcRenderer.invoke('license:getHardwareId');
      // Devolvemos SOLO string puro (evita cualquier problema de clonación)
      return String(result || '');
    } catch (err) {
      console.error('Error obteniendo HWID desde preload:', err);
      return ''; // fallback seguro para que no rompa la app
    }
  }
});