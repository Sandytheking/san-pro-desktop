// renderer.js - Versión final corregida con paginación y filtros avanzados
// Fixes completos:
// - Sin duplicados: 'cargarClientes', 'currentPage', etc. declarados una vez (scope local en initApp).
// - Integré paginación/filtros en 'actualizar()' completo y limpio.
// - Variables de paginación como let en initApp (no window, para evitar global pollution).
// - toast global para usarlo en guardarPin.
// - poblarCobradores y limpiarFiltros funcionales, llamados correctamente.
// - Listeners para filtros agregados una vez después de tabs, con checks.
// - Prueba: Reinicia, ve a Clientes – filtra por estado, paginación se activa con +10 clientes.

const byId = id => document.getElementById(id)
const qs = sel => document.querySelector(sel)
const qsa = sel => document.querySelectorAll(sel)

// Toast global (para usarlo antes de initApp)
const toast = (msg, ok = true) => {
  const t = byId('toast')
  if (!t) return console.warn('Toast element not found');
  t.textContent = msg
  t.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-2xl ${ok ? 'bg-green-600' : 'bg-red-600'} text-white`
  t.classList.remove('hidden')
  setTimeout(() => t.classList.add('hidden'), 3000)
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, checking PIN...');
  const hasPin = await window.security.hasPin()
  byId('app').style.display = 'none'
  if (!hasPin) {
    mostrarCrearPin()
  } else {
    mostrarPedirPin()
  }
})

function mostrarCrearPin() {
  console.log('Showing create PIN modal');
  const modal = byId('pin-modal')
  modal.style.display = 'flex'
  modal.innerHTML = `
    <div class="pin-modal-header">
      <h1 class="text-2xl font-bold text-slate-100">SAN PRO + Facturación</h1>
    </div>
    <div class="pin-box">
      <h2>Crear PIN</h2>
      <input id="pin1" type="password" placeholder="Nuevo PIN" minlength="10" />
      <button id="guardarPin">Guardar</button>
    </div>
  `
  byId('guardarPin').addEventListener('click', guardarPin)
}

async function guardarPin() {
  console.log('Guardando PIN...');
  const pin = byId('pin1').value
  if (pin.length < 6) {
    alert('El PIN debe tener al menos 6 dígitos')
    return
  }
  try {
    await window.security.setPin(pin)
    toast('PIN creado exitosamente', true)
    location.reload()
  } catch (err) {
    console.error('Error guardando PIN:', err);
    alert('Error al crear PIN. Intenta de nuevo.')
  }
}

function mostrarPedirPin() {
  console.log('Showing enter PIN modal');
  const modal = byId('pin-modal');
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="pin-modal-header">
      <h1 class="text-2xl font-bold text-slate-100">SAN PRO + Facturación</h1>
    </div>
    <div class="pin-box">
      <h2>Ingrese PIN</h2>
      <input id="pin" type="password" placeholder="PIN" minlength="6" autofocus />
      <button id="verificarPin">Entrar</button>
    </div>
  `;

  const pinInput = byId('pin');
  pinInput.focus(); // Enfoca automáticamente

  byId('verificarPin').addEventListener('click', verificarPin);
  pinInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') verificarPin();
  });
}



async function verificarPin() {
  console.log('Verifying PIN...');
  const pinInput = byId('pin');
  const pin = pinInput.value.trim();

  if (pin.length < 6) {
    toast('El PIN debe tener al menos 6 dígitos', false);
    pinInput.focus();
    pinInput.select(); // Selecciona todo el texto para reescribir rápido
    return;
  }

  try {
    const ok = await window.security.checkPin(pin);
    if (ok) {
      console.log('PIN OK, showing app and init');
      const modal = byId('pin-modal');
      modal.style.display = 'none';
      modal.innerHTML = '';
      byId('app').style.display = 'block';
      initApp();
    } else {
      toast('PIN incorrecto', false);
      pinInput.value = '';           // Limpia el input
      pinInput.focus();              // Enfoca de nuevo
      pinInput.select();             // Selecciona para que pueda escribir inmediatamente
    }
  } catch (err) {
    console.error('Error verificando PIN:', err);
    toast('Error al verificar PIN. Intenta de nuevo.', false);
    pinInput.focus();
    pinInput.select();
  }
}

function crearInputPin() {
  const container = byId('pin-container')

  container.innerHTML = `
    <input
      id="pin"
      type="password"
      inputmode="numeric"
      placeholder="PIN"
      minlength="6"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
    />
  `

  const input = byId('pin')

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') verificarPin()
  })

  // 🔥 foco REAL en Chromium
  requestAnimationFrame(() => {
    requestAnimationFrame(() => input.focus())
  })
}


async function cargarCobradores() {
  try {
    const cobradores = await window.db.all(
      'SELECT * FROM cobradores ORDER BY nombre'
    );

    // 1. Tags en pestaña Cobradores
    const cont = byId('tags-cobradores');
    if (cont) {
      cont.innerHTML = '';
      cobradores.forEach(c => {
        const tag = document.createElement('div');
        tag.className = 'flex items-center gap-2 bg-indigo-600/80 px-3 py-1 rounded-full text-sm text-white';
        tag.innerHTML = `
          <span>${c.nombre}</span>
          <button onclick="eliminarCobrador(${c.id})" class="text-white/80 hover:text-white">✕</button>
        `;
        cont.appendChild(tag);
      });
    }

    // 2. Select en pestaña Nuevo Préstamo
    const selectNuevo = byId('n_cobrador');
    if (selectNuevo) {
      selectNuevo.innerHTML = '<option value="">Selecciona cobrador...</option>';
      cobradores.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.nombre;
        opt.textContent = c.nombre;
        selectNuevo.appendChild(opt);
      });
    }

    // 3. Filtro en pestaña Clientes (¡esto faltaba!)
    const filtroCobrador = byId('filtro-cobrador');
    if (filtroCobrador) {
      filtroCobrador.innerHTML = '<option value="">Todos los cobradores</option>';
      cobradores.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.nombre;
        opt.textContent = c.nombre;
        filtroCobrador.appendChild(opt);
      });
    }

    console.log(`Cargados ${cobradores.length} cobradores`);
  } catch (err) {
    console.error('Error cargando cobradores:', err);
    toast('Error al cargar cobradores', false);
  }
}


