const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];

const state = {
  supabase: null,
  clients: [],
  collectors: [],
  invoices: [],
  selectedClient: null,
  lastInvoice: null,
  installationId: null,
  settings: {},
  user: null,
  profile: null,
  authMode: 'login',
  profiles: [],
  plan: null,
  offlineQueue: []
};

const defaults = {
  developerWhatsApp: '18497851259',
  paypalUrl: 'https://www.paypal.me/sandypavon0329',
  bankAccount: '9601016551',
  businessName: 'SAN PRO',
  businessTagline: 'Sistema de prestamos y facturacion',
  monthlyGoal: 0,
  defaultInterest: 30,
  defaultWeeks: 13,
  receiptFooter: 'Gracias por su pago. SAN PRO'
};

const planLimits = {
  basic: { clients: 25, label: 'Basico' },
  pro: { clients: Infinity, label: 'Pro' },
  premium: { clients: Infinity, label: 'Premium' }
};

const cfg = () => ({ ...defaults, ...(window.SANPRO_CONFIG || {}), ...state.settings });
const money = n => '$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => dayjs().format('YYYY-MM-DD');

function toast(message, ok = true) {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast ${ok ? '' : 'error'}`;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3200);
}

function setSyncStatus(text, ok = true) {
  const el = $('sync-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('offline', !ok);
}

function showScreen(id) {
  ['setup-screen', 'terms-screen', 'pin-screen', 'login-screen', 'license-screen', 'app'].forEach(screen => {
    $(screen)?.classList.toggle('hidden', screen !== id);
  });
}

function activateTab(tabId) {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  $$('.mobile-nav button').forEach(b => b.classList.toggle('active', b.dataset.mobileTab === tabId));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === tabId));
}

function getStoredConfig() {
  try {
    return JSON.parse(localStorage.getItem('sanpro_supabase_config') || '{}');
  } catch {
    return {};
  }
}

function getSupabaseConfig() {
  const stored = getStoredConfig();
  const current = cfg();
  return {
    supabaseUrl: stored.supabaseUrl || current.supabaseUrl,
    supabaseAnonKey: stored.supabaseAnonKey || current.supabaseAnonKey
  };
}

function hasSupabaseConfig() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  return supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('TU-PROYECTO') && !supabaseAnonKey.includes('TU_SUPABASE');
}

function showSetup(message = '') {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  $('setup-url').value = supabaseUrl && !supabaseUrl.includes('TU-PROYECTO') ? supabaseUrl : '';
  $('setup-key').value = supabaseAnonKey && !supabaseAnonKey.includes('TU_SUPABASE') ? supabaseAnonKey : '';
  showScreen('setup-screen');
  if (message) toast(message, false);
}

function initSupabase() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  state.supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
}

function sanitizePhone(phone) {
  let number = String(phone || '').replace(/\D/g, '');
  if (number.length === 10 && (number.startsWith('8') || number.startsWith('9'))) number = `1${number}`;
  return number;
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function getInstallationId() {
  let id = localStorage.getItem('sanpro_installation_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('sanpro_installation_id', id);
  }
  state.installationId = id;
  return id;
}

async function getConfigValue(key) {
  const scopedKey = state.user?.id ? `${state.user.id}:${key}` : key;
  if (state.user?.id) {
    const own = await state.supabase.from('app_config').select('value').eq('key', scopedKey).maybeSingle();
    if (own.error) throw own.error;
    if (own.data) return own.data.value;
  }
  const { data, error } = await state.supabase.from('app_config').select('value').eq('key', key).is('owner_id', null).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function setConfigValue(key, value) {
  const scopedKey = state.user?.id ? `${state.user.id}:${key}` : key;
  const { error } = await state.supabase.from('app_config').upsert({ key: scopedKey, value, owner_id: state.user?.id || null });
  if (error) throw error;
}

async function loadSettings() {
  const remote = await getConfigValue('business_settings').catch(() => null);
  let local = {};
  try {
    local = JSON.parse(localStorage.getItem('sanpro_business_settings') || '{}');
  } catch {
    local = {};
  }
  state.settings = { ...remote, ...local };
  applySettings();
}

function loadOfflineQueue() {
  try {
    state.offlineQueue = JSON.parse(localStorage.getItem('sanpro_offline_queue') || '[]');
  } catch {
    state.offlineQueue = [];
  }
}

function saveOfflineQueue() {
  localStorage.setItem('sanpro_offline_queue', JSON.stringify(state.offlineQueue));
  setSyncStatus(state.offlineQueue.length ? `${state.offlineQueue.length} pendiente(s)` : (navigator.onLine ? 'Sincronizado' : 'Offline'), navigator.onLine);
}

async function loadPlan() {
  const remote = await getConfigValue('subscription_plan').catch(() => null);
  state.plan = remote || { plan: 'basic', status: 'trial', validUntil: dayjs().add(30, 'day').format('YYYY-MM-DD') };
  renderPlan();
}

async function savePlan(plan) {
  const payload = {
    plan,
    status: plan === 'basic' ? 'active' : 'pending_payment',
    validUntil: dayjs().add(plan === 'basic' ? 365 : 30, 'day').format('YYYY-MM-DD'),
    updatedAt: new Date().toISOString()
  };
  await setConfigValue('subscription_plan', payload);
  state.plan = payload;
  renderPlan();
  toast(`Plan ${planLimits[plan].label} seleccionado`);
}

function enforcePlanLimit() {
  const plan = state.plan?.plan || 'basic';
  const limit = planLimits[plan]?.clients ?? 25;
  if (state.clients.length >= limit) {
    toast(`Tu plan ${planLimits[plan].label} permite hasta ${limit} clientes`, false);
    activateTab('plans');
    return false;
  }
  return true;
}

async function saveSettings() {
  const settings = {
    businessName: $('setting-business-name').value.trim() || defaults.businessName,
    businessTagline: $('setting-business-tagline').value.trim() || defaults.businessTagline,
    developerWhatsApp: $('setting-whatsapp').value.trim() || defaults.developerWhatsApp,
    monthlyGoal: Number($('setting-monthly-goal').value || 0),
    defaultInterest: Number($('setting-default-interest').value || defaults.defaultInterest),
    defaultWeeks: Number($('setting-default-weeks').value || defaults.defaultWeeks),
    receiptFooter: $('setting-receipt-footer').value.trim() || defaults.receiptFooter,
    bankAccount: $('setting-bank-account').value.trim() || defaults.bankAccount
  };
  state.settings = settings;
  localStorage.setItem('sanpro_business_settings', JSON.stringify(settings));
  await setConfigValue('business_settings', settings);
  applySettings();
  renderAll();
  toast('Ajustes guardados');
}

function applySettings() {
  const current = cfg();
  $('brand-title').textContent = current.businessName;
  $('brand-subtitle').textContent = current.businessTagline;
  $('paypal-link').href = current.paypalUrl;
  $('bank-account').textContent = current.bankAccount;
  $('setting-business-name').value = current.businessName;
  $('setting-business-tagline').value = current.businessTagline;
  $('setting-whatsapp').value = current.developerWhatsApp;
  $('setting-monthly-goal').value = current.monthlyGoal || '';
  $('setting-default-interest').value = current.defaultInterest;
  $('setting-default-weeks').value = current.defaultWeeks;
  $('setting-receipt-footer').value = current.receiptFooter;
  $('setting-bank-account').value = current.bankAccount;
  if (!$('loan-interest').dataset.touched) $('loan-interest').value = current.defaultInterest;
  if (!$('loan-weeks').dataset.touched) $('loan-weeks').value = current.defaultWeeks;
}

function normalizeClient(row) {
  return {
    id: row.id,
    tipo: row.loan_type || 'san',
    nombre: row.name,
    telefono: row.phone || '',
    cedula: row.document_id || '',
    cobrador: row.collector,
    monto: Number(row.amount || 0),
    interes: Number(row.interest || 0),
    semanas: Number(row.weeks || 0),
    cargo: Number(row.contract_fee || 0),
    fechaInicio: row.start_date,
    total: Number(row.total || 0),
    balance: Number(row.balance || 0),
    cobrado: Number(row.collected || 0),
    calendario: Array.isArray(row.schedule) ? row.schedule : [],
    historial: Array.isArray(row.payments) ? row.payments : [],
    createdAt: row.created_at
  };
}

function clientToRow(c) {
  return {
    loan_type: c.tipo || 'san',
    name: c.nombre,
    phone: c.telefono,
    document_id: c.cedula,
    collector: c.cobrador,
    amount: c.monto,
    interest: c.interes,
    weeks: c.semanas,
    contract_fee: c.cargo,
    start_date: c.fechaInicio,
    total: c.total,
    balance: c.balance,
    collected: c.cobrado,
    schedule: c.calendario,
    payments: c.historial
  };
}

function loanStatus(c) {
  if (c.balance <= 0) return { text: 'PAGADO', cls: 'done', next: '-' };
  const start = dayjs(c.fechaInicio);
  const firstDue = start.add(7, 'day');
  const elapsed = Math.floor(dayjs().diff(firstDue, 'week'));
  const expected = Math.max(0, elapsed + 1);
  const paidWeeks = c.calendario.filter(s => Number(s.pagado || 0) >= Number(s.cuota || 0)).length;
  const late = expected - paidWeeks;
  const nextDate = start.add(7 + paidWeeks * 7, 'day').format('DD/MM/YYYY');
  if (late > 1) return { text: 'MOROSO', cls: 'late', next: nextDate };
  if (dayjs().isBefore(firstDue)) return { text: 'AL DIA', cls: 'ok', next: firstDue.format('DD/MM/YYYY') };
  return { text: 'AL DIA', cls: 'ok', next: nextDate };
}

function calculateLoan() {
  const type = $('loan-type').value || 'san';
  const amount = Number($('loan-amount').value || 0);
  const interest = Number($('loan-interest').value || 0);
  const weeks = Math.max(1, Number($('loan-weeks').value || 1));
  const fee = Number($('loan-fee').value || 0);
  const periodInterest = amount * interest / 100;
  const total = type === 'redito'
    ? amount + fee + (periodInterest * weeks)
    : amount + (amount * interest / 100) + fee;
  const weekly = type === 'redito' ? periodInterest : total / weeks;
  return { type, amount, interest, weeks, fee, total, weekly, profit: total - amount };
}

function updatePreview() {
  const calc = calculateLoan();
  $('calc-total').textContent = money(calc.total);
  $('calc-weekly').textContent = money(calc.weekly);
  $('calc-delivered').textContent = money(calc.amount);
  $('calc-profit').textContent = money(calc.profit);
  $('calc-period-label').textContent = calc.type === 'redito' ? 'Redito por periodo' : 'Cuota semanal';
  $('loan-type-help').textContent = calc.type === 'redito'
    ? 'Tipo Redito: cada periodo paga solo interes; en la ultima cuota se suma el capital.'
    : 'Tipo San: capital, interes y cargos se reparten en cuotas fijas.';
}

async function loadAll() {
  setSyncStatus(navigator.onLine ? 'Sincronizando...' : 'Offline', navigator.onLine);
  let clientsQuery = state.supabase.from('clients').select('*').order('created_at', { ascending: false });
  let collectorsQuery = state.supabase.from('collectors').select('*').order('name');
  const invoicesQuery = state.supabase.from('invoices').select('*').order('paid_at', { ascending: false }).limit(100);
  if (state.profile?.role === 'collector' && state.profile.collector_name) {
    clientsQuery = clientsQuery.eq('collector', state.profile.collector_name);
    collectorsQuery = collectorsQuery.eq('name', state.profile.collector_name);
  }
  const [clientsRes, collectorsRes, invoicesRes] = await Promise.all([clientsQuery, collectorsQuery, invoicesQuery]);

  if (clientsRes.error) throw clientsRes.error;
  if (collectorsRes.error) throw collectorsRes.error;
  if (invoicesRes.error) throw invoicesRes.error;

  state.clients = clientsRes.data.map(normalizeClient);
  state.collectors = collectorsRes.data;
  state.invoices = invoicesRes.data;
  setSyncStatus(state.offlineQueue.length ? `${state.offlineQueue.length} pendiente(s)` : 'Sincronizado', true);
  renderAll();
  if (['owner', 'admin'].includes(state.profile?.role)) await loadProfiles();
}

function renderAll() {
  $('current-date').textContent = dayjs().format('DD/MM/YYYY');
  renderStats();
  renderCollectors();
  renderClientFilters();
  renderClients();
  renderInvoices();
  renderPremiumDashboard();
  renderAnalytics();
  renderMobileCollector();
  renderTeamSummary();
  renderPlan();
  updatePreview();
}

function renderStats() {
  let loaned = 0, collected = 0, balance = 0, late = 0;
  state.clients.forEach(c => {
    loaned += c.monto;
    collected += c.cobrado;
    balance += c.balance;
    if (loanStatus(c).text === 'MOROSO') late++;
  });
  $('stat-loaned').textContent = money(loaned);
  $('stat-collected').textContent = money(collected);
  $('stat-balance').textContent = money(balance);
  $('stat-clients').textContent = state.clients.length;
  $('stat-late').textContent = late;
}

function clientBuckets() {
  const buckets = { ok: 0, late: 0, paid: 0 };
  state.clients.forEach(c => {
    const st = loanStatus(c).text;
    if (st === 'PAGADO') buckets.paid++;
    else if (st === 'MOROSO') buckets.late++;
    else buckets.ok++;
  });
  return buckets;
}

function nextDueDate(client) {
  const paidWeeks = client.calendario.filter(s => Number(s.pagado || 0) >= Number(s.cuota || 0)).length;
  return dayjs(client.fechaInicio).add(7 + paidWeeks * 7, 'day');
}

function monthCollected() {
  return state.invoices
    .filter(i => dayjs(i.paid_at).isSame(dayjs(), 'month'))
    .reduce((sum, i) => sum + Number(i.amount || 0), 0);
}

function renderPremiumDashboard() {
  const buckets = clientBuckets();
  const totalActive = Math.max(1, buckets.ok + buckets.late);
  const score = state.clients.length ? Math.round(((buckets.ok + buckets.paid) / state.clients.length) * 100) : 0;
  const balance = state.clients.reduce((sum, c) => sum + c.balance, 0);
  const collected = monthCollected();
  const goal = Number(cfg().monthlyGoal || 0);
  const goalPercent = goal > 0 ? Math.min(100, Math.round((collected / goal) * 100)) : 0;

  $('executive-headline').textContent = balance > 0
    ? `Cartera activa de ${money(balance)}`
    : 'No hay balance pendiente';
  $('executive-copy').textContent = state.clients.length
    ? `${buckets.ok} al dia, ${buckets.late} en riesgo y ${buckets.paid} pagados.`
    : 'Crea tu primer prestamo para empezar a medir el negocio.';
  $('health-score').textContent = `${score}%`;
  $('health-score-label').textContent = `${score}% sano`;
  $('health-ring').style.setProperty('--score', `${score}%`);
  $('health-ok').textContent = buckets.ok;
  $('health-late').textContent = buckets.late;
  $('health-paid').textContent = buckets.paid;
  $('monthly-goal-label').textContent = goal ? `${money(collected)} / ${money(goal)}` : money(collected);
  $('monthly-goal-bar').style.width = `${goalPercent}%`;
  $('monthly-goal-copy').textContent = goal
    ? `${goalPercent}% de la meta mensual completada.`
    : 'Configura una meta mensual en Ajustes.';

  const upcoming = state.clients
    .filter(c => c.balance > 0)
    .map(c => ({ client: c, due: nextDueDate(c), status: loanStatus(c) }))
    .sort((a, b) => a.due.valueOf() - b.due.valueOf())
    .slice(0, 6);
  $('upcoming-list').innerHTML = upcoming.map(item => `
    <div class="timeline-item">
      <span class="dot ${item.status.cls}"></span>
      <div><strong>${item.client.nombre}</strong><small>${item.client.cobrador} · ${item.due.format('DD/MM/YYYY')}</small></div>
      <b>${money(item.client.balance)}</b>
    </div>
  `).join('') || '<p class="muted">No hay cobros pendientes.</p>';
}

function renderAnalytics() {
  renderCollectorPerformance();
  renderPortfolioChart();
  renderProjection();
  renderSmartAlerts();
}

function renderCollectorPerformance() {
  const groups = new Map();
  state.clients.forEach(c => {
    const current = groups.get(c.cobrador) || { name: c.cobrador, loaned: 0, collected: 0, balance: 0, late: 0 };
    current.loaned += c.monto;
    current.collected += c.cobrado;
    current.balance += c.balance;
    if (loanStatus(c).text === 'MOROSO') current.late++;
    groups.set(c.cobrador, current);
  });
  const rows = [...groups.values()].sort((a, b) => b.collected - a.collected);
  const max = Math.max(1, ...rows.map(r => r.collected));
  $('collector-count').textContent = `${rows.length} cobradores`;
  $('collector-performance').innerHTML = rows.map(r => `
    <div class="bar-row">
      <div><strong>${r.name}</strong><small>${money(r.collected)} cobrado · ${r.late} morosos</small></div>
      <div class="bar-track"><span style="width:${Math.round((r.collected / max) * 100)}%"></span></div>
      <b>${money(r.balance)}</b>
    </div>
  `).join('') || '<p class="muted">Agrega cobradores y prestamos para ver rendimiento.</p>';
}

async function loadProfiles() {
  if (!state.user) return;
  const { data, error } = await state.supabase.from('profiles').select('*').order('created_at', { ascending: true });
  if (error) {
    toast('No se pudieron cargar usuarios: ' + error.message, false);
    return;
  }
  state.profiles = data || [];
  renderUsers();
}

function renderUsers() {
  if (!$('users-body')) return;
  const collectors = [...new Set(state.collectors.map(c => c.name))].filter(Boolean).sort();
  $('users-body').innerHTML = state.profiles.map(p => `
    <tr>
      <td>${p.full_name || p.id}</td>
      <td>
        <select data-user-role="${p.id}">
          ${['owner', 'admin', 'collector', 'viewer'].map(role => `<option value="${role}" ${p.role === role ? 'selected' : ''}>${role}</option>`).join('')}
        </select>
      </td>
      <td>
        <select data-user-collector="${p.id}">
          <option value="">Sin asignar</option>
          ${collectors.map(name => `<option value="${name}" ${p.collector_name === name ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
      </td>
      <td>${p.active ? 'Activo' : 'Inactivo'}</td>
      <td><button data-save-user="${p.id}">Guardar</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5">No hay usuarios para mostrar.</td></tr>';
}

function renderTeamSummary() {
  if (!$('team-summary')) return;
  const roles = state.profiles.reduce((acc, p) => {
    acc[p.role] = (acc[p.role] || 0) + 1;
    return acc;
  }, {});
  $('team-summary').innerHTML = `
    <span>Owners <strong>${roles.owner || 0}</strong></span>
    <span>Admins <strong>${roles.admin || 0}</strong></span>
    <span>Cobradores <strong>${roles.collector || 0}</strong></span>
  `;
}

function renderPlan() {
  if (!$('plan-status')) return;
  const plan = state.plan?.plan || 'basic';
  const limit = planLimits[plan]?.clients ?? 25;
  $('plan-status').innerHTML = `
    <span>Plan: <strong>${planLimits[plan]?.label || plan}</strong></span>
    <span>Estado: <strong>${state.plan?.status || 'trial'}</strong></span>
    <span>Clientes: <strong>${state.clients.length}/${limit === Infinity ? 'Ilimitado' : limit}</strong></span>
    <span>Vence: <strong>${state.plan?.validUntil ? dayjs(state.plan.validUntil).format('DD/MM/YYYY') : '-'}</strong></span>
  `;
}

async function saveUserProfile(id) {
  const role = document.querySelector(`[data-user-role="${id}"]`)?.value || 'viewer';
  const collectorName = document.querySelector(`[data-user-collector="${id}"]`)?.value || null;
  const { error } = await state.supabase.from('profiles').update({
    role,
    collector_name: collectorName
  }).eq('id', id);
  if (error) return toast(error.message, false);
  toast('Usuario actualizado');
  await loadProfile();
  await loadProfiles();
  await loadAll();
}

function renderPortfolioChart() {
  const buckets = clientBuckets();
  const total = Math.max(1, buckets.ok + buckets.late + buckets.paid);
  const ok = Math.round((buckets.ok / total) * 100);
  const late = Math.round((buckets.late / total) * 100);
  const paid = Math.max(0, 100 - ok - late);
  const totalBalance = state.clients.reduce((sum, c) => sum + c.balance, 0);
  $('portfolio-total').textContent = money(totalBalance);
  $('portfolio-chart').style.background = `conic-gradient(#16a34a 0 ${ok}%, #dc2626 ${ok}% ${ok + late}%, #64748b ${ok + late}% 100%)`;
  $('portfolio-chart').querySelector('span').textContent = `${ok}%`;
  $('portfolio-legend').innerHTML = `
    <span><i class="green"></i>Al dia ${ok}%</span>
    <span><i class="red"></i>Moroso ${late}%</span>
    <span><i class="gray"></i>Pagado ${paid}%</span>
  `;
}

function renderProjection() {
  const weeks = Array.from({ length: 4 }, (_, i) => ({ label: `Semana ${i + 1}`, total: 0 }));
  state.clients.filter(c => c.balance > 0).forEach(c => {
    const due = nextDueDate(c);
    const diff = Math.max(0, Math.min(3, Math.floor(due.diff(dayjs(), 'day') / 7)));
    const pending = c.calendario.find(s => Number(s.pagado || 0) < Number(s.cuota || 0));
    weeks[diff].total += Math.min(c.balance, pending ? Number(pending.cuota) - Number(pending.pagado || 0) : c.balance);
  });
  const max = Math.max(1, ...weeks.map(w => w.total));
  const total = weeks.reduce((sum, w) => sum + w.total, 0);
  $('projection-total').textContent = money(total);
  $('projection-bars').innerHTML = weeks.map(w => `
    <div class="projection-col">
      <div class="projection-fill" style="height:${Math.max(8, Math.round((w.total / max) * 100))}%"></div>
      <strong>${money(w.total)}</strong>
      <span>${w.label}</span>
    </div>
  `).join('');
}

function renderSmartAlerts() {
  const alerts = [];
  const lateClients = state.clients.filter(c => loanStatus(c).text === 'MOROSO');
  const highBalance = [...state.clients].filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance)[0];
  const noCollector = state.clients.filter(c => !c.cobrador || c.cobrador === 'N/A').length;
  if (lateClients.length) alerts.push({ level: 'danger', text: `${lateClients.length} clientes requieren seguimiento por mora.` });
  if (highBalance) alerts.push({ level: 'warn', text: `${highBalance.nombre} tiene el mayor balance: ${money(highBalance.balance)}.` });
  if (noCollector) alerts.push({ level: 'warn', text: `${noCollector} clientes no tienen cobrador definido.` });
  if (!alerts.length) alerts.push({ level: 'ok', text: 'La cartera se ve estable por ahora.' });
  $('alerts-count').textContent = alerts.length;
  $('smart-alerts').innerHTML = alerts.map(a => `<div class="alert ${a.level}">${a.text}</div>`).join('');
}

function filteredClients() {
  const q = $('search-client').value.trim().toLowerCase();
  const status = $('filter-status').value;
  const collector = $('filter-collector').value;
  const from = $('filter-from').value ? dayjs($('filter-from').value).startOf('day') : null;
  const to = $('filter-to').value ? dayjs($('filter-to').value).endOf('day') : null;
  return state.clients.filter(c => {
    const st = loanStatus(c).text;
    const searchable = `${c.nombre} ${c.cedula} ${c.cobrador}`.toLowerCase();
    return (!q || searchable.includes(q)) &&
      (!status || st === status) &&
      (!collector || c.cobrador === collector) &&
      (!from || dayjs(c.fechaInicio).isAfter(from) || dayjs(c.fechaInicio).isSame(from, 'day')) &&
      (!to || dayjs(c.fechaInicio).isBefore(to) || dayjs(c.fechaInicio).isSame(to, 'day'));
  });
}

function renderClients() {
  const rows = filteredClients();
  $('clients-body').innerHTML = rows.map((c, index) => {
    const st = loanStatus(c);
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${c.nombre}</td>
        <td>${c.tipo === 'redito' ? 'Rédito' : 'San'}</td>
        <td>${c.telefono || '-'}</td>
        <td>${c.cedula || '-'}</td>
        <td>${c.cobrador}</td>
        <td>${money(c.monto)}</td>
        <td>${money(c.balance)}</td>
        <td>${st.next}</td>
        <td><span class="badge ${st.cls}">${st.text}</span></td>
        <td class="actions-cell">
          <button data-view="${c.id}">Ver</button>
          <button class="danger" data-delete="${c.id}">Eliminar</button>
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="11">No hay clientes para mostrar.</td></tr>';
}

function renderClientFilters() {
  const collectors = [...new Set([...state.collectors.map(c => c.name), ...state.clients.map(c => c.cobrador)])].filter(Boolean).sort();
  $('filter-collector').innerHTML = '<option value="">Todos los cobradores</option>' + collectors.map(c => `<option value="${c}">${c}</option>`).join('');
  $('loan-collector').innerHTML = collectors.length
    ? collectors.map(c => `<option value="${c}">${c}</option>`).join('')
    : '<option value="Cobrador 1">Cobrador 1</option>';
}

function renderCollectors() {
  $('collector-tags').innerHTML = state.collectors.map(c => `
    <span class="tag">${c.name}<button data-remove-collector="${c.id}">x</button></span>
  `).join('');
}

function renderInvoices() {
  $('invoices-body').innerHTML = state.invoices.map(i => `
    <tr>
      <td>${i.number}</td>
      <td>${i.client_name}</td>
      <td>${money(i.amount)}</td>
      <td>${money(i.new_balance)}</td>
      <td>${dayjs(i.paid_at).format('DD/MM/YYYY hh:mm A')}</td>
      <td><button data-print-invoice="${i.id}">Imprimir</button></td>
    </tr>
  `).join('') || '<tr><td colspan="6">No hay facturas registradas.</td></tr>';
}

function renderMobileCollector() {
  if (!$('mobile-client-list')) return;
  const q = $('mobile-client-search')?.value.trim().toLowerCase() || '';
  const due = state.clients
    .filter(c => c.balance > 0)
    .filter(c => !q || `${c.nombre} ${c.telefono} ${c.cedula}`.toLowerCase().includes(q))
    .map(c => ({ client: c, due: nextDueDate(c), status: loanStatus(c) }))
    .sort((a, b) => a.due.valueOf() - b.due.valueOf());
  const total = due.reduce((sum, item) => sum + item.client.balance, 0);
  $('mobile-total').textContent = money(total);
  $('mobile-copy').textContent = `${due.length} clientes con balance pendiente.`;
  $('mobile-client-list').innerHTML = due.map(item => `
    <article class="mobile-client-card">
      <div>
        <strong>${item.client.nombre}</strong>
        <span>${item.status.text} - vence ${item.due.format('DD/MM/YYYY')}</span>
      </div>
      <b>${money(item.client.balance)}</b>
      <div class="mobile-card-actions">
        <button data-mobile-pay="${item.client.id}" class="success">Cobrar</button>
        <button data-mobile-view="${item.client.id}" class="ghost">Ver</button>
        ${item.client.telefono ? `<a class="button ghost" href="https://wa.me/${sanitizePhone(item.client.telefono)}" target="_blank" rel="noreferrer">WhatsApp</a>` : ''}
      </div>
    </article>
  `).join('') || '<p class="muted">No hay clientes pendientes en esta ruta.</p>';
}

async function saveLoan(event) {
  event.preventDefault();
  if (!enforcePlanLimit()) return;
  const calc = calculateLoan();
  const startDate = $('loan-date').value || today();
  const schedule = Array.from({ length: calc.weeks }, () => ({ cuota: calc.weekly, pagado: 0 }));
  if (calc.type === 'redito' && schedule.length) {
    schedule[schedule.length - 1].cuota = calc.weekly + calc.amount + calc.fee;
    schedule.forEach((week, index) => {
      week.tipo = index === schedule.length - 1 ? 'redito_capital' : 'redito';
      week.interes = calc.weekly;
      week.capital = index === schedule.length - 1 ? calc.amount + calc.fee : 0;
    });
  }
  const client = {
    tipo: calc.type,
    nombre: $('loan-name').value.trim(),
    telefono: $('loan-phone').value.trim(),
    cedula: $('loan-document').value.trim(),
    cobrador: $('loan-collector').value,
    monto: calc.amount,
    interes: calc.interest,
    semanas: calc.weeks,
    cargo: calc.fee,
    fechaInicio: startDate,
    total: calc.total,
    balance: calc.total,
    cobrado: 0,
    calendario: schedule,
    historial: []
  };
  const { error } = await state.supabase.from('clients').insert({ ...clientToRow(client), owner_id: state.user?.id || null });
  if (error) return toast(error.message, false);
  $('loan-form').reset();
  $('loan-type').value = 'san';
  $('loan-interest').value = cfg().defaultInterest;
  $('loan-weeks').value = cfg().defaultWeeks;
  $('loan-fee').value = 0;
  $('loan-date').value = today();
  await loadAll();
  toast('Prestamo guardado');
}

async function deleteClient(id) {
  if (!confirm('Eliminar permanentemente este cliente?')) return;
  const { error } = await state.supabase.from('clients').delete().eq('id', id);
  if (error) return toast(error.message, false);
  await loadAll();
  toast('Cliente eliminado');
}

function openClient(id) {
  const c = state.clients.find(x => x.id === id);
  if (!c) return;
  $('modal-title').textContent = `${c.nombre}${c.cedula ? ' - ' + c.cedula : ''}`;
  const start = dayjs(c.fechaInicio);
  $('schedule-grid').innerHTML = c.calendario.map((s, i) => {
    const paid = Number(s.pagado || 0) >= Number(s.cuota || 0);
    const due = start.add(7 + i * 7, 'day').format('DD/MM/YYYY');
    return `
      <div class="week-card ${paid ? 'paid' : ''}">
        <strong>Semana ${i + 1}</strong>
        <span>Vence: ${due}</span><br />
        <span>Cuota: ${money(s.cuota)}</span><br />
        <span>Pagado: ${money(s.pagado)}</span><br />
        ${paid ? '<span class="badge ok">PAGADA</span>' : `<button data-pay-week="${c.id}:${i}">Pagar</button>`}
      </div>`;
  }).join('');
  $('payment-history').innerHTML = c.historial.length
    ? c.historial.slice().reverse().map(p => `<div class="history-row"><span>${dayjs(p.fecha).format('DD/MM/YYYY hh:mm A')}</span><strong>${money(p.monto)}</strong></div>`).join('')
    : '<p>Sin pagos registrados.</p>';
  $('client-modal').classList.remove('hidden');
}

function selectPaymentClient(client) {
  state.selectedClient = client;
  $('payment-search').value = client.nombre;
  $('payment-results').classList.add('hidden');
  const pending = client.calendario.find(s => Number(s.pagado || 0) < Number(s.cuota || 0));
  const suggested = pending ? Number(pending.cuota) - Number(pending.pagado || 0) : client.balance;
  $('payment-amount').value = Math.min(suggested, client.balance).toFixed(2);
  $('payment-info').textContent = `Balance: ${money(client.balance)}`;
}

function searchPaymentClients() {
  const q = $('payment-search').value.trim().toLowerCase();
  const box = $('payment-results');
  if (!q) {
    box.classList.add('hidden');
    return;
  }
  const matches = state.clients.filter(c => c.nombre.toLowerCase().includes(q) && c.balance > 0).slice(0, 10);
  box.innerHTML = matches.map(c => `<button data-select-payment="${c.id}">${c.nombre} (${money(c.balance)})</button>`).join('');
  box.classList.toggle('hidden', matches.length === 0);
}

async function registerPayment() {
  const c = state.selectedClient;
  const amount = Number($('payment-amount').value || 0);
  if (!c) return toast('Selecciona un cliente', false);
  if (amount <= 0) return toast('Monto invalido', false);
  if (!navigator.onLine) {
    queueOfflinePayment(c, amount);
    return;
  }
  await applyPayment(c, amount);
}

async function applyPayment(c, amount, queuedAt = null) {
  let remaining = amount;
  const schedule = c.calendario.map(s => ({ ...s }));
  for (const week of schedule) {
    const due = Number(week.cuota || 0) - Number(week.pagado || 0);
    if (due <= 0 || remaining <= 0) continue;
    const applied = Math.min(due, remaining);
    week.pagado = Number(week.pagado || 0) + applied;
    remaining -= applied;
  }

  const paidAt = queuedAt || new Date().toISOString();
  const previousBalance = c.balance;
  const newBalance = Math.max(0, c.balance - amount);
  const invoiceNumber = `SAN-${dayjs().format('YYYYMMDD-HHmmss')}`;
  const payments = [...c.historial, { fecha: paidAt, monto: amount, factura: invoiceNumber }];

  const updateRes = await state.supabase.from('clients').update({
    balance: newBalance,
    collected: c.cobrado + amount,
    schedule,
    payments
  }).eq('id', c.id);
  if (updateRes.error) return toast(updateRes.error.message, false);

  const invoice = {
    owner_id: state.user?.id || null,
    number: invoiceNumber,
    client_id: c.id,
    client_name: c.nombre,
    amount,
    previous_balance: previousBalance,
    new_balance: newBalance,
    paid_at: paidAt
  };
  const invoiceRes = await state.supabase.from('invoices').insert(invoice).select().single();
  if (invoiceRes.error) return toast(invoiceRes.error.message, false);

  state.lastInvoice = invoiceRes.data;
  await loadAll();
  state.selectedClient = null;
  $('payment-search').value = '';
  $('payment-amount').value = '';
  $('payment-info').textContent = '';
  showWhatsappReceipt({ ...c, balance: newBalance }, invoiceRes.data);
  toast('Pago registrado y factura generada');
}

function queueOfflinePayment(client, amount) {
  const pending = {
    id: crypto.randomUUID(),
    clientId: client.id,
    clientName: client.nombre,
    amount,
    createdAt: new Date().toISOString()
  };
  state.offlineQueue.push(pending);
  saveOfflineQueue();
  state.selectedClient = null;
  $('payment-search').value = '';
  $('payment-amount').value = '';
  $('payment-info').textContent = '';
  toast('Pago guardado offline. Se sincronizara al volver internet.');
}

async function syncOfflineQueue() {
  if (!navigator.onLine || !state.offlineQueue.length) return;
  setSyncStatus('Sincronizando cola...', true);
  const pending = [...state.offlineQueue];
  const failed = [];
  for (const item of pending) {
    const client = state.clients.find(c => c.id === item.clientId);
    if (!client) {
      failed.push(item);
      continue;
    }
    try {
      await applyPayment(client, item.amount, item.createdAt);
    } catch (err) {
      console.error(err);
      failed.push(item);
    }
  }
  state.offlineQueue = failed;
  saveOfflineQueue();
  if (!failed.length) toast('Cola offline sincronizada');
  await loadAll();
}

function showWhatsappReceipt(client, invoice) {
  $('whatsapp-message').textContent = `Recibo listo para ${client.nombre}`;
  $('whatsapp-box').classList.remove('hidden');
  $('send-receipt-whatsapp').onclick = () => {
    const number = sanitizePhone(client.telefono);
    if (!number) return toast('Cliente sin telefono de WhatsApp', false);
    const message = encodeURIComponent(
      `*SAN PRO - Recibo de Pago*\n\nCliente: ${client.nombre}\nFactura: ${invoice.number}\nFecha: ${dayjs(invoice.paid_at).format('DD/MM/YYYY hh:mm A')}\n\nMonto pagado: *${money(invoice.amount)}*\nNuevo balance: *${money(invoice.new_balance)}*\n\nGracias por pagar a tiempo.\nSAN PRO`
        .replace('Gracias por pagar a tiempo.\nSAN PRO', cfg().receiptFooter)
    );
    window.open(`https://wa.me/${number}?text=${message}`, '_blank');
  };
}

function printInvoice(invoice) {
  if (!invoice) return toast('No hay factura para imprimir', false);
  const logo = makeReceiptLogo();
  $('print-area').innerHTML = `
    <section class="receipt-page">
      <header>
        <img src="${logo}" alt="${cfg().businessName}" />
        <div>
          <h1>${cfg().businessName}</h1>
          <p>${cfg().businessTagline}</p>
        </div>
      </header>
      <div class="receipt-meta">
        <span>Factura <strong>${invoice.number}</strong></span>
        <span>${dayjs(invoice.paid_at).format('DD/MM/YYYY hh:mm A')}</span>
      </div>
      <h2>Recibo de Pago</h2>
      <div class="receipt-client">
        <span>Cliente</span>
        <strong>${invoice.client_name}</strong>
      </div>
      <div class="receipt-money">
        <div><span>Monto pagado</span><strong>${money(invoice.amount)}</strong></div>
        <div><span>Balance anterior</span><strong>${money(invoice.previous_balance)}</strong></div>
        <div><span>Nuevo balance</span><strong>${money(invoice.new_balance)}</strong></div>
      </div>
      <footer>${cfg().receiptFooter}</footer>
    </section>
  `;
  window.print();
}

function makeReceiptLogo() {
  const canvas = $('receipt-logo-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(12, 12, 56, 56);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Arial';
  ctx.fillText((cfg().businessName || 'SP').slice(0, 2).toUpperCase(), 21, 50);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 24px Arial';
  ctx.fillText(cfg().businessName, 80, 46);
  return canvas.toDataURL('image/png');
}

async function addCollector(name) {
  const clean = name.trim();
  if (!clean) return;
  const { error } = await state.supabase.from('collectors').insert({ name: clean, owner_id: state.user?.id || null });
  if (error) return toast(error.message, false);
  $('collector-name').value = '';
  await loadAll();
}

async function removeCollector(id) {
  const { error } = await state.supabase.from('collectors').delete().eq('id', id);
  if (error) return toast(error.message, false);
  await loadAll();
}

function exportBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    clients: state.clients,
    collectors: state.collectors,
    invoices: state.invoices
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  a.download = `sanpro_pwa_backup_${dayjs().format('YYYYMMDD')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportPremiumReport() {
  const buckets = clientBuckets();
  const report = {
    negocio: cfg().businessName,
    fecha: new Date().toISOString(),
    resumen: {
      prestado: state.clients.reduce((sum, c) => sum + c.monto, 0),
      cobrado: state.clients.reduce((sum, c) => sum + c.cobrado, 0),
      pendiente: state.clients.reduce((sum, c) => sum + c.balance, 0),
      clientes: state.clients.length,
      alDia: buckets.ok,
      morosos: buckets.late,
      pagados: buckets.paid,
      cobradoMes: monthCollected()
    },
    cobradores: [...new Set(state.clients.map(c => c.cobrador))].map(name => {
      const clients = state.clients.filter(c => c.cobrador === name);
      return {
        nombre: name,
        clientes: clients.length,
        cobrado: clients.reduce((sum, c) => sum + c.cobrado, 0),
        pendiente: clients.reduce((sum, c) => sum + c.balance, 0),
        morosos: clients.filter(c => loanStatus(c).text === 'MOROSO').length
      };
    })
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  a.download = `sanpro_reporte_premium_${dayjs().format('YYYYMMDD')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importBackup(file) {
  if (!file) return;
  if (!confirm('Importar este backup? Se agregaran los datos al sistema actual.')) return;
  const payload = JSON.parse(await file.text());
  if (Array.isArray(payload.collectors)) {
    for (const c of payload.collectors) {
      await state.supabase.from('collectors').upsert({ name: c.name || c.nombre, owner_id: state.user?.id || null }, { onConflict: 'name' });
    }
  }
  if (Array.isArray(payload.clients)) {
    for (const c of payload.clients) {
      const row = clientToRow(c);
      await state.supabase.from('clients').insert({ ...row, owner_id: state.user?.id || null });
    }
  }
  await loadAll();
  toast('Backup importado');
}

async function importMigration(file) {
  if (!file) return;
  const payload = JSON.parse(await file.text());
  const result = { collectors: 0, clients: 0 };
  if (Array.isArray(payload.collectors)) {
    for (const c of payload.collectors) {
      await state.supabase.from('collectors').upsert({ name: c.name || c.nombre, owner_id: state.user?.id || null }, { onConflict: 'name' });
      result.collectors++;
    }
  }
  const clients = Array.isArray(payload.clients) ? payload.clients : [];
  for (const c of clients) {
    await state.supabase.from('clients').insert({ ...clientToRow(c), owner_id: state.user?.id || null });
    result.clients++;
  }
  $('migration-result').classList.remove('hidden');
  $('migration-result').textContent = `Migracion completada: ${result.clients} clientes y ${result.collectors} cobradores.`;
  await loadAll();
}

async function requestNotifications() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

async function notifyDuePayments() {
  const allowed = await requestNotifications();
  if (!allowed) return;
  const due = state.clients.filter(c => c.balance > 0 && !dayjs().isBefore(nextDueDate(c), 'day'));
  if (!due.length) return;
  const title = `${due.length} cobro(s) vencidos`;
  const body = due.slice(0, 3).map(c => c.nombre).join(', ') + (due.length > 3 ? '...' : '');
  if (navigator.serviceWorker?.ready) {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, { body, icon: './assets/icon.svg', badge: './assets/icon.svg' });
  } else {
    new Notification(title, { body });
  }
}

async function verifyLicense() {
  const installationId = getInstallationId();
  $('installation-id').textContent = installationId;
  const { data, error } = await state.supabase.from('licenses').select('*').eq('installation_id', installationId).maybeSingle();
  if (error) throw error;
  if (!data) {
    const trialUntil = dayjs().add(30, 'day').format('YYYY-MM-DD');
    const insert = await state.supabase.from('licenses').insert({ installation_id: installationId, valid_until: trialUntil, status: 'trial', owner_id: state.user?.id || null });
    if (insert.error) throw insert.error;
    toast(`Modo prueba activo hasta ${dayjs(trialUntil).format('DD/MM/YYYY')}`);
    return true;
  }
  if (dayjs().isAfter(dayjs(data.valid_until).endOf('day'))) {
    showScreen('license-screen');
    return false;
  }
  if (data.status === 'trial') toast(`Modo prueba activo hasta ${dayjs(data.valid_until).format('DD/MM/YYYY')}`);
  return true;
}

async function activateLicense() {
  const key = $('license-key').value.trim();
  const installationId = getInstallationId();
  const tail = installationId.replaceAll('-', '').slice(0, 8);
  const match = key.match(/^SANPRO\d{4}-(\d{4}-\d{2}-\d{2})-([a-f0-9]{8})$/i);
  if (!match) return toast('Formato de clave invalido', false);
  if (match[2].toLowerCase() !== tail.toLowerCase()) return toast('Esta clave no corresponde a esta instalacion', false);
  if (!dayjs(match[1], 'YYYY-MM-DD', true).isValid() || dayjs(match[1]).isBefore(dayjs(), 'day')) {
    return toast('Fecha de licencia invalida o vencida', false);
  }
  const payload = {
    owner_id: state.user?.id || null,
    installation_id: installationId,
    license_key: key,
    valid_until: match[1],
    status: 'active'
  };
  const existing = await state.supabase.from('licenses').select('id').eq('installation_id', installationId).maybeSingle();
  if (existing.error) return toast(existing.error.message, false);
  const result = existing.data
    ? await state.supabase.from('licenses').update(payload).eq('id', existing.data.id)
    : await state.supabase.from('licenses').insert(payload);
  if (result.error) return toast(result.error.message, false);
  toast('Licencia activada');
  await startApp();
}

async function loadSession() {
  const { data, error } = await state.supabase.auth.getSession();
  if (error) throw error;
  state.user = data.session?.user || null;
  return state.user;
}

async function loadProfile() {
  if (!state.user) return null;
  let { data, error } = await state.supabase.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const insert = await state.supabase.from('profiles').insert({
      id: state.user.id,
      full_name: state.user.user_metadata?.full_name || state.user.email?.split('@')[0] || 'Usuario',
      role: 'owner'
    }).select().single();
    if (insert.error) throw insert.error;
    data = insert.data;
  }
  state.profile = data;
  $('user-role').textContent = data.role;
  document.body.dataset.role = data.role;
  return data;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === 'signup';
  $('auth-copy').textContent = signup ? 'Crea tu cuenta principal del negocio.' : 'Inicia sesion para sincronizar tu negocio.';
  $('auth-submit').textContent = signup ? 'Crear cuenta' : 'Entrar';
  $('auth-toggle').textContent = signup ? 'Ya tengo cuenta' : 'Crear cuenta nueva';
  $('auth-name').classList.toggle('hidden', !signup);
  $('auth-name-label').classList.toggle('hidden', !signup);
}

async function submitAuth() {
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email || password.length < 6) return toast('Correo y contrasena validos son requeridos', false);
  if (state.authMode === 'signup') {
    const { error } = await state.supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: $('auth-name').value.trim() } }
    });
    if (error) return toast(error.message, false);
    toast('Cuenta creada. Si Supabase pide confirmacion, revisa tu correo.');
  } else {
    const { error } = await state.supabase.auth.signInWithPassword({ email, password });
    if (error) return toast(error.message, false);
  }
  await continueAfterAuth();
}

