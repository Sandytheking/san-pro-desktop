const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')



// ✅ SQLite
const Database = require('better-sqlite3')

// ✅ Seguridad
const bcrypt = require('bcryptjs')

let db
let dbPath

// 🔥 DESACTIVAR AUTOFILL / PASSWORD MANAGER
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,PasswordManager')
app.commandLine.appendSwitch('disable-password-generation')

// ================================
// 🪟 Crear ventana principal
// ================================
function createWindow () {
  const win = new BrowserWindow({
    width: 1300,
    height: 950,
   webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  nodeIntegration: false,
  contextIsolation: true,

  // 🔒 SOLUCIÓN BUG INPUT / AUTOFILL
  autofill: false,
  spellcheck: false
}

  })

  win.loadFile('index.html')
  // win.webContents.openDevTools()
}

// ================================
// 💾 Backup automático
// ================================
function backupDatabase () {
  if (!dbPath) return

  const backupDir = path.join(app.getPath('documents'), 'San Pro Backups')

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true })
  }

  const date = new Date().toISOString().split('T')[0]
  const backupPath = path.join(backupDir, `sanpro_backup_${date}.db`)

  fs.copyFileSync(dbPath, backupPath)
  console.log('✅ Backup creado:', backupPath)
}

app.on('before-quit', () => {
  try {
    backupDatabase()
  } catch (e) {
    console.error('❌ Error en backup:', e)
  }
})

// ================================
// 🟦 Windows icon fix
// ================================
if (process.platform === 'win32') {
  app.setAppUserModelId('com.sandy.sanpro')
}

// ================================
// 🚀 App Ready
// ================================
app.whenReady().then(() => {
  const userDataPath = app.getPath('userData')
  dbPath = path.join(userDataPath, 'sanpro.db')

  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true })
  }

  // ✅ Abrir DB
  db = new Database(dbPath)
  console.log('✅ DB abierta en:', dbPath)

  // ✅ Inicializar tablas
  require('./db')(db)

  // =========================
  // 📡 IPC DB HANDLERS
  // =========================

  ipcMain.handle('db:run', (e, sql, params = []) => {
    const stmt = db.prepare(sql)
    const info = stmt.run(params)
    return {
      lastID: info.lastInsertRowid,
      changes: info.changes
    }
  })

  ipcMain.handle('db:all', (e, sql, params = []) => {
    return db.prepare(sql).all(params)
  })

  ipcMain.handle('db:get', (e, sql, params = []) => {
    return db.prepare(sql).get(params)
  })





  // =========================
  // 🔐 SEGURIDAD PIN
  // =========================

  ipcMain.handle('security:hasPin', () => {
    const row = db.prepare(`
      SELECT value FROM config WHERE key = 'pin_hash'
    `).get()
    return !!row
  })

  ipcMain.handle('security:setPin', (e, pin) => {
    const hash = bcrypt.hashSync(pin, 10)

    db.prepare(`
      INSERT OR REPLACE INTO config (key, value)
      VALUES ('pin_hash', ?)
    `).run(hash)

    return true
  })

  ipcMain.handle('security:checkPin', (e, pin) => {
    const row = db.prepare(`
      SELECT value FROM config WHERE key = 'pin_hash'
    `).get()

    if (!row) return false

    return bcrypt.compareSync(pin, row.value)
  })

  createWindow()
})



// =========================
// 🔐 HANDLERS DE LICENCIA
// =========================
const os = require('os');
const crypto = require('crypto');

function generarHardwareId() {
  const interfaces = os.networkInterfaces();
  let mac = '';

  // Buscar primera MAC válida
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.mac && !iface.internal && iface.mac !== '00:00:00:00:00:00') {
        mac = iface.mac;
        break;
      }
    }
    if (mac) break;
  }

  // Fallback robusto
  const fallback = [
    os.hostname() || 'unknown-host',
    os.userInfo().username || 'unknown-user',
    (os.cpus()[0]?.model || 'unknown-cpu').replace(/\s+/g, '')
  ].join('|');

  const data = mac || fallback;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
}

ipcMain.handle('license:getHardwareId', () => {
  return generarHardwareId();
});

// ================================
// ❌ Cerrar app
// ================================
app.on('window-all-closed', () => {
  if (db) {
    db.close()
    console.log('✅ DB cerrada correctamente')
  }

  if (process.platform !== 'darwin') app.quit()
})

// ================================
// 🍎 macOS
// ================================
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