async function eliminarCobrador(id) {
  if (!(await confirmar('¿Eliminar cobrador?'))) return

  await window.db.run(
    'DELETE FROM cobradores WHERE id = ?',
    [id]
  )

  cargarCobradores()
}



// ----------------------
// VERIFICACIÓN DE LICENCIA
// ----------------------
const LICENSE_MODAL = 'license-modal';

async function verificarLicencia() {
  try {
    console.log('Obteniendo HWID...');
    const hwid = await window.license.getHardwareId();
    console.log('HWID obtenido:', hwid);

    let licencia = await window.db.get(
      'SELECT * FROM license WHERE hardware_id = ?',
      [hwid]
    );

    const hoy = dayjs();
    console.log('Fecha actual (dayjs):', hoy.format('YYYY-MM-DD'));

    if (!licencia) {
      const trialHasta = hoy.add(30, 'day').format('YYYY-MM-DD');
      console.log('Creando nuevo trial hasta:', trialHasta);

      await window.db.run(
        `INSERT INTO license (hardware_id, valid_until, status) VALUES (?, ?, 'trial')`,
        [hwid, trialHasta]
      );

      mostrarTrialActivo(trialHasta);
      console.log('Trial creado → licencia válida');
      return true;
    }

    console.log('Licencia existente encontrada. Status:', licencia.status);
    console.log('Valid until:', licencia.valid_until);

    const vencimiento = dayjs(licencia.valid_until).endOf('day'); // Hasta el final del día
    console.log('Comparando: hoy', hoy.format('YYYY-MM-DD'), 'vs vencimiento', vencimiento.format('YYYY-MM-DD'));

    if (hoy.isAfter(vencimiento)) {
      console.log('Licencia vencida');
      mostrarLicenciaExpirada();
      return false;
    }

    // Licencia vigente
    if (licencia.status === 'trial') {
      mostrarTrialActivo(licencia.valid_until);
    } else {
      console.log('Licencia activa (no trial)');
    }

    console.log('Licencia válida → continuar');
    return true;

  } catch (err) {
    console.error('Error en verificarLicencia:', err);
    toast('Error verificando licencia. Contacta al desarrollador.', false);
    return false;
  }
}

// ----------------------
// FUNCIONES DE UI
// ----------------------
function mostrarTrialActivo(fechaVencimiento) {
  const diasRestantes = dayjs(fechaVencimiento).diff(dayjs(), 'day');
  toast(
    `Modo prueba activo - Quedan ${diasRestantes} días. Contacta al desarrollador para la licencia completa.`,
    true
  );
}

