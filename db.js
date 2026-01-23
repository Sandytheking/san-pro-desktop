// db.js (o como lo hayas llamado)
module.exports = (db) => {
  try {
    // =========================
    // TABLA CLIENTES
    // =========================
    db.prepare(`
      CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        cedula TEXT,
        cobrador TEXT NOT NULL,
        monto REAL NOT NULL,
        interes REAL NOT NULL,
        semanas INTEGER NOT NULL,
        cargo REAL DEFAULT 0,
        fechaInicio TEXT NOT NULL,
        total REAL NOT NULL,
        balance REAL NOT NULL,
        cobrado REAL DEFAULT 0,
        calendario TEXT NOT NULL,
        historial TEXT NOT NULL
      )
    `).run();
    console.log('✅ Tabla clientes lista');

    // =========================
    // TABLA FACTURAS
    // =========================
    db.prepare(`
      CREATE TABLE IF NOT EXISTS facturas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero TEXT UNIQUE NOT NULL,
        fecha TEXT NOT NULL,
        cliente_id INTEGER NOT NULL,
        monto REAL NOT NULL,
        balance_anterior REAL NOT NULL,
        FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE
      )
    `).run();
    console.log('✅ Tabla facturas lista');

    // =========================
    // TABLA CONFIG (PIN / AJUSTES)
    // =========================
    db.prepare(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `).run();
    console.log('✅ Tabla config lista');


    db.prepare(`
      CREATE TABLE IF NOT EXISTS cobradores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE
);

    `).run();
    console.log('✅ Cobradores');

    // =========================
    // TABLA LICENSE (LICENCIAS)
    // =========================
    db.prepare(`
CREATE TABLE IF NOT EXISTS license (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hardware_id     TEXT NOT NULL UNIQUE,
  license_key     TEXT,
  valid_until     TEXT NOT NULL,           -- YYYY-MM-DD
  status          TEXT NOT NULL DEFAULT 'trial',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT,                     -- opcional: fecha última actualización
  notes           TEXT                      -- opcional: para poner nombre del cliente, etc.

      )
    `).run();
    console.log('✅ Tabla license lista');

  } catch (err) {
    console.error('❌ Error inicializando la base de datos:', err);
  }
};

