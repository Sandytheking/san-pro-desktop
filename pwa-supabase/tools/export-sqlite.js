#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Uso: node pwa-supabase/tools/export-sqlite.js "C:\\ruta\\sanpro.db"');
  process.exit(1);
}

const resolved = path.resolve(dbPath);
if (!fs.existsSync(resolved)) {
  console.error(`No existe la base de datos: ${resolved}`);
  process.exit(1);
}

const db = new Database(resolved, { readonly: true });

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function tableExists(name) {
  return !!db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(name);
}

const clients = tableExists('clientes')
  ? db.prepare('select * from clientes').all().map(row => ({
      tipo: row.loan_type || row.tipo || 'san',
      nombre: row.nombre,
      telefono: row.telefono || '',
      cedula: row.cedula || '',
      cobrador: row.cobrador || 'N/A',
      monto: Number(row.monto || 0),
      interes: Number(row.interes || 0),
      semanas: Number(row.semanas || 1),
      cargo: Number(row.cargo || 0),
      fechaInicio: row.fechaInicio,
      total: Number(row.total || 0),
      balance: Number(row.balance || 0),
      cobrado: Number(row.cobrado || 0),
      calendario: parseJson(row.calendario, []),
      historial: parseJson(row.historial, [])
    }))
  : [];

const collectors = tableExists('cobradores')
  ? db.prepare('select * from cobradores').all().map(row => ({ name: row.nombre }))
  : [...new Set(clients.map(c => c.cobrador).filter(Boolean))].map(name => ({ name }));

const output = {
  exportedAt: new Date().toISOString(),
  source: resolved,
  clients,
  collectors
};

const outPath = path.join(process.cwd(), `sanpro-sqlite-export-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
db.close();

console.log(`Exportado correctamente: ${outPath}`);
console.log(`Clientes: ${clients.length}`);
console.log(`Cobradores: ${collectors.length}`);