function mostrarLicenciaExpirada() {
  const modal = document.getElementById(LICENSE_MODAL);
  if (!modal) {
    alert('Licencia expirada. Contacta al desarrollador para renovar.');
    return;
  }

  // Llenar el HWID automáticamente
  window.license.getHardwareId().then(hwid => {
    document.getElementById('hwid-display').textContent = hwid;
  }).catch(err => {
    document.getElementById('hwid-display').textContent = 'Error al cargar ID';
    console.error(err);
  });

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

// Verificar si ya aceptó términos
function haAceptadoTerminos() {
  return localStorage.getItem('terminos_aceptados') === 'true';
}

// Aceptar términos
function aceptarTerminos() {
  localStorage.setItem('terminos_aceptados', 'true');
  localStorage.setItem('terminos_fecha', new Date().toISOString());

  document.getElementById('terms-modal').classList.add('hidden');
  // Continuar mostrando la app o el modal de PIN
  const pinModal = document.getElementById('pin-modal');
  if (pinModal) pinModal.style.display = 'flex';
}

// Rechazar términos (cierra o alerta)
function rechazarTerminos() {
  alert('Debe aceptar los Términos y Condiciones para usar SAN PRO.');
  // Opcional: window.close() o location.href = 'about:blank'
}

// Mostrar modal de términos al inicio (si no aceptó)
document.addEventListener('DOMContentLoaded', async () => {
  // ... tu código actual de PIN ...

  if (!haAceptadoTerminos()) {
    document.getElementById('terms-modal').classList.remove('hidden');
    // Ocultar app y otros modales hasta aceptar
    byId('app').style.display = 'none';
  } else {
    // Continuar con PIN
    const hasPin = await window.security.hasPin();
    if (!hasPin) {
      mostrarCrearPin();
    } else {
      mostrarPedirPin();
    }
  }

  // Listener del botón Aceptar
  const btnAceptar = document.getElementById('btn-aceptar-terminos');
  if (btnAceptar) {
    btnAceptar.addEventListener('click', aceptarTerminos);
  }
});


// ----------------------
// DONACIONES (MODAL MENSUAL)
// ----------------------

function abrirDonacion() {
  const modal = document.getElementById('donation-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function cerrarDonacion() {
  const modal = document.getElementById('donation-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

// Mostrar modal de donación 1 vez cada 30 días
document.addEventListener('DOMContentLoaded', () => {
  const LAST_KEY = 'donacion_ultima';
  const TREINTA_DIAS = 30 * 24 * 60 * 60 * 1000;

  const ultima = localStorage.getItem(LAST_KEY);
  const ahora = Date.now();

  if (!ultima || ahora - Number(ultima) > TREINTA_DIAS) {
    localStorage.setItem(LAST_KEY, ahora);

    // Espera 4 segundos para no ser invasivo
    setTimeout(() => {
      abrirDonacion();
    }, 4000);
  }
});


// ----------------------
// ACTIVACIÓN DE LICENCIA
// ----------------------
window.activarLicencia = async function () {
  const input = document.getElementById('license-key-input');
  const key = input?.value?.trim();

  if (!key || key.length < 20) {
    toast('Clave inválida o incompleta', false);
    return;
  }

const hwidActual = await window.license.getHardwareId();

  // Separa primero el código del resto
const primeraParte = key.indexOf('-');
if (primeraParte === -1) {
  toast('Formato inválido: falta guion', false);
  return;
}

const codigo = key.substring(0, primeraParte);
const resto = key.substring(primeraParte + 1);

// Ahora separa el resto en fecha y hwid (últimos 8 caracteres)
const hwidParcial = resto.slice(-8); // últimos 8 caracteres
const fechaStr = resto.slice(0, -9); // todo menos los últimos 9 (guion + 8)

if (!fechaStr.includes('-')) {
  toast('Formato de fecha inválido en la clave', false);
  return;
}

// Validaciones
if (hwidActual.slice(0, 8) !== hwidParcial) {
  toast('Esta clave no corresponde a este equipo', false);
  return;
}

  if (!dayjs(fechaStr, 'YYYY-MM-DD', true).isValid()) {
    toast('Fecha de vencimiento inválida en la clave', false);
    return;
  }

  const nuevaFecha = dayjs(fechaStr);
  if (nuevaFecha.isBefore(dayjs())) {
    toast('La licencia ya está vencida', false);
    return;
  }

  // Guardar la activación
  await window.db.run(
    `UPDATE license 
     SET license_key = ?, valid_until = ?, status = 'active'
     WHERE hardware_id = ?`,
    [key, fechaStr, hwidActual]
  );

  toast('¡Licencia activada con éxito! Gracias por confiar en SAN PRO+', true);
  
  // Ocultar modal
  document.getElementById(LICENSE_MODAL)?.classList.add('hidden');
  
  // Recomendado: recargar para aplicar cambios en toda la app
  setTimeout(() => location.reload(), 1500);
}

// ================================
// 🔐 Confirmación NO bloqueante (Electron safe)
// ================================
function confirmar(texto = '¿Confirmar acción?') {
  return new Promise(resolve => {
    const modal = byId('confirm-modal')
    const msg = byId('confirm-text')
    const okBtn = byId('confirm-ok')
    const cancelBtn = byId('confirm-cancel')

    msg.textContent = texto
    modal.classList.remove('hidden')

    const cerrar = (res) => {
      modal.classList.add('hidden')
      okBtn.onclick = null
      cancelBtn.onclick = null
      resolve(res)
      liberarFoco()
    }

    okBtn.onclick = () => cerrar(true)
    cancelBtn.onclick = () => cerrar(false)
  })
}

// ================================
// 🔥 Liberar foco (CRÍTICO en Electron)
// ================================
function liberarFoco() {
  if (document.activeElement) {
    document.activeElement.blur()
  }
  document.body.focus()
}



// ----------------------
// INTEGRACIÓN EN EL FLUJO PRINCIPAL - ÚNICA initApp
// ----------------------
async function initApp() {
  console.log('initApp started');

  // Verificación de licencia (ya funciona, no tocar)
  const licenciaValida = await verificarLicencia();
  if (!licenciaValida) {
    console.log('Licencia no válida → esperando activación');
    return;
  }
  console.log('Licencia válida, continuando con la aplicación...');

  if (!window.dayjs) {
    alert('Error crítico: dayjs no cargado');
    return;
  }

  const state = {
    clientes: [],
    ultimaFactura: null
  };


  let currentPage = 1;
  let itemsPerPage = 10;
  let totalPages = 1;

  // Auto-reload...
  let lastAction = Date.now();
  const activityEvents = ['click', 'mousemove', 'keydown'];
  activityEvents.forEach(event => {
    document.addEventListener(event, () => lastAction = Date.now());
  });
  setInterval(() => {
    if (Date.now() - lastAction > 10 * 60 * 1000) location.reload();
  }, 60_000);

  // ¡Mueve estas dos funciones AQUÍ, antes de cargarClientes!
  const money = n => '$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const estado = c => {
    if (c.balance <= 0) return { txt: 'PAGADO', col: 'text-gray-400', prox: '-' };
    const hoy = dayjs();
    const inicio = dayjs(c.fechaInicio);
    const primeraCuota = inicio.add(7, 'day');
    const semanasTranscurridas = Math.floor(hoy.diff(primeraCuota, 'week'));
    const cuotasEsperadas = Math.max(0, semanasTranscurridas + 1);
    const cuotasPagadas = c.calendario.filter(s => s.pagado >= s.cuota).length;
    const atraso = cuotasEsperadas - cuotasPagadas;
    const proximaSemana = cuotasPagadas;
    const proximaFecha = inicio.add(7 + proximaSemana * 7, 'day').format('DD/MM/YYYY');
    if (atraso > 1) return { txt: 'MOROSO', col: 'text-red-400', prox: proximaFecha };
    if (hoy.isBefore(primeraCuota)) return { txt: 'AL DÍA', col: 'text-green-400', prox: primeraCuota.format('DD/MM/YYYY') };
    return { txt: 'AL DÍA', col: 'text-green-400', prox: proximaFecha };
  };

  // Ahora sí: cargarClientes puede usar estado y money
  const cargarClientes = async () => {
    console.log('Loading clientes...');
    try {
      const rows = await window.db.all('SELECT * FROM clientes');
      state.clientes = rows.map(c => ({
        ...c,
        calendario: JSON.parse(c.calendario || '[]'),
        historial: JSON.parse(c.historial || '[]')
      }));
      console.log(`Loaded ${state.clientes.length} clientes`);
      poblarCobradores();
      actualizar();
    } catch (err) {
      console.error('Error in cargarClientes:', err);
      toast('Error cargando datos: ' + err.message, false);
    }
  };

  const actualizar = () => {
    console.log('Updating UI...');
    const fechaEl = byId('fechaActual')
    if (fechaEl) fechaEl.textContent = dayjs().format('DD/MM/YYYY')
    let prestado = 0, cobrado = 0, balance = 0, morosos = 0
    state.clientes.forEach(c => {
      prestado += c.monto
      cobrado += c.cobrado
      balance += c.balance
      if (estado(c).txt === 'MOROSO') morosos++
    })
    const els = {
      d_prestado: money(prestado),
      d_cobrado: money(cobrado),
      d_balance: money(balance),
      d_clientes: state.clientes.length,
      d_morosos: morosos
    }
    Object.entries(els).forEach(([id, val]) => {
      const el = byId(id)
      if (el) el.textContent = val
    })

    // Filtros avanzados
    const q = byId('buscar')?.value.toLowerCase() || ''
    const estadoFiltro = byId('filtro-estado')?.value || ''
    const cobradorFiltro = byId('filtro-cobrador')?.value || ''
    const fechaDesde = byId('filtro-fecha-desde')?.value ? dayjs(byId('filtro-fecha-desde').value).startOf('day') : null
    const fechaHasta = byId('filtro-fecha-hasta')?.value ? dayjs(byId('filtro-fecha-hasta').value).endOf('day') : null

    // Filtrar con avanzados
    let filtrados = state.clientes.filter(c => {
      const matchesSearch = 
        c.nombre.toLowerCase().includes(q) ||
        (c.cedula || '').toLowerCase().includes(q) ||
        c.cobrador.toLowerCase().includes(q);
      
      const matchesEstado = !estadoFiltro || estado(c).txt === estadoFiltro
      const matchesCobrador = !cobradorFiltro || c.cobrador === cobradorFiltro
      const matchesFecha = (!fechaDesde || dayjs(c.fechaInicio) >= fechaDesde) &&
                           (!fechaHasta || dayjs(c.fechaInicio) <= fechaHasta)
      
      return matchesSearch && matchesEstado && matchesCobrador && matchesFecha
    })

    // Paginación
    totalPages = Math.ceil(filtrados.length / itemsPerPage)
    currentPage = Math.min(currentPage, totalPages) || 1
    const startIdx = (currentPage - 1) * itemsPerPage
    const endIdx = startIdx + itemsPerPage
    const paginados = filtrados.slice(startIdx, endIdx)

    // Info de página
    const infoPagina = byId('info-pagina')
    if (infoPagina) infoPagina.textContent = `Mostrando ${startIdx + 1}-${Math.min(endIdx, filtrados.length)} de ${filtrados.length} clientes`
    const paginacion = byId('paginacion')
    if (paginacion) paginacion.classList.toggle('hidden', filtrados.length <= itemsPerPage)

    // Números de página
    let paginaHtml = ''
    const maxVisible = 5
    const startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2))
    const endPage = Math.min(totalPages, startPage + maxVisible - 1)
    for (let i = startPage; i <= endPage; i++) {
      paginaHtml += `<button class="px-2 py-1 bg-slate-700 rounded hover:bg-slate-600 ${i === currentPage ? 'bg-indigo-600' : ''}" onclick="setPage(${i})">${i}</button>`
    }
    const numerosPagina = byId('numeros-pagina')
    if (numerosPagina) numerosPagina.innerHTML = paginaHtml


    // Actualizar botones paginación
    const prevPageBtn = byId('prev-page')
    const nextPageBtn = byId('next-page')
    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages

    const tbody = byId('tbody')
    if (!tbody) return console.error('tbody not found')
    // 5. innerHTML optimizado: Acumular en string
    let html = ''
    paginados.forEach((c, idx) => { // 👈 Usa paginados
      const e = estado(c)
      const globalIdx = state.clientes.indexOf(c)
      // 2. Evitar onclick: Usar data-i y classes para delegation
      html += `<tr class="border-b border-slate-800 hover:bg-slate-800/50">
        <td class="p-3">${startIdx + idx + 1}</td> 
        <td class="p-3 font-medium">${c.nombre}</td>
        <td class="p-3">${c.cedula || '-'}</td>
        <td class="p-3">${c.cobrador}</td>
        <td class="p-3">${money(c.monto)}</td>
        <td class="p-3">${money(c.balance)}</td>
        <td class="p-3 text-sm">${e.prox}</td>
        <td class="p-3 ${e.col} font-bold">${e.txt}</td>
        <td class="p-3 flex gap-3">
          <button class="btn-ver text-indigo-400 hover:underline" data-i="${globalIdx}">Tarjeta</button>
          <button class="btn-elim text-red-400 hover:underline" data-i="${globalIdx}">Eliminar</button>
        </td>
      </tr>`
    })
    tbody.innerHTML = html

    const sel = byId('c_cliente')
    if (sel) {
      sel.innerHTML = '<option value="">Seleccionar cliente...</option>'
      state.clientes.forEach((c, i) => { // Seguro aquí
        const e = estado(c)
        sel.innerHTML += `<option value="${i}">${c.nombre} (${money(c.balance)} - ${e.prox})</option>`
      })
    }
  }

  const preview = () => {
    console.log('Preview called - reading inputs...');
    const m = +byId('n_monto')?.value || 0
    const i = +byId('n_interes')?.value || 0
    const s = +byId('n_semanas')?.value || 1
    const c = +byId('n_cargo')?.value || 0
    console.log('Values:', { m, i, s, c });
    const total = m * (1 + i / 100)
    const interesGanado = total - m
    const gananciaTotal = interesGanado + c
    const els = {
      calc_total: money(total),
      calc_cuota: money(total / s),
      calc_entregado: money(m - c),
      calc_ganancia: money(gananciaTotal)
    }
    console.log('Calc values:', els);
    Object.entries(els).forEach(([id, val]) => {
      const el = byId(id)
      if (el) {
        el.textContent = val
        console.log(`Updated ${id}: ${val}`);
      } else {
        console.warn(`Element ${id} not found`);
      }
    })
  }

  const crear = async () => {
  try {
    // 🔎 Validaciones básicas
    if (!byId('n_nombre')?.value || !byId('n_monto')?.value) {
      toast('Faltan datos obligatorios', false)
      return
    }

    // ✅ Confirmación NO bloqueante (Electron-safe)
    const ok = await confirmar('¿Confirmar creación del préstamo?')
    if (!ok) return

    const fechaInicio = byId('n_fecha')?.value || dayjs().format('YYYY-MM-DD')

    const cli = {
      nombre: byId('n_nombre').value.trim(),
      cedula: byId('n_cedula')?.value.trim() || null,
      cobrador: byId('n_cobrador')?.value || null,
      monto: +byId('n_monto').value,
      interes: +byId('n_interes').value,
      semanas: +byId('n_semanas').value,
      cargo: +byId('n_cargo').value || 0,
      fechaInicio,
      total: 0,
      balance: 0,
      cobrado: 0,
      calendario: [],
      historial: []
    }

    // 🧮 Cálculos
    cli.total = cli.monto * (1 + cli.interes / 100)
    cli.balance = cli.total

    const cuota = cli.total / cli.semanas
    for (let w = 0; w < cli.semanas; w++) {
      cli.calendario.push({ cuota, pagado: 0 })
    }

    // 💾 Guardar en DB
    const result = await window.db.run(
      `INSERT INTO clientes 
       (nombre, cedula, cobrador, monto, interes, semanas, cargo, fechaInicio, total, balance, cobrado, calendario, historial)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cli.nombre,
        cli.cedula,
        cli.cobrador,
        cli.monto,
        cli.interes,
        cli.semanas,
        cli.cargo,
        cli.fechaInicio,
        cli.total,
        cli.balance,
        cli.cobrado,
        JSON.stringify(cli.calendario),
        JSON.stringify(cli.historial)
      ]
    )

    cli.id = result.lastID
    state.clientes.push(cli)

    // 🔄 UI updates
    poblarCobradores()
    actualizar()

    toast('Préstamo creado correctamente', true)

    // 🧹 Reset formulario
    qsa('#nuevo input:not([type=date])').forEach(el => (el.value = ''))
    byId('n_fecha').value = fechaInicio

    preview()

    if (byId('buscar')?.value) {
      byId('buscar').value = ''
      actualizar()
    }

    // 🔥 CLAVE: liberar foco (Electron)
    setTimeout(liberarFoco, 0)

  } catch (err) {
    console.error('Error in crear:', err)
    toast('Error al guardar: ' + err.message, false)
    setTimeout(liberarFoco, 0)
  }
}


  const imprimirFacturaHTML = (cliente, montoPagado, balanceAnterior, numFactura, fecha, hora) => {
    const v = window.open('', '_blank')
    const dispFecha = fecha || dayjs().format('DD/MM/YYYY')
    const dispHora = hora || dayjs().format('hh:mm A')
    v.document.write(`
      <!DOCTYPE html>
      <html><head><title>${numFactura}</title>
      <style>body { font-family: Arial; padding: 40px; background: white; color: black; } table { width: 100%; border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 10px; } th { background: #f0f0f0; }</style>
      </head><body>
        <h1 style="text-align: center;">RECIBO DE PAGO - SAN PRO</h1>
        <p><strong>Factura:</strong> ${numFactura}</p>
        <p><strong>Fecha:</strong> ${dispFecha} ${dispHora}</p>
        <p><strong>Cliente:</strong> ${cliente.nombre} ${cliente.cedula ? `(${cliente.cedula})` : ''}</p>
        <p><strong>Cobrador:</strong> ${cliente.cobrador}</p>
        <table>
          <tr><th>Concepto</th><th>Monto</th></tr>
          <tr><td>Pago recibido</td><td>${money(montoPagado)}</td></tr>
          <tr><td>Balance anterior</td><td>${money(balanceAnterior)}</td></tr>
          <tr><td><strong>Balance actual</strong></td><td><strong>${money(cliente.balance)}</strong></td></tr>
        </table>
        <div style="font-size: 1.5em; font-weight: bold; text-align: right; margin-top: 20px;">Total Pagado: ${money(montoPagado)}</div>
        <p style="text-align: center; margin-top: 40px; font-size: 0.9em; color: #555;">¡Gracias por su pago! - Santiago de los Caballeros</p>
      </body></html>
    `)
    v.document.close()
    v.focus()
    setTimeout(() => v.print(), 500)
  }

  const generarFactura = async (cliente, montoPagado) => {
    try {
      const row = await window.db.get('SELECT COUNT(*) as total FROM facturas')
      const numFactura = 'FACT-' + String((row.total || 0) + 1).padStart(4, '0')
      const fechaDB = dayjs().format('YYYY-MM-DD HH:mm:ss')
      const fechaDisp = dayjs().format('DD/MM/YYYY')
      const hora = dayjs().format('hh:mm A')
      const balanceAnterior = cliente.balance + montoPagado
      state.ultimaFactura = { numFactura, cliente, montoPagado, balanceAnterior, fecha: fechaDisp, hora }
      await window.db.run(
        'INSERT INTO facturas (numero, fecha, cliente_id, monto, balance_anterior) VALUES (?, ?, ?, ?, ?)',
        [numFactura, fechaDB, cliente.id, montoPagado, balanceAnterior]
      )
      imprimirFacturaHTML(cliente, montoPagado, balanceAnterior, numFactura, fechaDisp, hora)
    } catch (err) {
      console.error('Error in generarFactura:', err);
      toast('Error generando factura', false)
    }
  }

  const imprimirUltimaFactura = () => {
    if (!state.ultimaFactura) return toast('No hay factura reciente', false)
    imprimirFacturaHTML(
      state.ultimaFactura.cliente,
      state.ultimaFactura.montoPagado,
      state.ultimaFactura.balanceAnterior,
      state.ultimaFactura.numFactura,
      state.ultimaFactura.fecha,
      state.ultimaFactura.hora
    )
    toast('Reimprimiendo última factura...')
  }

const pagar = async () => {
  const clienteSelect = byId('c_cliente');
  const montoInput = byId('c_monto');
  const i = parseInt(clienteSelect?.value);
  const m = +montoInput?.value || 0;

  if (!state.clientes[i] || m <= 0) {
    toast('Selecciona un cliente y monto válido', false);
    montoInput.focus();
    montoInput.select();
    return;
  }

  const c = { ...state.clientes[i] };

  // Validación 1: ya pagado completamente
  if (c.balance <= 0) {
    toast('Este cliente ya pagó todo su préstamo. No se pueden registrar más pagos.', false);
    montoInput.focus();
    montoInput.select();
    return;
  }

  // Validación 2: no permitir sobrepago (monto > balance)
  if (m > c.balance) {
    toast(`El monto (${money(m)}) es mayor al balance pendiente (${money(c.balance)}). Ajusta el monto.`, false);
    montoInput.focus();
    montoInput.select();
    return;
  }

  if (!confirm(`¿Registrar pago de ${money(m)}?`)) {
    montoInput.focus();
    montoInput.select();
    return;
  }

  // Proceder con el pago
  c.historial.push({ fecha: dayjs().format('YYYY-MM-DD'), monto: m });
  c.cobrado += m;
  c.balance = Math.max(0, c.balance - m);
  let resto = m;
  for (const s of c.calendario) {
    if (resto <= 0) break;
    const falta = s.cuota - s.pagado;
    if (falta > 0) {
      const usar = Math.min(falta, resto);
      s.pagado += usar;
      resto -= usar;
    }
  }

  try {
    await window.db.run(
      'UPDATE clientes SET balance = ?, cobrado = ?, calendario = ?, historial = ? WHERE id = ?',
      [c.balance, c.cobrado, JSON.stringify(c.calendario), JSON.stringify(c.historial), c.id]
    );
    state.clientes[i] = c;
    await generarFactura(c, m);
    actualizar();

    // Limpieza y foco para siguiente pago
    montoInput.value = '';
    montoInput.focus();
    montoInput.select();
    toast('Pago registrado y factura generada', true);

  } catch (err) {
    console.error('Error in pagar:', err);
    toast('Error al registrar pago. Intenta de nuevo.', false);
    montoInput.focus();
    montoInput.select();
  }
};

  const ver = i => {
    console.log(`ver called with index ${i}`);
    const c = state.clientes[i]
    if (!c) return toast('Cliente no encontrado', false)
    byId('modalTitle').textContent = `${c.nombre} ${c.cedula ? '- ' + c.cedula : ''}`
    const cal = byId('calendario'), hist = byId('historialPagos')
    cal.innerHTML = ''; hist.innerHTML = ''
    const inicio = dayjs(c.fechaInicio)
    c.calendario.forEach((s, j) => {
      const fechaVenc = inicio.add(7 + j * 7, 'day').format('DD/MM/YYYY')
      const ok = s.pagado >= s.cuota
      cal.innerHTML += `<div class="bg-slate-800 rounded-lg p-4 ${ok ? 'ring-2 ring-green-500' : ''}">
        <div class="font-bold text-lg">Semana ${j + 1}</div>
        <div class="text-sm text-slate-400">Vence: ${fechaVenc}</div>
        <div class="mt-2">Cuota: ${money(s.cuota)}</div>
        <div>Pagado: ${money(s.pagado)}</div>
        <div class="mt-2 text-sm font-bold ${ok ? 'text-green-400' : 'text-orange-400'}">${ok ? 'PAGADA' : 'PENDIENTE'}</div>
      </div>`
    })
    if (c.historial.length) {
      c.historial.slice().reverse().forEach(p => {
        const pFecha = dayjs(p.fecha).format('DD/MM/YYYY')
        hist.innerHTML += `<div class="bg-slate-800/50 p-3 rounded flex justify-between">
          <span>${pFecha}</span>
          <span class="text-green-400 font-bold">${money(p.monto)}</span>
        </div>`
      })
    } else hist.innerHTML = '<p class="text-slate-500">Sin pagos registrados</p>'
    const modal = byId('modal')
    if (modal) {
      modal.classList.add('flex')
      modal.classList.remove('hidden')
    }
  }

  const cerrarModal = () => {
    const modal = byId('modal')
    if (modal) modal.classList.replace('flex', 'hidden')
  }

  const elim = async (i) => {
    console.log(`elim called with index ${i}`);
    const c = state.clientes[i]
    if (!c) return toast('Cliente no encontrado', false)
    if (!(await confirmar('¿Eliminar permanentemente este cliente?'))) return
    try {
      await window.db.run('DELETE FROM clientes WHERE id = ?', [c.id])
      state.clientes.splice(i, 1)
      actualizar()
      toast('Cliente eliminado')
    } catch (err) {
      console.error('Error in elim:', err);
      toast('Error al eliminar', false)
    }
  }

  const exportar = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state.clientes, null, 2)], { type: 'application/json' }))
    a.download = `sanpro_backup_${dayjs().format('YYYYMMDD')}.json`
    a.click()
    toast('Backup exportado')
  }

  const importar = ev => {
    const file = ev.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async e => {
      let data
      try {
        data = JSON.parse(e.target.result)
        if (!Array.isArray(data)) throw 'Formato inválido'
      } catch (err) {
        return toast('Archivo inválido', false)
      }
      if (!confirm('¿Reemplazar todos los clientes?')) return
      try {
        await window.db.run('DELETE FROM clientes')
        const stmt = window.db.prepare(
          `INSERT INTO clientes (nombre, cedula, cobrador, monto, interes, semanas, cargo, fechaInicio, total, balance, cobrado, calendario, historial)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const c of data) {
          await stmt.run([
            c.nombre || '',
            c.cedula || null,
            c.cobrador || 'N/A',
            c.monto || 0,
            c.interes || 0,
            c.semanas || 1,
            c.cargo || 0,
            c.fechaInicio || dayjs().format('YYYY-MM-DD'),
            c.total || c.monto || 0,
            c.balance || c.monto || 0,
            c.cobrado || 0,
            JSON.stringify(c.calendario || []),
            JSON.stringify(c.historial || [])
          ])
        }
        stmt.finalize()
        await cargarClientes()
        toast('Importado correctamente')
      } catch (err) {
        console.error('Error in importar:', err);
        toast('Error importando', false)
      }
    }
    reader.readAsText(file)
  }

  // Setup general para buscar (siempre disponible)
  console.log('Setting up general input listeners...');
  try {
    const buscar = byId('buscar')
    if (buscar) {
      buscar.oninput = actualizar
      console.log('Buscar input set');
    } else {
      console.warn('buscar not found');
    }
  } catch (err) {
    console.error('Error setting buscar listener:', err);
  }

  // Configuración de tabs
  console.log('Setting up tab listeners...');
  try {
    qsa('.tab-btn').forEach(b => {
      console.log('Attaching listener to tab:', b.textContent.trim());
      b.onclick = () => {
        console.log('Tab clicked:', b.dataset.tab);
        qsa('.tab-btn').forEach(x => x.classList.remove('border-indigo-600'))
        b.classList.add('border-indigo-600')
        qsa('.tab').forEach(t => {
          console.log('Hiding tab:', t.id);
          t.classList.add('hidden')
        })
        const tab = qs(`#${b.dataset.tab}`)
        if (tab) {
          console.log('Showing tab:', tab.id);
          tab.classList.remove('hidden')
          if (b.dataset.tab === 'clientes' && typeof actualizar === 'function') {
            actualizar()
          }
          if (b.dataset.tab === 'nuevo') {
            setupNuevoInputs();
            preview();  // Initial calc with defaults
          }
        } else {
          console.error('Tab not found:', b.dataset.tab);
        }
         if (b.dataset.tab === 'clientes') {
  actualizar();
  cargarCobradores();  // Asegura que el filtro esté actualizado
}

      }
    })
    console.log('Tab listeners set successfully');
  } catch (err) {
    console.error('Error setting tab listeners:', err);
  }

byId('input-cobrador').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return

  const nombre = e.target.value.trim()
  if (!nombre) return

  try {
    await window.db.run(
      'INSERT OR IGNORE INTO cobradores (nombre) VALUES (?)',
      [nombre]
    )
    e.target.value = ''
    cargarCobradores()
  } catch (err) {
    console.error(err)
  }
})


