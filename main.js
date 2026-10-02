const path = require('path');
const { app, BrowserWindow, globalShortcut } = require('electron');

const PORT = process.env.PORT || '3000';
process.env.PORT = PORT;
process.env.DATA_DIR = process.env.DATA_DIR || path.join(app.getPath('userData'), 'data');
process.env.DESKTOP_DIR = process.env.DESKTOP_DIR || app.getPath('desktop');

require('./server.js');

let ventanaPrincipal = null;

function crearVentana() {
  ventanaPrincipal = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    backgroundColor: '#0b1220',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ventanaPrincipal.loadURL(`http://localhost:${PORT}/marcador.html`);

  ventanaPrincipal.on('closed', () => {
    ventanaPrincipal = null;
  });
}

app.whenReady().then(() => {
  crearVentana();

  // Salir del modo kiosco: Esc cierra la aplicacion.
  globalShortcut.register('Esc', () => {
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    crearVentana();
  }
});