async function continueAfterAuth() {
  await loadSession();
  if (!state.user) {
    setAuthMode('login');
    showScreen('login-screen');
    return;
  }
  await loadProfile();
  await loadSettings();
  const pinConfig = await getConfigValue('pin_hash');
  $('pin-title').textContent = pinConfig ? 'Ingrese PIN' : 'Crear PIN';
  $('pin-submit').textContent = pinConfig ? 'Entrar' : 'Guardar PIN';
  showScreen('pin-screen');
  $('pin-input').focus();
}

async function handlePin() {
  const pin = $('pin-input').value.trim();
  if (pin.length < 6) return toast('El PIN debe tener al menos 6 digitos', false);
  const pinConfig = await getConfigValue('pin_hash');
  const hash = await sha256(pin);
  if (!pinConfig) {
    await setConfigValue('pin_hash', { hash });
    toast('PIN creado');
    await startApp();
    return;
  }
  if (pinConfig.hash !== hash) return toast('PIN incorrecto', false);
  await startApp();
}

async function startApp() {
  showScreen('app');
  const valid = await verifyLicense();
  if (!valid) return;
  await loadAll();
  await notifyDuePayments();
  await syncOfflineQueue();
  if (state.profile?.role === 'collector') activateTab('collector-mobile');
}