// Listeners para filtros y paginación (agrega después de tabs)
const filtroEstado = byId('filtro-estado');
const filtroCobrador = byId('filtro-cobrador');
const filtroFechaDesde = byId('filtro-fecha-desde');
const filtroFechaHasta = byId('filtro-fecha-hasta');
const itemsPerPageSelect = byId('items-per-page');
const prevPageBtn = byId('prev-page');
const nextPageBtn = byId('next-page');

if (filtroEstado) filtroEstado.onchange = actualizar;
if (filtroCobrador) filtroCobrador.onchange = actualizar;
if (filtroFechaDesde) filtroFechaDesde.onchange = actualizar;
if (filtroFechaHasta) filtroFechaHasta.onchange = actualizar;
if (itemsPerPageSelect) itemsPerPageSelect.onchange = (e) => { itemsPerPage = parseInt(e.target.value); currentPage = 1; actualizar(); };
if (prevPageBtn) prevPageBtn.onclick = () => { if (currentPage > 1) { currentPage--; actualizar(); } };
if (nextPageBtn) nextPageBtn.onclick = () => { if (currentPage < totalPages) { currentPage++; actualizar(); } };

// Poblar filtro de cobradores (una vez al cargar clientes)
const poblarCobradores = () => {
  const uniqueCobradores = [...new Set(state.clientes.map(c => c.cobrador))].sort();
  filtroCobrador.innerHTML = '<option value="">Todos los cobradores</option>';
  uniqueCobradores.forEach(cob => {
    filtroCobrador.innerHTML += `<option value="${cob}">${cob}</option>`;
  });
};

