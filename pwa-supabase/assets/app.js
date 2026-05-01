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
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));
const attr = value => escapeHtml(value);
const today = () => dayjs().format('YYYY-MM-DD');
const roundMoney = n => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const makeInviteCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
const teamOwnerId = () => state.profile?.business_owner_id || state.profile?.id || state.user?.id || null;
const offlineQueueKey = () => `sanpro_offline_queue:${teamOwnerId() || 'local'}`;
const collectorTabs = ['dashboard', 'clients', 'new-loan', 'payments', 'invoices', 'collector-mobile'];

function canUseTab(tabId) {
  return state.profile?.role !== 'collector' || collectorTabs.includes(tabId);
}

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
  const targetTab = canUseTab(tabId) ? tabId : 'collector-mobile';
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === targetTab));
  $$('.mobile-nav button').forEach(b => b.classList.toggle('active', b.dataset.mobileTab === targetTab));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === targetTab));
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

function allowManualSupabaseSetup() {
  return ['localhost', '127.0.0.1', ''].includes(location.hostname) || location.protocol === 'file:';
}

function showSetup(message = '') {
  if (!allowManualSupabaseSetup()) {
    const card = document.querySelector('#setup-screen .auth-card');
    if (card) {
      card.innerHTML = `
        <h1>SAN PRO</h1>
        <p>La configuracion de Supabase no esta disponible.</p>
        <small>Revisa las variables SANPRO_SUPABASE_URL y SANPRO_SUPABASE_ANON_KEY en Vercel y vuelve a desplegar.</small>
      `;
    }
    showScreen('setup-screen');
    if (message) toast(message, false);
    return;
  }
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
  const ownerId = teamOwnerId();
  const scopedKey = ownerId ? `${ownerId}:${key}` : key;
  if (ownerId) {
    const own = await state.supabase.from('app_config').select('value').eq('key', scopedKey).maybeSingle();
    if (own.error) throw own.error;
    if (own.data) return own.data.value;
  }
  const { data, error } = await state.supabase.from('app_config').select('value').eq('key', key).is('owner_id', null).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function setConfigValue(key, value) {
  const ownerId = teamOwnerId();
  const scopedKey = ownerId ? `${ownerId}:${key}` : key;
  const { error } = await state.supabase.from('app_config').upsert({ key: scopedKey, value, owner_id: ownerId });
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
    state.offlineQueue = JSON.parse(localStorage.getItem(offlineQueueKey()) || '[]');
  } catch {
    state.offlineQueue = [];
  }
}