async function boot() {
  if (!hasSupabaseConfig()) {
    showSetup();
    return;
  }
  initSupabase();

  if (localStorage.getItem('sanpro_terms_accepted') !== 'true') {
    showScreen('terms-screen');
    return;
  }

  await loadSession();
  if (!state.user) {
    setAuthMode('login');
    showScreen('login-screen');
    return;
  }
  await loadProfile();
  await loadSettings();
  await loadPlan();
  loadOfflineQueue();
  $('loan-date').value = today();
  await continueAfterAuth();
}

function bindEvents() {
  $('save-config').onclick = () => {
    const supabaseUrl = $('setup-url').value.trim();
    const supabaseAnonKey = $('setup-key').value.trim();
    try {
      const parsed = new URL(supabaseUrl);
      if (!parsed.hostname.endsWith('.supabase.co')) throw new Error();
    } catch {
      toast('La URL de Supabase no parece valida', false);
      $('setup-url').focus();
      return;
    }
    if (supabaseAnonKey.length < 40) {
      toast('La anon key parece incompleta', false);
      $('setup-key').focus();
      return;
    }
    localStorage.setItem('sanpro_supabase_config', JSON.stringify({
      supabaseUrl,
      supabaseAnonKey
    }));
    location.reload();
  };
  $('accept-terms').onclick = () => {
    localStorage.setItem('sanpro_terms_accepted', 'true');
    boot().catch(err => toast(err.message, false));
  };
  $('reject-terms').onclick = () => toast('Debe aceptar los terminos para usar SAN PRO', false);
  $('auth-submit').onclick = () => submitAuth().catch(err => toast(err.message, false));
  $('auth-toggle').onclick = () => setAuthMode(state.authMode === 'login' ? 'signup' : 'login');
  ['auth-email', 'auth-password', 'auth-name'].forEach(id => {
    $(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') submitAuth().catch(err => toast(err.message, false));
    });
  });
  $('pin-submit').onclick = () => handlePin().catch(err => toast(err.message, false));
  $('pin-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handlePin().catch(err => toast(err.message, false));
  });
  $('activate-license').onclick = () => activateLicense().catch(err => toast(err.message, false));
  $('copy-installation').onclick = async () => {
    await navigator.clipboard.writeText(getInstallationId());
    toast('ID copiado');
  };
  $('send-license-whatsapp').onclick = () => {
    const msg = encodeURIComponent(`Hola Sandy,\nEste es mi ID unico de licencia:\n${getInstallationId()}\n\nGracias por ayudarme a activar SAN PRO.`);
    window.open(`https://wa.me/${cfg().developerWhatsApp}?text=${msg}`, '_blank');
  };

  $$('.tabs button').forEach(btn => {
    btn.onclick = () => activateTab(btn.dataset.tab);
  });
  $$('.mobile-nav button').forEach(btn => {
    btn.onclick = () => activateTab(btn.dataset.mobileTab);
  });

  ['search-client', 'filter-status', 'filter-collector', 'filter-from', 'filter-to'].forEach(id => {
    $(id).addEventListener('input', renderClients);
    $(id).addEventListener('change', renderClients);
  });
  $('clear-filters').onclick = () => {
    ['search-client', 'filter-status', 'filter-collector', 'filter-from', 'filter-to'].forEach(id => $(id).value = '');
    renderClients();
  };

  ['loan-type', 'loan-amount', 'loan-interest', 'loan-weeks', 'loan-fee'].forEach(id => $(id).addEventListener('input', updatePreview));
  $('loan-type').addEventListener('change', updatePreview);
  ['loan-interest', 'loan-weeks'].forEach(id => $(id).addEventListener('input', () => { $(id).dataset.touched = 'true'; }));
  $('loan-form').addEventListener('submit', e => saveLoan(e).catch(err => toast(err.message, false)));
  $('clients-body').onclick = e => {
    const view = e.target.closest('[data-view]')?.dataset.view;
    const del = e.target.closest('[data-delete]')?.dataset.delete;
    if (view) openClient(view);
    if (del) deleteClient(del).catch(err => toast(err.message, false));
  };
  document.body.addEventListener('click', e => {
    if (e.target.matches('[data-close-modal]')) e.target.closest('.modal')?.classList.add('hidden');
    const payWeek = e.target.closest('[data-pay-week]')?.dataset.payWeek;
    if (payWeek) {
      const [id, idx] = payWeek.split(':');
      const c = state.clients.find(x => x.id === id);
      if (c) {
        $('client-modal').classList.add('hidden');
        $$('.tabs button[data-tab="payments"]')[0].click();
        selectPaymentClient(c);
        const week = c.calendario[Number(idx)];
        $('payment-amount').value = Math.max(0, Number(week.cuota) - Number(week.pagado || 0)).toFixed(2);
      }
    }
    const selectId = e.target.closest('[data-select-payment]')?.dataset.selectPayment;
    if (selectId) selectPaymentClient(state.clients.find(c => c.id === selectId));
    const mobilePayId = e.target.closest('[data-mobile-pay]')?.dataset.mobilePay;
    if (mobilePayId) {
      const client = state.clients.find(c => c.id === mobilePayId);
      if (client) {
        activateTab('payments');
        selectPaymentClient(client);
      }
    }
    const mobileViewId = e.target.closest('[data-mobile-view]')?.dataset.mobileView;
    if (mobileViewId) openClient(mobileViewId);
    const removeCollectorId = e.target.closest('[data-remove-collector]')?.dataset.removeCollector;
    if (removeCollectorId) removeCollector(removeCollectorId).catch(err => toast(err.message, false));
    const printId = e.target.closest('[data-print-invoice]')?.dataset.printInvoice;
    if (printId) printInvoice(state.invoices.find(i => i.id === printId));
    const saveUserId = e.target.closest('[data-save-user]')?.dataset.saveUser;
    if (saveUserId) saveUserProfile(saveUserId).catch(err => toast(err.message, false));
  });

  $('payment-search').addEventListener('input', searchPaymentClients);
  $('mobile-client-search').addEventListener('input', renderMobileCollector);
  $('register-payment').onclick = () => registerPayment().catch(err => toast(err.message, false));
  $('print-last-invoice').onclick = () => printInvoice(state.lastInvoice || state.invoices[0]);
  $('collector-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCollector(e.target.value).catch(err => toast(err.message, false));
  });
  $('admin-add-collector').onclick = () => addCollector($('admin-collector-name').value).then(() => {
    $('admin-collector-name').value = '';
  }).catch(err => toast(err.message, false));
  $('export-backup').onclick = exportBackup;
  $('import-backup').onchange = e => importBackup(e.target.files[0]).catch(err => toast(err.message, false));
  $('migration-file').onchange = e => importMigration(e.target.files[0]).catch(err => toast(err.message, false));
  $('show-installation').onclick = async () => {
    await navigator.clipboard.writeText(getInstallationId());
    alert(`Tu ID unico de licencia es:\n\n${getInstallationId()}\n\nYa fue copiado al portapapeles.`);
  };
  $('open-donation').onclick = () => $('donation-modal').classList.remove('hidden');
  $('copy-bank').onclick = async () => {
    await navigator.clipboard.writeText(cfg().bankAccount);
    toast('Cuenta copiada');
  };
  $('logout').onclick = async () => {
    await state.supabase.auth.signOut();
    state.user = null;
    state.profile = null;
    state.clients = [];
    setAuthMode('login');
    showScreen('login-screen');
  };
  $$('[data-jump-tab]').forEach(btn => {
    btn.onclick = () => activateTab(btn.dataset.jumpTab);
  });
  $('save-settings').onclick = () => saveSettings().catch(err => toast(err.message, false));
  $('reset-settings').onclick = async () => {
    state.settings = {};
    localStorage.removeItem('sanpro_business_settings');
    await setConfigValue('business_settings', {});
    applySettings();
    renderAll();
    toast('Ajustes restaurados');
  };
  $('export-report').onclick = exportPremiumReport;
  $('refresh-users').onclick = () => loadProfiles().catch(err => toast(err.message, false));
  $('refresh-plan').onclick = () => loadPlan().catch(err => toast(err.message, false));
  document.body.addEventListener('click', e => {
    const selectedPlan = e.target.closest('[data-select-plan]')?.dataset.selectPlan;
    if (selectedPlan) savePlan(selectedPlan).catch(err => toast(err.message, false));
  });
  window.addEventListener('online', () => syncOfflineQueue().catch(err => toast(err.message, false)));
  window.addEventListener('offline', () => setSyncStatus('Offline', false));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

bindEvents();
boot().catch(err => {
  console.error(err);
  showSetup('No se pudo conectar. Revisa la URL y la anon key.');
});