window.limpiarFiltros = () => {
  const buscar = byId('buscar');
  const filtroEstado = byId('filtro-estado');
  const filtroCobrador = byId('filtro-cobrador');
  const filtroFechaDesde = byId('filtro-fecha-desde');
  const filtroFechaHasta = byId('filtro-fecha-hasta');

  if (buscar) buscar.value = '';
  if (filtroEstado) filtroEstado.value = '';
  if (filtroCobrador) filtroCobrador.value = '';
  if (filtroFechaDesde) filtroFechaDesde.value = '';
  if (filtroFechaHasta) filtroFechaHasta.value = '';

  currentPage = 1;

  if (typeof actualizar === 'function') {
    actualizar();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const btnRefrescar = document.getElementById('btn-refrescar');

  if (btnRefrescar) {
    btnRefrescar.addEventListener('click', () => {
      currentPage = 1;

      if (typeof actualizar === 'function') {
        actualizar();
      }
    });
  }
});


window.setPage = (page) => {
  currentPage = page;

  if (typeof actualizar === 'function') {
    actualizar();
  }
};


  // 2. Event delegation para botones de tabla (una vez, en tbody de clientes)
  const tbody = byId('tbody')
  if (tbody) {
    tbody.addEventListener('click', e => {
      const i = e.target.dataset.i
      if (e.target.classList.contains('btn-ver') && i !== undefined) {
        ver(parseInt(i))
      } else if (e.target.classList.contains('btn-elim') && i !== undefined) {
        elim(parseInt(i))
      }
    })
    console.log('Event delegation set on tbody');
  }

  // Setup para inputs de nuevo (llamada al mostrar tab)
  const setupNuevoInputs = () => {
    console.log('Setting up nuevo input listeners...');
    try {
      ;['n_monto', 'n_interes', 'n_semanas', 'n_cargo'].forEach(id => {
        const el = byId(id)
        if (el) {
          el.oninput = () => {
            console.log('Input changed:', id);
            preview()
          }
          console.log('Input set:', id);
        } else {
          console.warn(`Input element not found: ${id}`);
        }
      })
      const fecha = byId('n_fecha')
      if (fecha) {
        const today = dayjs().format('YYYY-MM-DD')
        fecha.value = today
        console.log('Fecha set to:', today);
      } else {
        console.warn('n_fecha not found - skipping');
      }
      console.log('Nuevo input listeners set successfully');
    } catch (err) {
      console.error('Error setting nuevo input listeners:', err);
    }
  }

 