function saveOfflineQueue() {
  localStorage.setItem(offlineQueueKey(), JSON.stringify(state.offlineQueue));
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
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

function periodUnit(clientOrType) {
  const type = typeof clientOrType === 'string' ? clientOrType : clientOrType?.tipo;
  return type === 'redito' ? 'month' : 'week';
}

function periodLabel(clientOrType, index) {
  return periodUnit(clientOrType) === 'month' ? `Mes ${index + 1}` : `Semana ${index + 1}`;
}

function periodDueDate(client, index) {
  const unit = periodUnit(client);
  return dayjs(client.fechaInicio).add(index + 1, unit);
}

function paidPeriodCount(client) {
  return client.calendario.filter(s => Number(s.pagado || 0) >= Number(s.cuota || 0)).length;
}

function loanStatus(c) {
  if (c.balance <= 0) return { text: 'PAGADO', cls: 'done', next: '-' };
  const unit = periodUnit(c);
  const firstDue = periodDueDate(c, 0);
  const elapsed = Math.floor(dayjs().diff(firstDue, unit));
  const expected = Math.max(0, elapsed + 1);
  const paidPeriods = paidPeriodCount(c);
  const late = expected - paidPeriods;
  const nextDate = periodDueDate(c, paidPeriods).format('DD/MM/YYYY');
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
  const principal = amount + fee;
  const periodInterest = roundMoney(principal * interest / 100);
  const total = type === 'redito'
    ? principal + (periodInterest * weeks)
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
  $('calc-total-label').textContent = calc.type === 'redito' ? 'Total proyectado' : 'Total a cobrar';
  $('calc-period-label').textContent = calc.type === 'redito' ? 'Redito mensual' : 'Cuota semanal';
  $('calc-profit-label').textContent = calc.type === 'redito' ? 'Ganancia proyectada' : 'Ganancia';
  $('loan-interest').placeholder = calc.type === 'redito' ? 'Interes mensual %' : 'Interes %';
  $('loan-weeks').placeholder = calc.type === 'redito' ? 'Meses estimados' : 'Semanas';
  $('loan-type-help').textContent = calc.type === 'redito'
    ? 'Tipo Redito: cobra interes mensual sobre el capital pendiente. Si solo paga redito, el capital queda igual; si paga mas, el excedente baja capital.'
    : 'Tipo San: capital, interes y cargos se reparten en cuotas fijas.';
}

function normalizeReditoWeek(week) {
  const interest = Number(week.interes || 0);
  const paid = Number(week.pagado || 0);
  const paidInterest = Number.isFinite(Number(week.pagoInteres))
    ? Number(week.pagoInteres)
    : Math.min(paid, interest);
  const paidCapital = Number.isFinite(Number(week.pagoCapital))
    ? Number(week.pagoCapital)
    : Math.max(0, paid - interest);
  return {
    ...week,
    pagoInteres: roundMoney(paidInterest),
    pagoCapital: roundMoney(paidCapital)
  };
}

function recalculateReditoSchedule(client, sourceSchedule = client.calendario, options = {}) {
  const weeks = Math.max(1, Number(client.semanas || 0), sourceSchedule.length || 0);
  const rate = Number(client.interes || 0) / 100;
  const principalTotal = roundMoney(Number(client.monto || 0) + Number(client.cargo || 0));
  const oldSchedule = Array.from({ length: weeks }, (_, i) => normalizeReditoWeek(sourceSchedule[i] || {}));
  let principalRemaining = principalTotal;

  let schedule = oldSchedule.map((week, index) => {
    const paidCapital = roundMoney(Math.min(Number(week.pagoCapital || 0), principalRemaining));
    const recalculatedInterest = roundMoney(principalRemaining * rate);
    const paidInterest = roundMoney(Math.min(Number(week.pagoInteres || 0), Math.max(recalculatedInterest, Number(week.pagoInteres || 0))));
    const next = {
      ...week,
      tipo: 'redito',
      capitalBase: principalTotal,
      interes: recalculatedInterest,
      capital: 0,
      cuota: recalculatedInterest,
      pagoInteres: paidInterest,
      pagoCapital: paidCapital,
      pagado: roundMoney(paidInterest + paidCapital)
    };
    principalRemaining = roundMoney(principalRemaining - paidCapital);
    return next;
  });

  const interestPeriodsPaid = schedule.every(week => Number(week.pagoInteres || 0) >= Number(week.interes || 0));
  if (options.extendIfCurrentPaid && principalRemaining > 0.009 && interestPeriodsPaid) {
    schedule.push({
      tipo: 'redito',
      capitalBase: principalTotal,
      interes: roundMoney(principalRemaining * rate),
      capital: 0,
      cuota: roundMoney(principalRemaining * rate),
      pagado: 0,
      pagoInteres: 0,
      pagoCapital: 0
    });
  }

  return schedule;
}

function reditoBalance(schedule, client = null) {
  const principalPaid = roundMoney(schedule.reduce((sum, week) => sum + Number(week.pagoCapital || 0), 0));
  const principalTotal = client
    ? roundMoney(Number(client.monto || 0) + Number(client.cargo || 0))
    : roundMoney(schedule.reduce((max, week) => Math.max(max, Number(week.capitalBase || 0), Number(week.capital || 0)), 0));
  const scheduleBalance = roundMoney(schedule.reduce((sum, week) => {
    const dueInterest = Number(week.interes || 0) - Number(week.pagoInteres || 0);
    return sum + Math.max(0, dueInterest);
  }, 0));
  return roundMoney(scheduleBalance + Math.max(0, principalTotal - principalPaid));
}

function reditoProjectedTotal(schedule) {
  return roundMoney(schedule.reduce((sum, week) => sum + Number(week.interes || 0), 0));
}

function reditoPaymentSummary(client) {
  const schedule = recalculateReditoSchedule(client);
  const principalTotal = roundMoney(Number(client.monto || 0) + Number(client.cargo || 0));
  const principalPaid = roundMoney(schedule.reduce((sum, week) => sum + Number(week.pagoCapital || 0), 0));
  const principalPending = Math.max(0, roundMoney(principalTotal - principalPaid));
  const pending = schedule.find(week => Number(week.cuota || 0) - Number(week.pagado || 0) > 0.009);
  const interestDue = pending
    ? Math.max(0, roundMoney(Number(pending.interes || 0) - Number(pending.pagoInteres || 0)))
    : 0;

  return {
    schedule,
    principalPending,
    interestDue,
    currentDue: pending ? Math.max(0, roundMoney(Number(pending.cuota || 0) - Number(pending.pagado || 0))) : 0
  };
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
  return periodDueDate(client, paidPeriodCount(client));
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
      <span class="dot ${attr(item.status.cls)}"></span>
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
  renderTeamSummary();
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
  if ($('business-invite-code')) {
    $('business-invite-code').textContent = state.profile?.invite_code || '---';
  }
}

function renderPlan() {
  if (!$('plan-status')) return;
  const plan = state.plan?.plan || 'basic';
  const limit = planLimits[plan]?.clients ?? 25;
  $('plan-status').innerHTML = `
    <span>Plan: <strong>${escapeHtml(planLimits[plan]?.label || plan)}</strong></span>
    <span>Estado: <strong>${escapeHtml(state.plan?.status || 'trial')}</strong></span>
    <span>Clientes: <strong>${state.clients.length}/${limit === Infinity ? 'Ilimitado' : limit}</strong></span>
    <span>Vence: <strong>${state.plan?.validUntil ? dayjs(state.plan.validUntil).format('DD/MM/YYYY') : '-'}</strong></span>
  `;
}

async function saveUserProfile(id) {
  const role = document.querySelector(`[data-user-role="${id}"]`)?.value || 'viewer';
  const collectorName = document.querySelector(`[data-user-collector="${id}"]`)?.value || null;
  const target = state.profiles.find(p => p.id === id);
  const privilegedRoles = ['owner', 'admin'];
  const privilegedCount = state.profiles.filter(p => privilegedRoles.includes(p.role) && p.active).length;
  const isRemovingPrivilegedRole = privilegedRoles.includes(target?.role) && !privilegedRoles.includes(role);

  if (id === state.user?.id && isRemovingPrivilegedRole) {
    toast('No puedes quitarte tu propio acceso admin desde esta pantalla.', false);
    return;
  }
  if (isRemovingPrivilegedRole && privilegedCount <= 1) {
    toast('Debe quedar al menos un owner o admin activo.', false);
    return;
  }
  if (role === 'collector' && !collectorName) {
    toast('Asigna un cobrador antes de guardar el rol collector.', false);
    return;
  }

  const { error } = await state.supabase.from('profiles').update({
    role,
    collector_name: collectorName,
    business_owner_id: teamOwnerId()
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
  const canDelete = ['owner', 'admin'].includes(state.profile?.role);
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
          ${canDelete ? `<button class="danger" data-delete="${c.id}">Eliminar</button>` : ''}
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="11">No hay clientes para mostrar.</td></tr>';
}

function clearClientFilters() {
  ['search-client', 'filter-status', 'filter-collector', 'filter-from', 'filter-to'].forEach(id => {
    if ($(id)) $(id).value = '';
  });
}

function renderClientFilters() {
  const collectors = [...new Set([...state.collectors.map(c => c.name), ...state.clients.map(c => c.cobrador)])].filter(Boolean).sort();
  if (state.profile?.role === 'collector') {
    const assigned = state.profile.collector_name || collectors[0] || '';
    $('filter-collector').innerHTML = assigned ? `<option value="${assigned}">${assigned}</option>` : '<option value="">Sin cobrador asignado</option>';
    $('filter-collector').value = assigned;
    $('loan-collector').innerHTML = assigned ? `<option value="${assigned}">${assigned}</option>` : '<option value="">Sin cobrador asignado</option>';
    $('loan-collector').value = assigned;
    return;
  }
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
      <td>
        <button data-print-invoice="${i.id}">Imprimir</button>
        <button data-whatsapp-invoice="${i.id}" class="success">WhatsApp</button>
      </td>
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
  if (state.profile?.role === 'collector' && !state.profile.collector_name) {
    toast('Tu usuario no tiene un cobrador asignado. Pide al admin que lo asigne.', false);
    return;
  }
  const calc = calculateLoan();
  const startDate = $('loan-date').value || today();
  const schedule = Array.from({ length: calc.weeks }, () => ({ cuota: calc.weekly, pagado: 0 }));
  let total = calc.total;
  let balance = calc.total;
  if (calc.type === 'redito' && schedule.length) {
    schedule.forEach((week, index) => {
      week.tipo = 'redito';
      week.capitalBase = calc.amount + calc.fee;
      week.interes = calc.weekly;
      week.capital = 0;
      week.pagoInteres = 0;
      week.pagoCapital = 0;
      week.cuota = calc.weekly;
    });
    total = roundMoney(calc.amount + calc.fee + reditoProjectedTotal(schedule));
    balance = reditoBalance(schedule);
  }
  const client = {
    tipo: calc.type,
    nombre: $('loan-name').value.trim(),
    telefono: $('loan-phone').value.trim(),
    cedula: $('loan-document').value.trim(),
    cobrador: state.profile?.role === 'collector' ? state.profile.collector_name : $('loan-collector').value,
    monto: calc.amount,
    interes: calc.interest,
    semanas: calc.weeks,
    cargo: calc.fee,
    fechaInicio: startDate,
    total,
    balance,
    cobrado: 0,
    calendario: schedule,
    historial: []
  };
  const row = { ...clientToRow(client), owner_id: teamOwnerId() };
  const insertRes = await state.supabase.from('clients').insert(row).select('*').single();
  if (insertRes.error) return toast(insertRes.error.message, false);
  if (!insertRes.data?.id) return toast('Supabase no devolvio el prestamo guardado. Revisa las politicas RLS.', false);
  $('loan-form').reset();
  $('loan-type').value = 'san';
  $('loan-interest').value = cfg().defaultInterest;
  $('loan-weeks').value = cfg().defaultWeeks;
  $('loan-fee').value = 0;
  $('loan-date').value = today();
  await loadAll();
  clearClientFilters();
  renderClients();
  activateTab('clients');
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
  const redSummary = c.tipo === 'redito' ? reditoPaymentSummary(c) : null;
  const displaySchedule = redSummary?.schedule || c.calendario;
  $('schedule-grid').innerHTML = displaySchedule.map((s, i) => {
    const paid = Number(s.pagado || 0) >= Number(s.cuota || 0);
    const due = periodDueDate(c, i).format('DD/MM/YYYY');
    const amountLabel = c.tipo === 'redito' ? 'Rédito' : 'Cuota';
    return `
      <div class="week-card ${paid ? 'paid' : ''}">
        <strong>${periodLabel(c, i)}</strong>
        <span>Vence: ${due}</span><br />
        <span>${amountLabel}: ${money(s.cuota)}</span><br />
        <span>Pagado: ${money(s.pagado)}</span><br />
        ${paid ? '<span class="badge ok">PAGADO</span>' : `<button data-pay-week="${c.id}:${i}">Cobrar</button>`}
      </div>`;
  }).join('') + (redSummary ? `
    <div class="week-card principal-card">
      <strong>Capital pendiente</strong>
      <span>${money(redSummary.principalPending)}</span><br />
      <small>El capital baja solo cuando el cliente paga más que el rédito mensual.</small>
    </div>
  ` : '');
  $('payment-history').innerHTML = c.historial.length
    ? c.historial.slice().reverse().map(p => `<div class="history-row"><span>${dayjs(p.fecha).format('DD/MM/YYYY hh:mm A')}</span><strong>${money(p.monto)}</strong></div>`).join('')
    : '<p>Sin pagos registrados.</p>';
  $('client-modal').classList.remove('hidden');
}

function selectPaymentClient(client) {
  state.selectedClient = client;
  $('payment-search').value = client.nombre;
  $('payment-results').classList.add('hidden');

  if (client.tipo === 'redito') {
    const summary = reditoPaymentSummary(client);
    const suggested = summary.interestDue > 0 ? summary.interestDue : Math.min(summary.currentDue || client.balance, client.balance);
    $('payment-amount').value = Math.min(suggested, client.balance).toFixed(2);
    $('payment-info').innerHTML = `
      <div class="redito-payment-help">
        <span>Rédito actual <strong>${money(summary.interestDue)}</strong></span>
        <span>Capital pendiente <strong>${money(summary.principalPending)}</strong></span>
        <small>Si paga más de ${money(summary.interestDue)}, el excedente se abonará a capital.</small>
      </div>
    `;
    return;
  }

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

function applyReditoPaymentToSchedule(c, amount) {
  let remaining = roundMoney(amount);
  let schedule = recalculateReditoSchedule(c);
  const activeIndex = schedule.findIndex(week => Number(week.cuota || 0) - Number(week.pagado || 0) > 0.009);
  const index = activeIndex >= 0 ? activeIndex : schedule.length - 1;
  const week = schedule[index];

  const dueInterest = Math.max(0, Number(week.interes || 0) - Number(week.pagoInteres || 0));
  const interestApplied = roundMoney(Math.min(dueInterest, remaining));
  week.pagoInteres = roundMoney(Number(week.pagoInteres || 0) + interestApplied);
  remaining = roundMoney(remaining - interestApplied);

  const principalTotal = roundMoney(Number(c.monto || 0) + Number(c.cargo || 0));
  const principalPaid = roundMoney(schedule.reduce((sum, item) => sum + Number(item.pagoCapital || 0), 0));
  const principalRemaining = Math.max(0, roundMoney(principalTotal - principalPaid));
  const capitalApplied = roundMoney(Math.min(principalRemaining, remaining));
  if (capitalApplied > 0) {
    week.pagoCapital = roundMoney(Number(week.pagoCapital || 0) + capitalApplied);
    remaining = roundMoney(remaining - capitalApplied);
  }
  week.pagado = roundMoney(Number(week.pagoInteres || 0) + Number(week.pagoCapital || 0));

  schedule = recalculateReditoSchedule(c, schedule, { extendIfCurrentPaid: true });
  return {
    schedule,
    balance: reditoBalance(schedule, c),
    total: roundMoney(Number(c.monto || 0) + Number(c.cargo || 0) + reditoProjectedTotal(schedule)),
    pagoInteres: interestApplied,
    pagoCapital: capitalApplied,
    sobrante: remaining
  };
}

function clientPaymentProgress(client) {
  const periods = Number(client?.calendario?.length || client?.semanas || 0);
  const paidPeriods = paidPeriodCount(client || { calendario: [] });
  return {
    paidPeriods,
    remainingPeriods: Math.max(0, periods - paidPeriods),
    periods,
    label: periodUnit(client) === 'month' ? 'Meses restantes' : 'Semanas restantes'
  };
}

function findInvoiceClient(invoice) {
  return state.clients.find(c => c.id === invoice?.client_id) || state.clients.find(c => c.nombre === invoice?.client_name) || null;
}

function invoiceDetails(invoice, client) {
  if (invoice?.payment_details) return invoice.payment_details;
  return (client?.historial || []).find(payment => payment.factura === invoice?.number) || {};
}

function buildReceiptMessage(client, invoice) {
  const progress = clientPaymentProgress(client);
  const details = invoiceDetails(invoice, client);
  const lines = [
    `*${cfg().businessName} - Recibo de Pago*`,
    '',
    `Cliente: ${invoice.client_name || client?.nombre || 'Cliente'}`,
    `Factura: ${invoice.number}`,
    `Fecha: ${dayjs(invoice.paid_at).format('DD/MM/YYYY hh:mm A')}`,
    '',
    `Monto pagado: *${money(invoice.amount)}*`,
    `Balance anterior: *${money(invoice.previous_balance)}*`,
    `Balance pendiente: *${money(invoice.new_balance)}*`
  ];

  if (Number(details.pagoInteres || 0) > 0 || Number(details.pagoCapital || 0) > 0) {
    lines.push(`Aplicado a interes: *${money(details.pagoInteres || 0)}*`);
    lines.push(`Aplicado a capital: *${money(details.pagoCapital || 0)}*`);
  }

  if (progress.periods) {
    lines.push(`${progress.label}: *${progress.remainingPeriods} de ${progress.periods}*`);
  }

  lines.push('');
  lines.push(Number(invoice.new_balance || 0) <= 0 ? 'Prestamo saldado. Gracias por cumplir.' : cfg().receiptFooter);
  return lines.join('\n');
}

function sendInvoiceWhatsapp(invoice, client = findInvoiceClient(invoice)) {
  if (!invoice) return toast('No hay factura para enviar', false);
  if (!client) return toast('No se encontro el cliente de esta factura', false);
  const number = sanitizePhone(client.telefono);
  if (!number) return toast('Cliente sin telefono de WhatsApp', false);
  const message = encodeURIComponent(buildReceiptMessage(client, invoice));
  window.open(`https://wa.me/${number}?text=${message}`, '_blank');
  $('whatsapp-box')?.classList.add('hidden');
  toast('WhatsApp abierto con recibo listo para enviar');
}

async function applyPayment(c, amount, queuedAt = null) {
  const paidAt = queuedAt || new Date().toISOString();
  const previousBalance = c.balance;
  let schedule = c.calendario.map(s => ({ ...s }));
  let newBalance = Math.max(0, c.balance - amount);
  let newTotal = c.total;
  let paymentBreakdown = {};

  if (c.tipo === 'redito') {
    const result = applyReditoPaymentToSchedule(c, amount);
    schedule = result.schedule;
    newBalance = result.balance;
    newTotal = result.total;
    paymentBreakdown = {
      pagoInteres: result.pagoInteres,
      pagoCapital: result.pagoCapital,
      sobrante: result.sobrante
    };
  } else {
    let remaining = amount;
    for (const week of schedule) {
      const due = Number(week.cuota || 0) - Number(week.pagado || 0);
      if (due <= 0 || remaining <= 0) continue;
      const applied = Math.min(due, remaining);
      week.pagado = Number(week.pagado || 0) + applied;
      remaining -= applied;
    }
  }

  const paymentId = crypto.randomUUID();
  const invoiceNumber = `SAN-${dayjs().format('YYYYMMDD-HHmmss')}-${paymentId.slice(0, 6).toUpperCase()}`;
  const payments = [...c.historial, { fecha: paidAt, monto: amount, factura: invoiceNumber, ...paymentBreakdown }];

  const invoiceRes = await state.supabase.rpc('register_payment', {
    p_client_id: c.id,
    p_payment_id: paymentId,
    p_invoice_number: invoiceNumber,
    p_amount: amount,
    p_new_balance: newBalance,
    p_new_total: newTotal,
    p_schedule: schedule,
    p_payments: payments,
    p_payment_details: {
      loanType: c.tipo,
      ...paymentBreakdown
    },
    p_paid_at: paidAt,
    p_expected_updated_at: c.updatedAt || null
  });
  if (invoiceRes.error) return toast(invoiceRes.error.message, false);

  state.lastInvoice = Array.isArray(invoiceRes.data) ? invoiceRes.data[0] : invoiceRes.data;
  await loadAll();
  state.selectedClient = null;
  $('payment-search').value = '';
  $('payment-amount').value = '';
  $('payment-info').textContent = '';
  showWhatsappReceipt({ ...c, balance: newBalance, calendario: schedule }, state.lastInvoice);
  toast('Pago registrado y factura generada');
}

function queueOfflinePayment(client, amount) {
  const pending = {
    id: crypto.randomUUID(),
    ownerId: teamOwnerId(),
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
  await loadAll();
  const pending = [...state.offlineQueue];
  const failed = [];
  for (const item of pending) {
    if (item.ownerId && item.ownerId !== teamOwnerId()) continue;
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
  $('send-receipt-whatsapp').onclick = () => sendInvoiceWhatsapp(invoice, client);
}

function printInvoice(invoice) {
  if (!invoice) return toast('No hay factura para imprimir', false);
  const logo = makeReceiptLogo();
  const client = findInvoiceClient(invoice);
  const details = invoiceDetails(invoice, client);
  const progress = clientPaymentProgress(client);
  const detailsHtml = Number(details.pagoInteres || 0) > 0 || Number(details.pagoCapital || 0) > 0
    ? `
        <div><span>Aplicado a interes</span><strong>${money(details.pagoInteres || 0)}</strong></div>
        <div><span>Aplicado a capital</span><strong>${money(details.pagoCapital || 0)}</strong></div>
      `
    : '';
  const weeksHtml = progress.periods
    ? `<p>${progress.label}: <strong>${progress.remainingPeriods} de ${progress.periods}</strong></p>`
    : '';
  $('print-area').innerHTML = `
    <section class="receipt-page">
      <header>
        <img src="${logo}" alt="${attr(cfg().businessName)}" />
        <div>
          <h1>${escapeHtml(cfg().businessName)}</h1>
          <p>${escapeHtml(cfg().businessTagline)}</p>
        </div>
      </header>
      <div class="receipt-meta">
        <span>Factura <strong>${escapeHtml(invoice.number)}</strong></span>
        <span>${dayjs(invoice.paid_at).format('DD/MM/YYYY hh:mm A')}</span>
      </div>
      <h2>Recibo de Pago</h2>
      <div class="receipt-client">
        <span>Cliente</span>
        <strong>${escapeHtml(invoice.client_name)}</strong>
      </div>
      <div class="receipt-money">
        <div><span>Monto pagado</span><strong>${money(invoice.amount)}</strong></div>
        <div><span>Balance anterior</span><strong>${money(invoice.previous_balance)}</strong></div>
        <div><span>Nuevo balance</span><strong>${money(invoice.new_balance)}</strong></div>
        ${detailsHtml}
      </div>
      ${weeksHtml}
      <footer>${escapeHtml(cfg().receiptFooter)}</footer>
    </section>
  `;
  window.print();
}

function renderUsers() {
  if (!$('users-body')) return;
  const collectors = [...new Set(state.collectors.map(c => c.name))].filter(Boolean).sort();
  $('users-body').innerHTML = state.profiles.map(p => `
    <tr>
      <td>${escapeHtml(p.full_name || p.id)}</td>
      <td>
        <select data-user-role="${attr(p.id)}">
          ${['owner', 'admin', 'collector', 'viewer'].map(role => `<option value="${attr(role)}" ${p.role === role ? 'selected' : ''}>${escapeHtml(role)}</option>`).join('')}
        </select>
      </td>
      <td>
        <select data-user-collector="${attr(p.id)}">
          <option value="">Sin asignar</option>
          ${collectors.map(name => `<option value="${attr(name)}" ${p.collector_name === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
        </select>
      </td>
      <td>${p.active ? 'Activo' : 'Inactivo'}</td>
      <td><button data-save-user="${attr(p.id)}">Guardar</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5">No hay usuarios para mostrar.</td></tr>';
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
      <div><strong>${escapeHtml(r.name)}</strong><small>${money(r.collected)} cobrado - ${r.late} morosos</small></div>
      <div class="bar-track"><span style="width:${Math.round((r.collected / max) * 100)}%"></span></div>
      <b>${money(r.balance)}</b>
    </div>
  `).join('') || '<p class="muted">Agrega cobradores y prestamos para ver rendimiento.</p>';
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
      <span class="dot ${attr(item.status.cls)}"></span>
      <div><strong>${escapeHtml(item.client.nombre)}</strong><small>${escapeHtml(item.client.cobrador)} - ${item.due.format('DD/MM/YYYY')}</small></div>
      <b>${money(item.client.balance)}</b>
    </div>
  `).join('') || '<p class="muted">No hay cobros pendientes.</p>';
}

function renderClients() {
  const rows = filteredClients();
  const canDelete = ['owner', 'admin'].includes(state.profile?.role);
  $('clients-body').innerHTML = rows.map((c, index) => {
    const st = loanStatus(c);
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(c.nombre)}</td>
        <td>${c.tipo === 'redito' ? 'Redito' : 'San'}</td>
        <td>${escapeHtml(c.telefono || '-')}</td>
        <td>${escapeHtml(c.cedula || '-')}</td>
        <td>${escapeHtml(c.cobrador)}</td>
        <td>${money(c.monto)}</td>
        <td>${money(c.balance)}</td>
        <td>${escapeHtml(st.next)}</td>
        <td><span class="badge ${attr(st.cls)}">${escapeHtml(st.text)}</span></td>
        <td class="actions-cell">
          <button data-view="${attr(c.id)}">Ver</button>
          ${canDelete ? `<button class="danger" data-delete="${attr(c.id)}">Eliminar</button>` : ''}
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="11">No hay clientes para mostrar.</td></tr>';
}

function renderClientFilters() {
  const collectors = [...new Set([...state.collectors.map(c => c.name), ...state.clients.map(c => c.cobrador)])].filter(Boolean).sort();
  const option = name => `<option value="${attr(name)}">${escapeHtml(name)}</option>`;
  if (state.profile?.role === 'collector') {
    const assigned = state.profile.collector_name || collectors[0] || '';
    $('filter-collector').innerHTML = assigned ? option(assigned) : '<option value="">Sin cobrador asignado</option>';
    $('filter-collector').value = assigned;
    $('loan-collector').innerHTML = assigned ? option(assigned) : '<option value="">Sin cobrador asignado</option>';
    $('loan-collector').value = assigned;
    return;
  }
  $('filter-collector').innerHTML = '<option value="">Todos los cobradores</option>' + collectors.map(option).join('');
  $('loan-collector').innerHTML = collectors.length
    ? collectors.map(option).join('')
    : '<option value="Cobrador 1">Cobrador 1</option>';
}

function renderCollectors() {
  $('collector-tags').innerHTML = state.collectors.map(c => `
    <span class="tag">${escapeHtml(c.name)}<button data-remove-collector="${attr(c.id)}">x</button></span>
  `).join('');
}

function renderInvoices() {
  $('invoices-body').innerHTML = state.invoices.map(i => `
    <tr>
      <td>${escapeHtml(i.number)}</td>
      <td>${escapeHtml(i.client_name)}</td>
      <td>${money(i.amount)}</td>
      <td>${money(i.new_balance)}</td>
      <td>${dayjs(i.paid_at).format('DD/MM/YYYY hh:mm A')}</td>
      <td>
        <button data-print-invoice="${attr(i.id)}">Imprimir</button>
        <button data-whatsapp-invoice="${attr(i.id)}" class="success">WhatsApp</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6">No hay facturas registradas.</td></tr>';
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
  $('smart-alerts').innerHTML = alerts.map(a => `<div class="alert ${attr(a.level)}">${escapeHtml(a.text)}</div>`).join('');
}

function searchPaymentClients() {
  const q = $('payment-search').value.trim().toLowerCase();
  const box = $('payment-results');
  if (!q) {
    box.classList.add('hidden');
    return;
  }
  const matches = state.clients.filter(c => c.nombre.toLowerCase().includes(q) && c.balance > 0).slice(0, 10);
  box.innerHTML = matches.map(c => `<button data-select-payment="${attr(c.id)}">${escapeHtml(c.nombre)} (${money(c.balance)})</button>`).join('');
  box.classList.toggle('hidden', matches.length === 0);
}

function openClient(id) {
  const c = state.clients.find(x => x.id === id);
  if (!c) return;
  $('modal-title').textContent = `${c.nombre}${c.cedula ? ' - ' + c.cedula : ''}`;
  const redSummary = c.tipo === 'redito' ? reditoPaymentSummary(c) : null;
  const displaySchedule = redSummary?.schedule || c.calendario;
  $('schedule-grid').innerHTML = displaySchedule.map((s, i) => {
    const paid = Number(s.pagado || 0) >= Number(s.cuota || 0);
    const due = periodDueDate(c, i).format('DD/MM/YYYY');
    const amountLabel = c.tipo === 'redito' ? 'Redito' : 'Cuota';
    return `
      <div class="week-card ${paid ? 'paid' : ''}">
        <strong>${escapeHtml(periodLabel(c, i))}</strong>
        <span>Vence: ${due}</span><br />
        <span>${amountLabel}: ${money(s.cuota)}</span><br />
        <span>Pagado: ${money(s.pagado)}</span><br />
        ${paid ? '<span class="badge ok">PAGADO</span>' : `<button data-pay-week="${attr(c.id)}:${i}">Cobrar</button>`}
      </div>`;
  }).join('') + (redSummary ? `
    <div class="week-card principal-card">
      <strong>Capital pendiente</strong>
      <span>${money(redSummary.principalPending)}</span><br />
      <small>El capital baja solo cuando el cliente paga mas que el redito mensual.</small>
    </div>
  ` : '');
  $('payment-history').innerHTML = c.historial.length
    ? c.historial.slice().reverse().map(p => `<div class="history-row"><span>${dayjs(p.fecha).format('DD/MM/YYYY hh:mm A')}</span><strong>${money(p.monto)}</strong></div>`).join('')
    : '<p>Sin pagos registrados.</p>';
  $('client-modal').classList.remove('hidden');
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
        <strong>${escapeHtml(item.client.nombre)}</strong>
        <span>${escapeHtml(item.status.text)} - vence ${item.due.format('DD/MM/YYYY')}</span>
      </div>
      <b>${money(item.client.balance)}</b>
      <div class="mobile-card-actions">
        <button data-mobile-pay="${attr(item.client.id)}" class="success">Cobrar</button>
        <button data-mobile-view="${attr(item.client.id)}" class="ghost">Ver</button>
        ${item.client.telefono ? `<a class="button ghost" href="https://wa.me/${attr(sanitizePhone(item.client.telefono))}" target="_blank" rel="noreferrer">WhatsApp</a>` : ''}
      </div>
    </article>
  `).join('') || '<p class="muted">No hay clientes pendientes en esta ruta.</p>';
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
  if (!['owner', 'admin'].includes(state.profile?.role)) {
    toast('Solo owner/admin pueden crear cobradores.', false);
    return;
  }
  const clean = name.trim();
  if (!clean) return;
  const { error } = await state.supabase.from('collectors').insert({ name: clean, owner_id: teamOwnerId() });
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

function validateImportPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') errors.push('El archivo no contiene un objeto JSON valido.');
  const clients = Array.isArray(payload?.clients) ? payload.clients : [];
  const seenNames = new Set();
  clients.forEach((client, index) => {
    const label = `Cliente ${index + 1}`;
    const name = String(client.nombre || client.name || '').trim();
    const amount = Number(client.monto ?? client.amount ?? 0);
    const balance = Number(client.balance ?? 0);
    const startDate = client.fechaInicio || client.start_date;
    if (!name) errors.push(`${label}: nombre requerido.`);
    if (seenNames.has(name.toLowerCase())) errors.push(`${label}: nombre duplicado en el archivo.`);
    if (name) seenNames.add(name.toLowerCase());
    if (!Number.isFinite(amount) || amount < 0) errors.push(`${label}: monto invalido.`);
    if (!Number.isFinite(balance) || balance < 0) errors.push(`${label}: balance invalido.`);
    if (startDate && !dayjs(startDate).isValid()) errors.push(`${label}: fecha invalida.`);
  });
  return errors;
}

async function importBackup(file) {
  if (!file) return;
  if (!confirm('Importar este backup? Se agregaran los datos al sistema actual.')) return;
  const payload = JSON.parse(await file.text());
  const errors = validateImportPayload(payload);
  if (errors.length) return toast(errors.slice(0, 3).join(' '), false);
  if (Array.isArray(payload.collectors)) {
    for (const c of payload.collectors) {
      await state.supabase.from('collectors').upsert({ name: c.name || c.nombre, owner_id: teamOwnerId() }, { onConflict: 'owner_id,name' });
    }
  }
  if (Array.isArray(payload.clients)) {
    for (const c of payload.clients) {
      const row = clientToRow(c);
      await state.supabase.from('clients').insert({ ...row, owner_id: teamOwnerId() });
    }
  }
  await loadAll();
  toast('Backup importado');
}

async function importMigration(file) {
  if (!file) return;
  const payload = JSON.parse(await file.text());
  const errors = validateImportPayload(payload);
  if (errors.length) return toast(errors.slice(0, 3).join(' '), false);
  const result = { collectors: 0, clients: 0 };
  if (Array.isArray(payload.collectors)) {
    for (const c of payload.collectors) {
      await state.supabase.from('collectors').upsert({ name: c.name || c.nombre, owner_id: teamOwnerId() }, { onConflict: 'owner_id,name' });
      result.collectors++;
    }
  }
  const clients = Array.isArray(payload.clients) ? payload.clients : [];
  for (const c of clients) {
    await state.supabase.from('clients').insert({ ...clientToRow(c), owner_id: teamOwnerId() });
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
  const ownerId = teamOwnerId();
  const isOwner = state.profile?.role === 'owner';
  $('installation-id').textContent = installationId;
  const { data, error } = await state.supabase
    .from('licenses')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('installation_id', installationId)
    .maybeSingle();
  if (error) throw error;
  let license = data;
  if (!license) {
    if (!isOwner) {
      return true;
    }
    const trialUntil = dayjs().add(30, 'day').format('YYYY-MM-DD');
    const insert = await state.supabase
      .from('licenses')
      .insert({ installation_id: installationId, valid_until: trialUntil, status: 'trial', owner_id: ownerId })
      .select()
      .single();
    if (insert.error) {
      if (insert.error.code !== '23505') throw insert.error;
      const existing = await state.supabase
        .from('licenses')
        .select('*')
        .eq('owner_id', ownerId)
        .eq('installation_id', installationId)
        .maybeSingle();
      if (existing.error) throw existing.error;
      license = existing.data;
    } else {
      license = insert.data;
    }
  }
  if (!license) {
    const trialUntil = dayjs().add(30, 'day').format('YYYY-MM-DD');
    toast(`Modo prueba activo hasta ${dayjs(trialUntil).format('DD/MM/YYYY')}`);
    return true;
  }
  if (dayjs().isAfter(dayjs(license.valid_until).endOf('day'))) {
    showScreen('license-screen');
    return false;
  }
  if (license.status === 'trial') toast(`Modo prueba activo hasta ${dayjs(license.valid_until).format('DD/MM/YYYY')}`);
  return true;
}

async function activateLicense() {
  if (state.profile?.role !== 'owner') {
    return toast('Solo el owner puede activar licencias.', false);
  }
  const key = $('license-key').value.trim();
  const installationId = getInstallationId();
  const ownerId = teamOwnerId();
  const tail = installationId.replaceAll('-', '').slice(0, 8);
  const match = key.match(/^SANPRO\d{4}-(\d{4}-\d{2}-\d{2})-([a-f0-9]{8})$/i);
  if (!match) return toast('Formato de clave invalido', false);
  if (match[2].toLowerCase() !== tail.toLowerCase()) return toast('Esta clave no corresponde a esta instalacion', false);
  if (!dayjs(match[1], 'YYYY-MM-DD', true).isValid() || dayjs(match[1]).isBefore(dayjs(), 'day')) {
    return toast('Fecha de licencia invalida o vencida', false);
  }
  const payload = {
    owner_id: ownerId,
    installation_id: installationId,
    license_key: key,
    valid_until: match[1],
    status: 'active'
  };
  const existing = await state.supabase
    .from('licenses')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('installation_id', installationId)
    .maybeSingle();
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
    const inviteCode = makeInviteCode();
    const insert = await state.supabase.from('profiles').insert({
      id: state.user.id,
      full_name: state.user.user_metadata?.full_name || state.user.email?.split('@')[0] || 'Usuario',
      role: 'owner',
      business_owner_id: state.user.id,
      invite_code: inviteCode
    }).select().single();
    if (insert.error) throw insert.error;
    data = insert.data;
  } else if (!data.business_owner_id || !data.invite_code) {
    const patch = {};
    if (!data.business_owner_id) patch.business_owner_id = data.role === 'owner' ? data.id : data.id;
    if (!data.invite_code && ['owner', 'admin'].includes(data.role)) patch.invite_code = makeInviteCode();
    if (Object.keys(patch).length) {
      const update = await state.supabase.from('profiles').update(patch).eq('id', state.user.id).select().single();
      if (update.error) throw update.error;
      data = update.data;
    }
  }
  state.profile = data;
  $('user-role').textContent = data.role;
  document.body.dataset.role = data.role;
  if ($('business-invite-code')) $('business-invite-code').textContent = data.invite_code || '---';
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
  $('auth-business-code').classList.toggle('hidden', !signup);
  $('auth-business-code-label').classList.toggle('hidden', !signup);
}

async function submitAuth() {
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email || password.length < 6) return toast('Correo y contrasena validos son requeridos', false);
  if (state.authMode === 'signup') {
    const { error } = await state.supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: $('auth-name').value.trim(),
          business_code: $('auth-business-code').value.trim().toUpperCase()
        }
      }
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
  ['auth-email', 'auth-password', 'auth-name', 'auth-business-code'].forEach(id => {
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
    clearClientFilters();
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
        const schedule = c.tipo === 'redito' ? reditoPaymentSummary(c).schedule : c.calendario;
        const week = schedule[Number(idx)];
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
    const whatsappInvoiceId = e.target.closest('[data-whatsapp-invoice]')?.dataset.whatsappInvoice;
    if (whatsappInvoiceId) sendInvoiceWhatsapp(state.invoices.find(i => i.id === whatsappInvoiceId));
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
