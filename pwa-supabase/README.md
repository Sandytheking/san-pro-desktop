# SAN PRO Cloud PWA

Version web/PWA de SAN PRO con Supabase.

## Probar local

```powershell
cd pwa-supabase
python -m http.server 4173
```

Abrir:

```text
http://localhost:4173
```

## Configurar Supabase

1. Crear un proyecto en Supabase.
2. Ejecutar `supabase-schema.sql` en SQL Editor.
3. En la pantalla inicial de la app, pegar:
   - Supabase URL
   - Supabase anon key

La app guarda esos datos en `localStorage`. `config.js` queda con valores placeholder para no subir credenciales al repo.

## Deploy en Vercel

Al importar el repositorio en Vercel:

- Framework Preset: `Other`
- Root Directory: `pwa-supabase`
- Build Command: dejar vacio
- Output Directory: dejar vacio

Luego abrir el dominio generado por Vercel.

## Migrar desde SQLite

```powershell
node pwa-supabase/tools/export-sqlite.js "C:\ruta\sanpro.db"
```

Importar el JSON generado desde la pestaña `Migracion`.