// Exponer funciones globales
console.log('Exposing global functions...');
window.ver = ver;
window.elim = elim;
window.crear = crear;
window.pagar = pagar;
window.exportar = exportar;
window.importar = importar;
window.imprimirUltimaFactura = imprimirUltimaFactura;
window.cerrarModal = cerrarModal;
window.actualizar = actualizar;
console.log('Global functions exposed');

// Inicialización real (debe estar DENTRO de initApp, no fuera)
console.log('Starting initial load...');
  try {
    await cargarClientes();  // Ahora con await para mejor flujo
    await cargarCobradores();  // ← Asegura que los cobradores estén disponibles desde el principio
    console.log('Initial load complete');
    const dashboardBtn = qs('[data-tab="dashboard"]');
    if (dashboardBtn) {
      dashboardBtn.click();
    } else {
      const dashboard = byId('dashboard');
      if (dashboard) dashboard.classList.remove('hidden');
      qsa('.tab:not(#dashboard)').forEach(t => t.classList.add('hidden'));
    }
  } catch (err) {
    console.error('Error en carga inicial:', err);
    toast('Error al cargar los datos iniciales', false);
  }

  console.log('initApp completed');
}

// Mostrar HWID en cualquier momento (botón en header)
window.mostrarMiHWID = async () => {
  try {
    const hwid = await window.license.getHardwareId();
    alert(`Tu ID único de licencia es:\n\n${hwid}\n\nCópialo y envíaselo al desarrollador por WhatsApp para recibir tu clave de activación.`);
    await navigator.clipboard.writeText(hwid);
    toast('ID copiado al portapapeles automáticamente', true);
  } catch (err) {
    console.error('Error al mostrar HWID:', err);
    toast('Error al obtener el ID. Intenta de nuevo.', false);
  }
};

// Copiar HWID desde el modal
window.copiarHWID = async () => {
  const hwidElement = document.getElementById('hwid-display');
  if (hwidElement && hwidElement.textContent) {
    await navigator.clipboard.writeText(hwidElement.textContent);
    toast('ID copiado al portapapeles', true);
  }
};

// Enviar por WhatsApp directo (abre chat con mensaje prellenado)
window.enviarPorWhatsApp = async () => {
  try {
    const hwid = await window.license.getHardwareId();
    const mensaje = encodeURIComponent(
      `Hola Sandy,\n` +
      `Este es mi ID único de licencia:\n` +
      `${hwid}\n\n` +
      `Gracias por ayudarme a activar SAN PRO + Facturación.`
    );
    
    // Tu número de WhatsApp (cámbialo por el tuyo real, formato internacional)
    const tuNumeroWhatsApp = '18497851259'; // ← ¡CAMBIAR ESTO POR TU NÚMERO REAL!
    
    const url = `https://wa.me/${tuNumeroWhatsApp}?text=${mensaje}`;
    window.open(url, '_blank');
    
    toast('Abriendo WhatsApp con tu ID listo para enviar', true);
  } catch (err) {
    console.error('Error al preparar WhatsApp:', err);
    toast('Error al abrir WhatsApp. Copia el ID manualmente.', false);
  }
};