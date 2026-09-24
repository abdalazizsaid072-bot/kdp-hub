import * as D from './data.js';
import * as I from './insights.js';
import { templates } from './templates.js';

const { SCHEMAS, STATUS, SERVICES } = D;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = n => `<i data-lucide="${n}"></i>`;
const paint = () => window.lucide?.createIcons();
const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
const FONT = "'IBM Plex Sans Arabic', system-ui, sans-serif", FONT_HEAD = "'Cairo', system-ui, sans-serif";
const LABELS = { clients: 'عميل / مشروع', tasks: 'مهمة', expenses: 'مصروف', ads: 'حملة إعلانية', notes: 'ملاحظة' };
const SHEET_ICONS = { clients: 'user-plus', tasks: 'square-check', expenses: 'receipt', ads: 'target', notes: 'notebook-pen' };
LABELS.payments = 'تحويل'; LABELS.campaigns = 'حملة إعلانية'; LABELS.campaignIncome = 'إيراد حملة'; LABELS.subscriptions = 'اشتراك'; LABELS.installments = 'قسط'; LABELS.otherIncome = 'دخل';
Object.assign(SHEET_ICONS, { subscriptions: 'repeat', installments: 'calendar-range', otherIncome: 'hand-coins' });

const S = {
  settings: D.loadSettings(),
  raw: null, source: 'local', syncing: false, error: null, lastSync: D.LS.get('lastSync', null),
  projects: [], tasks: [], expenses: [], ads: [], notes: [], payments: [], campaigns: [], incomes: [], subscriptions: [], installments: [], otherIncome: [], k: null, reminders: [],
  charts: [], route: { name: 'home', params: new URLSearchParams() },
  pf: { f: 'all', q: '', svc: '', sort: 'recent' }, aPeriod: '6', ideasTab: 'smart', toolTab: 'quote', quoteMkt: 'EG', qDaysTouched: false, moneyTab: 'close', closeMonth: null, incomeMode: D.LS.get('incomeMode', 'auto'),
  queue: D.LS.get('queue', []), installPrompt: null,
};
const hasRemote = () => !!(S.settings.url && S.settings.key);

/* ═════════════ التشغيل ═════════════ */

function boot() {
  applyTheme();
  buildNav();
  loadInitial();
  window.addEventListener('hashchange', route);
  route();
  registerSW();
  if (hasRemote()) sync(true);
  setInterval(() => hasRemote() && !document.hidden && sync(true), 15 * 60 * 1000);
  setInterval(checkNotifications, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNotifications(); });
  window.addEventListener('online', () => hasRemote() && sync(true));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installPrompt = e; if (S.route.name === 'settings') renderView(true); });
  window.addEventListener('appinstalled', () => toast('اتثبت التطبيق 🎉', 'ok'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => S.settings.theme === 'auto' && renderView(true));

  $('#syncBtn').onclick = () => hasRemote() ? sync() : toast('اربط الشيت الأول من الإعدادات', 'err');
  $('#themeBtn').onclick = cycleTheme;
  $('#bellBtn').onclick = openNotificationCenter;
  $('#addBtn').onclick = () => {
    const map = { tasks: 'tasks', expenses: 'expenses', ads: 'ads', notes: 'notes' };
    if (S.route.name === 'payments') openPaymentForm();
    else if (S.route.name === 'campaigns') openCampaignForm();
    else if (S.route.name === 'money' && S.moneyTab !== 'close') openForm({ subs: 'subscriptions', inst: 'installments', expenses: 'expenses', income: 'otherIncome' }[S.moneyTab]);
    else map[S.route.name] ? openForm(map[S.route.name]) : openQuickAdd();
  };
  // لصق صورة تحويل (Ctrl+V) من واتساب ويب أو أي مكان
  document.addEventListener('paste', e => {
    const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (!file || /INPUT|TEXTAREA/.test(document.activeElement?.tagName) && !S.receiptDraft) return;
    e.preventDefault();
    if (S.receiptDraft) setReceiptDraft(file); else openPaymentForm(null, { file });
  });
  $('#sheetBackdrop').onclick = () => closeSheet();
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
}

function loadInitial() {
  if (hasRemote()) {
    const c = D.LS.get('cache');
    S.raw = c || { clients: [], tasks: [], expenses: [], ads: [], notes: [] };
    S.source = c ? 'cache' : 'empty';
  } else {
    S.raw = D.LS.get('local') || D.demoData();
    S.source = 'local';
  }
  processData();
}

function processData() {
  const st = S.settings, r = S.raw;
  S.projects = (r.clients || []).map(c => D.enrichClient(c, st));
  S.tasks = (r.tasks || []).map(I.enrichTask);
  S.expenses = (r.expenses || []).map(e => I.enrichExpense(e, st));
  S.ads = (r.ads || []).map(I.enrichAd);
  S.notes = (r.notes || []).map(n => ({ ...n, sheet: 'notes', id: 'n' + n._row, dateObj: D.parseDate(n.date) }));
  S.payments = (r.payments || []).map(p => I.enrichPayment(p, st));
  S.incomes = (r.campaignIncome || []).map(x => I.enrichIncome(x, st));
  S.campaigns = (r.campaigns || []).map(c => I.enrichCampaign(c, S.incomes, st));
  S.subscriptions = (r.subscriptions || []).map(s => I.enrichSub(s, st));
  S.installments = (r.installments || []).map(i => I.enrichInstallment(i, st));
  S.otherIncome = (r.otherIncome || []).map(x => I.enrichOtherIncome(x, st));
  S.k = I.kpis(S.projects, S.expenses);
  S.reminders = I.reminders(S.projects, S.tasks, st, { payments: S.payments, campaigns: S.campaigns, subs: S.subscriptions, installments: S.installments });
  updateBadges();
  idbSet('reminders', S.reminders);
}

const dueReminders = () => { const t = D.isoDay(new Date()); return S.reminders.filter(r => r.fireOn <= t && r.kind !== 'idea'); };

function updateBadges() {
  const n = dueReminders().length;
  $('#bellDot').hidden = !n;
  if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  const late = I.upcoming(S.projects).filter(x => x.days < 0).length;
  $$('[data-count="projects"]').forEach(el => { el.textContent = late; el.hidden = !late; });
  const tasksDue = S.tasks.filter(t => !t.done && t.dueDate && t.days <= 0).length;
  $$('[data-count="tasks"]').forEach(el => { el.textContent = tasksDue; el.hidden = !tasksDue; });
  const pend = S.payments.filter(p => p.statusKey === 'pending').length;
  $$('[data-count="payments"]').forEach(el => { el.textContent = pend; el.hidden = !pend; });
  const live = S.campaigns.filter(c => c.state === 'active').length;
  $$('[data-count="campaigns"]').forEach(el => { el.textContent = live; el.hidden = !live; el.style.background = 'var(--good)'; });
  const foot = $('#sideFoot');
  if (foot) foot.innerHTML = `${ic(S.source === 'live' ? 'cloud' : S.source === 'local' ? 'flask-conical' : 'cloud-off')} ${sourceLabel()}`;
  paint();
}
function sourceLabel() {
  if (S.source === 'local') return 'وضع تجريبي (بيانات على الجهاز)';
  const t = S.lastSync ? new Date(S.lastSync).toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' }) : '—';
  return S.source === 'live' ? `متصل بالشيت · آخر تحديث ${t}` : `آخر نسخة محفوظة · ${t}`;
}

/* ═════════════ المزامنة والكتابة ═════════════ */

async function sync(quiet = false) {
  if (S.syncing || !hasRemote()) return;
  S.syncing = true; $('#syncBtn').classList.add('spin');
  try {
    await flushQueue();
    const data = await D.fetchRemote(S.settings);
    S.raw = data; S.source = 'live'; S.error = null; S.lastSync = Date.now();
    D.LS.set('cache', data); D.LS.set('lastSync', S.lastSync);
    processData();
    if (!$('#sheet').hidden && S.openProjectId) refreshOpenProject();
    renderView(true);
    checkNotifications();
    if (!quiet) toast('اتحدثت البيانات من الشيت', 'ok');
  } catch (e) {
    S.error = e.message;
    if (S.source === 'empty' || S.source === 'live') S.source = S.raw?.clients?.length ? 'cache' : 'empty';
    if (!quiet) toast('مش قادر أوصل للشيت: ' + e.message, 'err');
    renderView(true);
  } finally {
    S.syncing = false; $('#syncBtn').classList.remove('spin');
  }
}

async function flushQueue() {
  if (!S.queue.length || !navigator.onLine) return;
  while (S.queue.length) {
    await D.postRemote(S.settings, S.queue[0]);
    S.queue.shift(); D.LS.set('queue', S.queue);
  }
  toast('اتبعتت الإضافات اللي كانت مستنية النت ✓', 'ok');
}

function applyLocal(sheet, action, row, values) {
  const list = S.raw[sheet] = S.raw[sheet] || [];
  if (action === 'add') list.push({ _row: Math.max(1, ...list.map(x => x._row)) + 1, ...values });
  if (action === 'update') Object.assign(list.find(x => x._row === row) || {}, values);
  if (action === 'delete') S.raw[sheet] = list.filter(x => x._row !== row);
}

// file (اختياري) = صورة تحويل مضغوطة { b64, mime, name, dataUrl }
async function save(sheet, action, row, values, check, file = null) {
  if (!hasRemote()) {
    if (file) { const key = 'rcpt-local-' + Date.now(); await idbSet(key, file.dataUrl); values = { ...values, receipt: 'local:' + key }; }
    applyLocal(sheet, action, row, values);
    D.LS.set('local', S.raw);
    processData(); renderView(true);
    toast(action === 'delete' ? 'اتمسح' : 'اتحفظ (وضع تجريبي على الجهاز)', 'ok');
    return true;
  }
  const payload = { sheet, action, row, values, check };
  if (file) payload.file = { b64: file.b64, mime: file.mime, name: file.name };
  if (!navigator.onLine) {
    if (file) { toast('رفع صورة التحويل محتاج إنترنت', 'err'); return false; }
    if (action !== 'add') { toast('التعديل محتاج إنترنت', 'err'); return false; }
    S.queue.push(payload); D.LS.set('queue', S.queue);
    applyLocal(sheet, action, row, values); processData(); renderView(true);
    toast('مفيش نت — هيتحفظ في الشيت أول ما النت يرجع', 'ok');
    return true;
  }
  try {
    $('#syncBtn').classList.add('spin');
    const res = await D.postRemote(S.settings, payload);
    if (res.receipt) { values = { ...values, receipt: res.receipt }; const id = driveId(res.receipt); if (id && file) idbSet('rcpt:' + id, file.dataUrl); }
    toast(action === 'delete' ? 'اتمسح من الشيت' : 'اتحفظ في الشيت ✓', 'ok');
    applyLocal(sheet, action, row, values); processData(); renderView(true);
    sync(true);
    return true;
  } catch (e) {
    toast(e.message, 'err');
    return false;
  } finally { $('#syncBtn').classList.remove('spin'); }
}

const checkFor = (sheet, item) => ({ clients: { name: item.name }, ads: { book: item.book }, payments: { client: item.client }, campaigns: { name: item.name }, campaignIncome: { campaignId: item.campaignId }, subscriptions: { name: item.name }, installments: { name: item.name }, otherIncome: { source: item.source } })[sheet] || { title: item.title };
const driveId = url => String(url || '').match(/[-\w]{25,}/)?.[0] || '';

/* ═════════════ التنقل ═════════════ */

const NAV = [
  { items: [['home', 'الرئيسية', 'layout-dashboard'], ['projects', 'المشاريع والعملاء', 'folder-kanban'], ['payments', 'التحويلات والمدفوعات', 'credit-card'], ['analytics', 'التحليلات', 'chart-column'], ['ideas', 'الأفكار والنمو', 'lightbulb']] },
  { group: 'الشغل', items: [['campaigns', 'حملاتي الإعلانية', 'megaphone'], ['money', 'الفلوس والمصاريف', 'wallet'], ['tasks', 'المهام', 'list-checks'], ['ads', 'Amazon Ads (كتب العملاء)', 'target'], ['notes', 'ملاحظاتي', 'notebook-pen'], ['tools', 'الأدوات والرسائل', 'calculator']] },
  { group: 'النظام', items: [['settings', 'الإعدادات', 'settings'], ['setup', 'دليل الربط والتثبيت', 'book-open-check']] },
];
const BOTTOM = [['home', 'الرئيسية', 'layout-dashboard'], ['projects', 'المشاريع', 'folder-kanban'], ['payments', 'التحويلات', 'credit-card'], ['campaigns', 'حملاتي', 'megaphone'], ['more', 'المزيد', 'layout-grid']];
const COUNTED = ['projects', 'tasks', 'payments', 'campaigns'];

function buildNav() {
  const badge = k => COUNTED.includes(k) ? `<span class="count" data-count="${k}" hidden></span>` : '';
  $('#sideNav').innerHTML = NAV.map(g => (g.group ? `<div class="nav-group">${g.group}</div>` : '') +
    g.items.map(([k, l, i]) => `<a class="nav-link" data-nav="${k}" href="#/${k}">${ic(i)}<span>${l}</span>${badge(k)}</a>`).join('')).join('');
  $('#bottomNav').innerHTML = BOTTOM.map(([k, l, i]) => `<a data-nav="${k}" href="#/${k}">${ic(i)}<span>${l}</span>${badge(k)}</a>`).join('');
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, q] = h.split('?');
  const [name, arg] = path.split('/');
  return { name, arg, params: new URLSearchParams(q || '') };
}

function route() {
  const r = parseHash();
  if (r.name === 'project') {
    S.route = { name: 'projects', params: new URLSearchParams() };
    renderView(); openProject(r.arg);
    return;
  }
  if (r.name === 'campaign') {
    S.route = { name: 'campaigns', params: new URLSearchParams() };
    renderView(); openCampaign(r.arg);
    return;
  }
  if (!VIEWS[r.name]) r.name = 'home';
  if (r.name === 'projects' && r.params.get('f')) S.pf.f = r.params.get('f');
  if (r.name === 'tools' && r.params.get('t')) S.toolTab = r.params.get('t');
  if (r.name === 'expenses') { r.name = 'money'; S.moneyTab = 'expenses'; }
  if (r.name === 'money' && r.params.get('t')) S.moneyTab = r.params.get('t');
  S.route = r;
  closeSheet(true);
  renderView();
  window.scrollTo({ top: 0 });
}

function renderView(keepScroll = false) {
  const y = window.scrollY;
  S.charts.forEach(c => c.destroy()); S.charts = [];
  const v = VIEWS[S.route.name];
  $('#topTitle').innerHTML = `<h1>${v.title()}</h1><p>${v.sub ? v.sub() : ''}</p>`;
  $('#banner').innerHTML = ['settings', 'setup'].includes(S.route.name) ? '' : bannerHTML();
  $('#view').innerHTML = v.render(S.route);
  const active = ['tasks', 'ads', 'expenses', 'money', 'notes', 'tools', 'settings', 'setup', 'ideas', 'analytics'].includes(S.route.name) ? 'more' : S.route.name;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === S.route.name || (a.closest('#bottomNav') && a.dataset.nav === active)));
  paint();
  v.after?.(S.route);
  updateBadges();
  if (keepScroll) window.scrollTo({ top: y });
}

function bannerHTML() {
  if (S.source === 'local') return `<div class="banner">${ic('flask-conical')}<p><b>وضع تجريبي:</b> الأرقام اللي قدامك وهمية للتجربة. اربط شيت "ادارة العمل" عشان تشوف شغلك الحقيقي.</p><a class="btn primary sm" href="#/setup">${ic('link')} اربط الشيت</a></div>`;
  if (S.error) return `<div class="banner">${ic('cloud-off')}<p>مش قادر أوصل للشيت دلوقتي — بعرضلك آخر نسخة محفوظة. <span class="muted small">(${esc(S.error)})</span></p><button class="btn sm" onclick="document.getElementById('syncBtn').click()">${ic('refresh-cw')} حاول تاني</button></div>`;
  if (S.queue.length) return `<div class="banner">${ic('wifi-off')}<p>${S.queue.length} إضافة مستنية النت عشان تتحفظ في الشيت.</p></div>`;
  return '';
}

/* ═════════════ عناصر مشتركة ═════════════ */

const GRADS = ['#7b5cff,#4f7cff', '#10b981,#0fb5d4', '#f59e0b,#f97316', '#ec4899,#8b5cf6', '#06b6d4,#3b82f6', '#84cc16,#10b981', '#f43f5e,#f59e0b'];
const TITLES = new Set(['د', 'د.', 'م', 'م.', 'أ', 'أ.', 'استاذ', 'أستاذ', 'الأستاذ', 'المهندس', 'مهندس', 'دكتور', 'مدام', 'مدلم', 'تبع', 'عميل']);
function avatar(name, key = name) {
  const words = String(name).split(/\s+/).filter(w => w && !TITLES.has(w));
  const letters = (words[0]?.[0] || '؟') + (words[1]?.[0] || '');
  let h = 0; for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<div class="avatar" style="background:linear-gradient(135deg,${GRADS[h % GRADS.length]})">${esc(letters)}</div>`;
}
const statusBadge = p => { const s = STATUS[p.statusKey]; return `<span class="badge tone-${s.tone}">${ic(s.icon)}${s.label}</span>`; };
const serviceTags = p => p.services.map(s => `<span class="tag">${ic(SERVICES[s].icon)}${SERVICES[s].label}</span>`).join('');
const fmtDate = d => d ? d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) : '';
const dueText = days => days < 0 ? `متأخر ${-days} يوم` : days === 0 ? 'النهارده' : days === 1 ? 'بكرة' : `بعد ${days} يوم`;
const dueTone = days => days < 0 ? 'critical' : days <= 2 ? 'warning' : 'info';
const origMoney = (p, egp) => p.currency === 'EGP' ? I.money(egp) : `${I.fmt(egp / p.rate)} ${p.currency === 'SAR' ? 'ريال' : '$'}`;

function kpi({ icon, cls, label, value, unit = '', foot = '' }) {
  return `<div class="card kpi"><div class="kpi-icon ${cls}">${ic(icon)}</div><div class="label">${label}</div><div class="value">${value} <small>${unit}</small></div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
}
function deltaHTML(g, suffix = 'عن الشهر اللي فات') {
  if (g == null || !isFinite(g)) return `<span class="muted">مفيش بيانات للمقارنة</span>`;
  return `<span class="delta ${g >= 0 ? 'up' : 'down'}">${ic(g >= 0 ? 'arrow-up-right' : 'arrow-down-left')}${I.pct(g)}</span> ${suffix}`;
}
function emptyState(icon, title, text, action = '') {
  return `<div class="empty"><div class="big">${ic(icon)}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;
}
function insightCard(x) {
  return `<div class="card insight t-${x.tone}"><div class="ins-icon tone-${x.tone === 'info' ? 'info' : x.tone}">${ic(x.icon)}</div><div><h4>${esc(x.title)}</h4><p>${esc(x.text)}</p>${x.action ? `<a class="btn sm" href="${x.action.href}">${x.action.label} ${ic('chevron-left')}</a>` : ''}</div></div>`;
}

function trendVerdict() {
  const rows = I.monthly(S.projects, I.lastMonths(6));
  const cur = rows[5];
  const curVal = S.k.projected && S.k.projected > cur.revenue ? S.k.projected : cur.revenue;
  const recent = (rows[3].revenue + rows[4].revenue + curVal) / 3, before = (rows[0].revenue + rows[1].revenue + rows[2].revenue) / 3;
  if (!before && !recent) return { icon: 'minus', tone: 'muted', text: 'لسه مفيش بيانات كفاية', g: null };
  if (!before) return { icon: 'sprout', tone: 'good', text: 'بيزنس جديد وبيبدأ ينمو', g: null };
  const g = (recent - before) / before * 100;
  if (g >= 10) return { icon: 'trending-up', tone: 'good', text: `البيزنس في نمو 📈 (${I.pct(g)} آخر 3 شهور)`, g };
  if (g <= -10) return { icon: 'trending-down', tone: 'critical', text: `البيزنس في تراجع (${I.pct(g)} آخر 3 شهور)`, g };
  return { icon: 'move-horizontal', tone: 'info', text: `البيزنس مستقر (${I.pct(g)} آخر 3 شهور)`, g };
}

/* ═════════════ الرسوم البيانية ═════════════ */

function colors() {
  const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
  return { s1: g('--s1'), s2: g('--s2'), s3: g('--s3'), s7: g('--s7'), surface: g('--chart-surface'), grid: g('--grid'), axis: g('--axis'), muted: g('--ink-muted'), text: g('--text'), text2: g('--text-2'), tipBg: g('--surface-solid'), border: g('--border-strong') };
}
const compact = v => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

function baseOpts({ stacked = false, isMoney = true, horizontal = false } = {}) {
  const c = colors();
  const tick = { color: c.muted, font: { family: FONT, size: 12 } };
  const valueAxis = { stacked, beginAtZero: true, grid: { color: c.grid, drawTicks: false }, border: { display: false }, ticks: { ...tick, padding: 8, maxTicksLimit: 5, callback: v => compact(v) } };
  const catAxis = { stacked, grid: { display: false }, border: { color: c.axis }, ticks: { ...tick, autoSkip: true, maxRotation: 0 } };
  const val = ctx => horizontal ? ctx.parsed.x : ctx.parsed.y;
  return {
    responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x', animation: { duration: 500 },
    interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
    plugins: {
      legend: { display: false },
      tooltip: {
        rtl: true, textDirection: 'rtl', backgroundColor: c.tipBg, titleColor: c.text, bodyColor: c.text2, borderColor: c.border, borderWidth: 1,
        padding: 12, cornerRadius: 12, titleFont: { family: FONT_HEAD, weight: '700', size: 13 }, bodyFont: { family: FONT, size: 13 }, boxPadding: 6, usePointStyle: true,
        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${isMoney ? I.money(val(ctx)) : I.fmt(val(ctx))}` },
      },
    },
    scales: horizontal
      ? { x: { ...valueAxis, reverse: true, position: 'bottom' }, y: { ...catAxis, position: 'right', ticks: { ...tick, autoSkip: false } } }
      : { x: { ...catAxis, reverse: true }, y: { ...valueAxis, position: 'right' } },
  };
}

function mkChart(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!window.Chart) { el.parentElement.innerHTML = `<p class="muted small">${ic('wifi-off')} الرسوم البيانية محتاجة إنترنت أول مرة بس.</p>`; paint(); return; }
  S.charts.push(new Chart(el, cfg));
}

function revenueChart(id, rows) {
  const c = colors();
  mkChart(id, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.label),
      datasets: [
        { label: 'محصّل', data: rows.map(r => r.collected), backgroundColor: c.s1, stack: 'a', borderRadius: 0, borderSkipped: 'start', borderWidth: { top: 2 }, borderColor: c.surface, maxBarThickness: 40 },
        { label: 'متبقي', data: rows.map(r => Math.max(r.revenue - r.collected, 0)), backgroundColor: c.s2, stack: 'a', borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', maxBarThickness: 40 },
      ],
    },
    options: baseOpts({ stacked: true }),
  });
}

function lineChart(id, rows, key, label, isMoney = false) {
  const c = colors();
  mkChart(id, {
    type: 'line',
    data: { labels: rows.map(r => r.label), datasets: [{ label, data: rows.map(r => r[key]), borderColor: c.s1, backgroundColor: c.s1 + '1f', fill: true, tension: .35, borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: c.s1, pointBorderColor: c.surface, pointBorderWidth: 2 }] },
    options: baseOpts({ isMoney }),
  });
}

function hbarChart(id, labels, data, label, color = 's1') {
  const c = colors();
  mkChart(id, {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: c[color], borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 }] },
    options: baseOpts({ horizontal: true }),
  });
}

function legend(items) {
  return `<div class="legend">${items.map(([l, v]) => `<span><i style="background:var(${v})"></i>${l}</span>`).join('')}</div>`;
}

/* ═════════════ الشاشات ═════════════ */

const VIEWS = {};

VIEWS.home = {
  title: () => 'لوحة التحكم',
  sub: () => new Date().toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  render() {
    const k = S.k, up = I.upcoming(S.projects), idea = I.ideaOfTheDay();
    const tv = trendVerdict();
    const week = up.filter(x => x.days >= 0 && x.days <= 7).length, late = up.filter(x => x.days < 0).length;
    const hour = new Date().getHours();
    const ins = I.insights(S.projects, k, { ads: S.ads, campaigns: S.campaigns, subs: S.subscriptions }).slice(0, 4);
    const mix = I.serviceMix(S.projects).slice(0, 6), maxMix = Math.max(1, ...mix.map(m => m.revenue));
    return `${installHintHTML()}
    <div class="hero">
      <h2>${hour < 12 ? 'صباح الخير' : 'مساء الخير'}${S.settings.userName ? ' يا ' + esc(S.settings.userName) : ''} 👋</h2>
      <p>عندك ${k.active} مشروع شغال · ${week} تسليم الأسبوع ده${late ? ` · <b>${late} متأخر</b>` : ''} · ${esc(tv.text)}</p>
      <div class="hero-actions">
        <button class="btn" data-act="new-client">${ic('user-plus')} عميل جديد</button>
        <a class="btn" href="#/tools?t=quote">${ic('file-badge')} عرض سعر</a>
        <a class="btn" href="#/analytics">${ic('chart-column')} التحليلات</a>
      </div>
    </div>
    <div class="grid g-4" style="margin-top:16px">
      ${kpi({ icon: 'banknote', cls: 'i1', label: `إيراد ${I.monthName(new Date())}`, value: I.fmt(k.revCur), unit: 'ج.م', foot: deltaHTML(k.growth) })}
      ${kpi({ icon: 'piggy-bank', cls: 'i2', label: 'المحصّل من مشاريع الشهر', value: I.fmt(k.collectedCur), unit: 'ج.م', foot: `${k.countCur} مشروع جديد الشهر ده` })}
      ${kpi({ icon: 'wallet', cls: 'i3', label: 'مستحقات عند العملاء', value: I.fmt(k.receivables), unit: 'ج.م', foot: `<a href="#/projects?f=owing" style="color:var(--accent)">عرض التفاصيل ←</a>` })}
      ${kpi({ icon: 'rocket', cls: 'i4', label: 'فرص في الطريق', value: I.fmt(k.pipelineValue), unit: 'ج.م', foot: `${k.leads.length} قيد التفكير · ${k.waiting.length} انتظار عربون` })}
    </div>
    ${homeLiveCards()}
    <div class="grid g-main" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h3>${ic('chart-column')} الإيراد آخر 6 شهور</h3>${legend([['محصّل', '--s1'], ['متبقي', '--s2']])}</div>
        <div class="chart-box"><canvas id="homeChart" aria-label="الإيراد الشهري آخر 6 شهور"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${ic('calendar-clock')} التسليمات الجاية</h3><a class="sub" href="#/projects?f=active">الكل</a></div>
        ${up.length ? `<div class="list">${up.slice(0, 6).map(({ p, days }) => `
          <div class="list-item" data-open="${p.id}">${avatar(p.displayName, p.clientId)}
            <div class="li-body"><div class="li-title">${esc(p.displayName)}</div><div class="li-sub">${esc(I.short(p.project, 45))}</div></div>
            <div class="li-end"><span class="badge tone-${dueTone(days)}">${dueText(days)}</span></div></div>`).join('')}</div>`
          : emptyState('calendar-check', 'مفيش تسليمات بتواريخ', 'لما تكتب "موعد التسليم" كتاريخ هيظهر هنا ويجيلك تذكير قبله.')}
      </div>
    </div>
    <h2 class="section-title">${ic('sparkles')} أفكار ذكية من بياناتك</h2>
    <div class="grid g-2">${ins.map(insightCard).join('') || '<p class="muted">ضيف بيانات أكتر وهتظهر هنا أفكار.</p>'}</div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card insight t-info"><div class="ins-icon tone-info">${ic('lightbulb')}</div><div><div class="muted small">فكرة اليوم · ${esc(idea.cat)}</div><h4>${esc(idea.title)}</h4><p>${esc(idea.text)}</p><a class="btn sm" href="#/ideas">مكتبة الأفكار ${ic('chevron-left')}</a></div></div>
      <div class="card">
        <div class="card-head"><h3>${ic('layers')} إيرادك جاي منين</h3><span class="sub">حسب نوع الخدمة</span></div>
        ${mix.map(m => `<div class="hbar"><span class="row" style="gap:6px">${ic(m.icon)} ${m.label}</span><div class="track"><span style="width:${m.revenue / maxMix * 100}%;background:var(--s1)"></span></div><b class="num small">${I.fmt(m.revenue)}</b></div>`).join('')}
      </div>
    </div>`;
  },
  after() { revenueChart('homeChart', I.monthly(S.projects, I.lastMonths(6))); },
};

/* ── المشاريع ── */
const PFILTERS = [['all', 'الكل', 'layers'], ['active', 'شغالة', 'loader'], ['late', 'متأخرة', 'siren'], ['waiting', 'انتظار العربون', 'hand-coins'], ['lead', 'قيد التفكير', 'hourglass'], ['owing', 'عليها مستحقات', 'wallet'], ['done', 'اتسلمت', 'badge-check'], ['flags', 'محتاجة مراجعة', 'clipboard-check']];
const today0 = () => D.startOfDay();
const pfilter = {
  all: () => true,
  active: p => !p.isDone && !p.isLead,
  late: p => p.deadlineDate && !p.isDone && !p.isLead && p.deadlineDate < today0(),
  waiting: p => p.statusKey === 'waiting',
  lead: p => p.isLead,
  owing: p => p.remainingEGP > 0 && !p.isLead,
  done: p => p.isDone,
  flags: p => p.flags.length > 0,
};

function filteredProjects() {
  const { f, q, svc, sort } = S.pf;
  const qq = q.trim().toLowerCase();
  let list = S.projects.filter(pfilter[f] || pfilter.all)
    .filter(p => !svc || p.services.includes(svc))
    .filter(p => !qq || [p.name, p.project, p.phone, p.status, p.amazon, p.nationality].join(' ').toLowerCase().includes(qq));
  const byDate = (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) || b._row - a._row;
  if (sort === 'value') list.sort((a, b) => b.totalEGP - a.totalEGP);
  else if (sort === 'deadline') list.sort((a, b) => (a.deadlineDate?.getTime() ?? Infinity) - (b.deadlineDate?.getTime() ?? Infinity));
  else if (sort === 'owing') list.sort((a, b) => b.remainingEGP - a.remainingEGP);
  else list.sort(byDate);
  return list;
}

function projectCard(p) {
  const pctPaid = p.totalEGP ? Math.min(100, p.paidEGP / p.totalEGP * 100) : 0;
  const days = p.deadlineDate ? D.daysBetween(today0(), p.deadlineDate) : null;
  return `<div class="card pcard" data-open="${p.id}">
    <div class="top">${avatar(p.displayName, p.clientId)}<div class="li-body"><div class="li-title">${esc(p.displayName)}</div><div class="li-sub">${fmtDate(p.date) || 'بدون تاريخ'} · ${esc(p.nationality || '')}</div></div>${statusBadge(p)}</div>
    <div class="proj">${esc(p.project || '—')}</div>
    <div class="row" style="gap:6px">${serviceTags(p)}</div>
    ${p.totalEGP ? `<div><div class="progress"><span style="width:${pctPaid}%"></span></div>
    <div class="money-row" style="margin-top:6px"><span>مدفوع <b>${origMoney(p, p.paidEGP)}</b></span><span>الإجمالي <b>${origMoney(p, p.totalEGP)}</b></span></div></div>` : '<div class="muted small">مفيش سعر متسجل</div>'}
    <div class="row between">
      ${days != null && !p.isDone ? `<span class="badge tone-${dueTone(days)}">${ic('calendar-clock')}${dueText(days)}</span>` : `<span class="muted small">${esc(D.parseDate(p.deadline) ? '' : p.deadline || '')}</span>`}
      ${p.flags.length ? `<span class="tag" title="${esc(p.flags.join('، '))}">${ic('triangle-alert')}${esc(p.flags[0])}</span>` : ''}
    </div>
  </div>`;
}

VIEWS.projects = {
  title: () => 'المشاريع والعملاء',
  sub: () => `${S.projects.length} مشروع · ${new Set(S.projects.map(p => p.clientId)).size} عميل`,
  render() {
    const counts = Object.fromEntries(PFILTERS.map(([k]) => [k, S.projects.filter(pfilter[k]).length]));
    const svcs = Object.keys(SERVICES).filter(s => S.projects.some(p => p.services.includes(s)));
    return `
    <div class="toolbar">
      <label class="search">${ic('search')}<input id="pq" type="search" placeholder="دوّر باسم العميل، المشروع، الرقم…" value="${esc(S.pf.q)}"></label>
      <select id="psvc" class="btn"><option value="">كل الخدمات</option>${svcs.map(s => `<option value="${s}" ${S.pf.svc === s ? 'selected' : ''}>${SERVICES[s].label}</option>`).join('')}</select>
      <select id="psort" class="btn">${[['recent', 'الأحدث'], ['value', 'الأعلى قيمة'], ['deadline', 'أقرب تسليم'], ['owing', 'الأكتر مستحقات']].map(([v, l]) => `<option value="${v}" ${S.pf.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="chips" style="margin-bottom:16px">${PFILTERS.map(([k, l, i]) => `<button class="chip ${S.pf.f === k ? 'on' : ''}" data-pf="${k}">${ic(i)}${l} <b>${counts[k]}</b></button>`).join('')}</div>
    <div id="plist"></div>`;
  },
  after() {
    const draw = () => {
      const list = filteredProjects();
      const tot = sum(list.filter(p => !p.isLead), p => p.totalEGP), rem = sum(list.filter(p => !p.isLead), p => p.remainingEGP);
      $('#plist').innerHTML = list.length
        ? `<p class="muted small" style="margin:0 0 10px">${list.length} مشروع · إجمالي ${I.money(tot)} · باقي ${I.money(rem)}</p><div class="project-grid">${list.map(projectCard).join('')}</div>`
        : emptyState('search-x', 'مفيش نتايج', 'جرّب فلتر تاني أو امسح البحث.');
      paint();
    };
    draw();
    $('#pq').oninput = e => { S.pf.q = e.target.value; draw(); };
    $('#psvc').onchange = e => { S.pf.svc = e.target.value; draw(); };
    $('#psort').onchange = e => { S.pf.sort = e.target.value; draw(); };
    $$('[data-pf]').forEach(b => b.onclick = () => { S.pf.f = b.dataset.pf; $$('[data-pf]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  },
};

/* ── تفاصيل المشروع ── */
function openProject(id) {
  const p = S.projects.find(x => x.id === id);
  if (!p) return;
  S.openProjectId = id;
  const days = p.deadlineDate ? D.daysBetween(today0(), p.deadlineDate) : null;
  const others = S.projects.filter(x => x.clientId === p.clientId && x.id !== p.id);
  const pays = S.payments.filter(x => x.projectRowN === p._row || (!x.projectRowN && D.cleanName(x.client) === p.displayName));
  const clientTotal = sum([p, ...others].filter(x => !x.isLead), x => x.totalEGP);
  const wa = kind => I.waLink(p, kind);
  openSheet({
    title: `${avatar(p.displayName, p.clientId)} <span>${esc(p.displayName)}</span>`,
    body: `
      <div class="row" style="margin-bottom:10px">${statusBadge(p)} ${p.phone ? `<span class="tag">${ic('phone')}${esc(p.phone)}</span>` : ''} ${p.nationality ? `<span class="tag">${ic('flag')}${esc(p.nationality)}</span>` : ''} ${p.amazon ? `<span class="tag">${ic('store')}${esc(p.amazon)}</span>` : ''}</div>
      <p style="margin:0 0 8px;font-size:16px">${esc(p.project || '—')}</p>
      <div class="row" style="gap:6px">${serviceTags(p)}</div>
      <div class="kv">
        <div><small>الإجمالي</small><b>${esc(p.total || '—')}</b></div>
        <div><small>المدفوع / العربون</small><b>${esc(p.deposit || '—')}</b></div>
        <div><small>الباقي</small><b style="color:${p.remainingEGP > 0 ? 'var(--critical)' : 'var(--good-text)'}">${p.remainingEGP > 0 ? origMoney(p, p.remainingEGP) : 'خالص ✓'}</b></div>
        <div><small>موعد التسليم</small><b>${days != null ? `${fmtDate(p.deadlineDate)} · <span class="countdown" style="color:var(--${dueTone(days) === 'info' ? 'info' : dueTone(days)})">${p.isDone ? '' : dueText(days)}</span>` : esc(p.deadline || '—')}</b></div>
        <div><small>التاريخ</small><b>${fmtDate(p.date) || esc(p.date || '—')}</b></div>
        ${p.pagesN ? `<div><small>الصفحات</small><b>${p.pagesN}</b></div>` : ''}
        ${p.booksN ? `<div><small>الكتب</small><b>${p.booksN}</b></div>` : ''}
        <div><small>إجمالي تعاملك معاه</small><b>${I.money(clientTotal)}</b></div>
      </div>
      ${p.flags.length ? `<p class="small" style="color:var(--warning-text)">${ic('triangle-alert')} ملاحظات على البيانات: ${esc(p.flags.join('، '))}</p>` : ''}
      <h4 style="margin:18px 0 8px">${ic('message-circle')} رسائل واتساب جاهزة</h4>
      ${wa('update') ? `<div class="row">
        ${p.remainingEGP > 0 && !p.isLead ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${wa('reminder')}">${ic('wallet')} تذكير بالباقي</a>` : ''}
        ${p.statusKey === 'waiting' || p.isLead ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${wa('deposit')}">${ic('hand-coins')} طلب العربون</a>` : ''}
        <a class="btn wa sm" target="_blank" rel="noopener" href="${wa('update')}">${ic('send')} تحديث على الشغل</a>
        ${p.isDone ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${wa('delivered')}">${ic('star')} طلب تقييم</a>` : ''}
        <a class="btn sm" href="tel:+${D.whatsappNumber(p)}">${ic('phone-call')} اتصال</a>
      </div>` : '<p class="muted small">ضيف رقم العميل عشان تبعتله واتساب بضغطة.</p>'}
      <h4 style="margin:18px 0 8px">${ic('activity')} غيّر الحالة بسرعة</h4>
      <div class="chips" style="flex-wrap:wrap">${D.STATUS_PRESETS.map(s => `<button class="chip ${String(p.status).trim() === s ? 'on' : ''}" data-status="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      ${pays.length ? `<h4 style="margin:18px 0 8px">${ic('credit-card')} التحويلات</h4><div class="list">${pays.map(paymentRow).join('')}</div>` : ''}
      ${others.length ? `<h4 style="margin:18px 0 8px">${ic('history')} مشاريع تانية لنفس العميل</h4><div class="list">${others.map(o => `<div class="list-item" data-open="${o.id}"><div class="li-body"><div class="li-title">${esc(I.short(o.project, 60))}</div><div class="li-sub">${fmtDate(o.date)}</div></div><div class="li-end"><b>${origMoney(o, o.totalEGP)}</b>${statusBadge(o)}</div></div>`).join('')}</div>` : ''}
    `,
    foot: `<button class="btn primary" id="pEdit">${ic('pencil')} تعديل</button>
      <button class="btn" id="pRcpt">${ic('receipt-text')} صورة تحويل</button>
      ${p.totalEGP && p.remainingEGP > 0 ? `<button class="btn" id="pPay">${ic('hand-coins')} سجّل دفعة</button>` : ''}
      <button class="btn danger" id="pDel" style="margin-inline-start:auto">${ic('trash-2')} حذف</button>`,
  });
  $('#pEdit').onclick = () => openForm('clients', p);
  $('#pRcpt').onclick = () => openPaymentForm(null, { project: p });
  $('#pPay') && ($('#pPay').onclick = () => openPayment(p));
  loadThumbs();
  $('#pDel').onclick = () => confirmDelete('clients', p);
  $$('[data-status]').forEach(b => b.onclick = async () => {
    const ok = await save('clients', 'update', p._row, { status: b.dataset.status }, checkFor('clients', p));
    if (ok) refreshOpenProject();
  });
}
function refreshOpenProject() { if (S.openProjectId && S.projects.some(p => p.id === S.openProjectId)) openProject(S.openProjectId); }

function openPayment(p) {
  const cur = p.currency === 'SAR' ? 'ريال' : p.currency === 'USD' ? '$' : 'ج.م';
  const remRaw = Math.round(p.remainingEGP / p.rate);
  openSheet({
    title: `${ic('hand-coins')} تسجيل دفعة — ${esc(p.displayName)}`,
    body: `<div class="form"><div class="field full"><label>${ic('coins')} المبلغ اللي وصل (${cur})</label><input id="payAmt" inputmode="decimal" value="${remRaw}"><div class="hint">الباقي حالياً ${remRaw} ${cur}</div></div></div>`,
    foot: `<button class="btn primary" id="paySave">${ic('check')} حفظ</button><button class="btn ghost" id="payBack">رجوع</button>`,
  });
  $('#payBack').onclick = () => openProject(p.id);
  $('#paySave').onclick = async () => {
    const amt = Number(D.toLatin($('#payAmt').value).replace(/[^\d.]/g, ''));
    if (!amt) return toast('اكتب المبلغ', 'err');
    if (await save('clients', 'update', p._row, paymentValues(p, amt), checkFor('clients', p))) closeSheet();
  };
}

// الخانات اللي بتتغير في صف المشروع لما مبلغ يوصل (بعملة المشروع نفسه)
function paymentValues(p, amt) {
  const paid = Math.round(p.paidEGP / p.rate) + amt, rem = Math.max(p.totalRaw - paid, 0);
  const suffix = p.currency === 'SAR' ? ' ريال' : '';
  const values = { deposit: paid + suffix, remaining: rem === 0 ? 'خالص' : rem + suffix };
  if (p.statusKey === 'waiting' || p.isLead) values.status = 'قيد العمل';
  return values;
}

async function confirmDelete(sheet, item) {
  if (!confirm(`متأكد إنك عايز تمسح "${item.name || item.title || item.book}" من ${hasRemote() ? 'الشيت' : 'الأبلكيشن'}؟ مينفعش ترجعه.`)) return;
  if (await save(sheet, 'delete', item._row, {}, checkFor(sheet, item))) closeSheet();
}

/* ── التحليلات ── */
function allMonths() {
  const ds = S.projects.filter(p => p.date).map(p => p.date.getTime());
  if (!ds.length) return I.lastMonths(6);
  const first = new Date(Math.min(...ds)), now = new Date();
  const n = (now.getFullYear() - first.getFullYear()) * 12 + now.getMonth() - first.getMonth() + 1;
  return I.lastMonths(Math.max(n, 2));
}

VIEWS.analytics = {
  title: () => 'التحليلات',
  sub: () => 'شغلك بيتطور ولا بيقل؟ الأرقام بتقول',
  render() {
    const per = S.aPeriod;
    const months = per === 'all' ? allMonths() : I.lastMonths(+per);
    const set = new Set(months);
    const ps = S.projects.filter(p => p.date && set.has(D.monthKey(p.date)));
    const bill = ps.filter(p => !p.isLead);
    const rev = sum(bill, p => p.totalEGP), col = sum(bill, p => p.paidEGP);
    const n = months.length;
    let prevG = null;
    if (per !== 'all') {
      const prevSet = new Set(I.lastMonths(n * 2).slice(0, n));
      const prevRev = sum(S.projects.filter(p => p.date && !p.isLead && prevSet.has(D.monthKey(p.date))), p => p.totalEGP);
      prevG = prevRev ? (rev - prevRev) / prevRev * 100 : null;
    }
    const exp = sum(S.expenses.filter(e => e.kindKey !== 'personal' && e.dateObj && set.has(D.monthKey(e.dateObj))), e => e.amountEGP);
    const groups = I.groupBy(bill, p => p.clientId), clients = Object.keys(groups).length, repeat = Object.values(groups).filter(g => g.length > 1).length;
    const rows = I.monthly(S.projects, months, S.expenses);
    const statuses = I.statusMix(ps), maxSt = Math.max(1, ...statuses.map(s => s.count));
    const tv = trendVerdict();
    const gulf = bill.filter(p => p.currency === 'SAR' || /سعود|امارات|إمارات|كويت|قطر/.test(p.nationality));
    return `
    <div class="toolbar">
      <div class="seg" id="aper">${[['3', '3 شهور'], ['6', '6 شهور'], ['12', 'سنة'], ['all', 'الكل']].map(([v, l]) => `<button class="${per === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
      <span class="badge tone-${tv.tone}" style="font-size:14px;padding:6px 14px">${ic(tv.icon)}${esc(tv.text)}</span>
    </div>
    <div class="grid g-4">
      ${kpi({ icon: 'banknote', cls: 'i1', label: 'إجمالي الإيراد في الفترة', value: I.fmt(rev), unit: 'ج.م', foot: per === 'all' ? `${bill.length} مشروع` : deltaHTML(prevG, 'عن الفترة اللي قبلها') })}
      ${kpi({ icon: 'percent', cls: 'i2', label: 'نسبة التحصيل', value: rev ? Math.round(col / rev * 100) + '%' : '—', foot: `اتحصّل ${I.money(col)}` })}
      ${kpi({ icon: 'receipt-text', cls: 'i3', label: 'متوسط قيمة المشروع', value: I.fmt(bill.length ? rev / (bill.filter(p => p.totalEGP).length || 1) : 0), unit: 'ج.م', foot: `${bill.length} مشروع مدفوع` })}
      ${kpi({ icon: 'users', cls: 'i4', label: 'العملاء', value: clients, foot: `${repeat} رجعوا تاني (${clients ? Math.round(repeat / clients * 100) : 0}%)` })}
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card span-2">
        <div class="card-head"><h3>${ic('chart-column')} الإيراد الشهري</h3>${legend([['محصّل', '--s1'], ['متبقي', '--s2']])}</div>
        <div class="chart-box tall"><canvas id="aRev" aria-label="الإيراد الشهري محصل ومتبقي"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${ic('chart-spline')} عدد المشاريع كل شهر</h3></div>
        <div class="chart-box"><canvas id="aCount" aria-label="عدد المشاريع الشهري"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${ic('layers')} الإيراد حسب الخدمة</h3></div>
        <div class="chart-box"><canvas id="aSvc" aria-label="الإيراد حسب الخدمة"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${ic('crown')} أكبر العملاء</h3></div>
        <div class="chart-box"><canvas id="aTop" aria-label="أكبر العملاء بالإيراد"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${ic('activity')} حالة المشاريع</h3><span class="sub">${ps.length} مشروع</span></div>
        ${statuses.map(s => `<div class="hbar"><span class="badge tone-${s.tone}">${ic(s.icon)}${s.label}</span><div class="track"><span style="width:${s.count / maxSt * 100}%;background:var(--${s.tone === 'muted' ? 'ink-muted' : s.tone})"></span></div><b class="num">${s.count}</b></div>`).join('') || '<p class="muted">مفيش مشاريع في الفترة دي</p>'}
      </div>
    </div>
    <div class="grid g-3" style="margin-top:16px">
      ${kpi({ icon: 'file-stack', cls: 'i1', label: 'صفحات اتشغل عليها', value: I.fmt(sum(bill, p => p.pagesN)), foot: 'من المشاريع اللي متسجل فيها عدد الصفحات' })}
      ${kpi({ icon: 'globe-2', cls: 'i2', label: 'مشاريع من الخليج', value: gulf.length, foot: gulf.length ? `بقيمة ${I.money(sum(gulf, p => p.totalEGP))}` : 'فرصة للتوسع' })}
      ${kpi({ icon: 'scale', cls: 'i3', label: 'صافي بعد المصروفات', value: I.fmt(rev - exp), unit: 'ج.م', foot: `مصروفات ${I.money(exp)} — <a href="#/expenses" style="color:var(--accent)">سجّل مصروفاتك</a>` })}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>${ic('table')} الأرقام كجدول</h3></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>الشهر</th><th>مشاريع</th><th>الإيراد</th><th>محصّل</th><th>متبقي</th><th>صفحات</th><th>مصروفات</th><th>النمو</th></tr></thead>
      <tbody>${rows.map((r, i) => { const pr = rows[i - 1]; const g = pr && pr.revenue ? (r.revenue - pr.revenue) / pr.revenue * 100 : null; return `<tr><td>${r.label}</td><td class="n">${r.count}</td><td class="n">${I.fmt(r.revenue)}</td><td class="n">${I.fmt(r.collected)}</td><td class="n">${I.fmt(Math.max(r.revenue - r.collected, 0))}</td><td class="n">${I.fmt(r.pages)}</td><td class="n">${I.fmt(r.expenses)}</td><td class="n">${g == null ? '—' : `<span style="color:${g >= 0 ? 'var(--good-text)' : 'var(--critical)'}">${I.pct(g)}</span>`}</td></tr>`; }).reverse().join('')}</tbody></table></div>
    </div>`;
  },
  after() {
    $$('#aper button').forEach(b => b.onclick = () => { S.aPeriod = b.dataset.v; renderView(true); });
    const months = S.aPeriod === 'all' ? allMonths() : I.lastMonths(+S.aPeriod);
    const set = new Set(months);
    const ps = S.projects.filter(p => p.date && set.has(D.monthKey(p.date)));
    const rows = I.monthly(S.projects, months);
    revenueChart('aRev', rows);
    lineChart('aCount', rows, 'count', 'عدد المشاريع');
    const mix = I.serviceMix(ps);
    hbarChart('aSvc', mix.map(m => m.label), mix.map(m => Math.round(m.revenue)), 'الإيراد');
    const top = I.topClients(ps, 7);
    hbarChart('aTop', top.map(t => I.short(t.name, 18)), top.map(t => t.revenue), 'الإيراد');
  },
};

/* ── الأفكار ── */
const weekKey = () => { const d = today0(); d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); return D.isoDay(d); }; // الأسبوع بيبدأ السبت

function weeklyPlan() {
  const k = S.k, items = [];
  const names = ps => ps.slice(0, 3).map(p => p.displayName).join('، ');
  const late = I.upcoming(S.projects).filter(x => x.days < 0).map(x => x.p);
  const owing = S.projects.filter(p => p.remainingEGP > 0 && p.isDone);
  if (late.length) items.push(['siren', `ابعت تحديث للعملاء المتأخرين: ${names(late)}`]);
  if (k.waiting.length) items.push(['hand-coins', `ابعت تذكير عربون لـ: ${names(k.waiting)}`]);
  if (owing.length) items.push(['wallet', `حصّل المستحقات من: ${names(owing)}`]);
  if (k.leads.length) items.push(['hourglass', `تابع العملاء "قيد التفكير" بعينة مجانية: ${names(k.leads)}`]);
  items.push(['image', `انشر بوست: ${I.ideaOfTheDay().title}`]);
  items.push(['box', 'اعمل Mockup 3D لآخر كتاب اتنشر وانشره كـ"عمل جديد"']);
  items.push(['target', 'راجع أرقام حملات Amazon Ads وسجّلها في الأبلكيشن']);
  items.push(['star', 'اطلب تقييم أو شهادة من آخر عميل اتسلّم']);
  return items;
}

VIEWS.ideas = {
  title: () => 'الأفكار والنمو',
  sub: () => 'أفكار مبنية على أرقامك + مكتبة أفكار لمجالك',
  render() {
    const tab = S.ideasTab, done = D.LS.get('ideasDone', {}), wk = weekKey(), planDone = D.LS.get('plan-' + wk, {});
    const tabs = `<div class="seg" id="itabs" style="margin-bottom:16px">${[['smart', 'من بياناتك'], ['plan', 'خطة الأسبوع'], ['library', 'مكتبة الأفكار']].map(([v, l]) => `<button class="${tab === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    if (tab === 'smart') {
      const ins = I.insights(S.projects, S.k, { ads: S.ads, campaigns: S.campaigns, subs: S.subscriptions });
      return tabs + `<div class="grid g-2">${ins.map(insightCard).join('') || emptyState('sparkles', 'لسه مفيش أفكار', 'ضيف بيانات أكتر في الشيت.')}</div>`;
    }
    if (tab === 'plan') {
      const items = weeklyPlan();
      const n = items.filter((_, i) => planDone[i]).length;
      return tabs + `<div class="card"><div class="card-head"><h3>${ic('calendar-range')} خطة الأسبوع ده</h3><span class="sub">${n} من ${items.length} خلصوا</span></div>
        <div class="progress" style="margin-bottom:14px"><span style="width:${n / items.length * 100}%"></span></div>
        <div class="stack" style="gap:8px">${items.map(([icon, t], i) => `<label class="check"><input type="checkbox" data-plan="${i}" ${planDone[i] ? 'checked' : ''}>${ic(icon)}<span style="${planDone[i] ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(t)}</span></label>`).join('')}</div></div>`;
    }
    return tabs + I.IDEA_LIBRARY.map((c, ci) => `<div class="idea-cat"><h2 class="section-title">${ic(c.icon)} ${c.cat}</h2><div class="grid g-2">
      ${c.items.map(([t, txt], ii) => { const id = ci + '-' + ii; return `<div class="card idea ${done[id] ? 'done' : ''}"><div class="idea-icon">${ic(c.icon)}</div><div><h4>${esc(t)}</h4><p>${esc(txt)}</p>
        <div class="idea-actions"><button class="btn sm" data-idone="${id}">${ic(done[id] ? 'rotate-ccw' : 'check')} ${done[id] ? 'رجّعها' : 'اتنفذت'}</button><button class="btn sm ghost" data-itask="${esc(t)}">${ic('square-check')} حوّلها لمهمة</button></div></div></div>`; }).join('')}
    </div></div>`).join('');
  },
  after() {
    $$('#itabs button').forEach(b => b.onclick = () => { S.ideasTab = b.dataset.v; renderView(true); });
    $$('[data-plan]').forEach(c => c.onchange = () => { const k = 'plan-' + weekKey(), v = D.LS.get(k, {}); v[c.dataset.plan] = c.checked; D.LS.set(k, v); renderView(true); if (c.checked) confetti(); });
    $$('[data-idone]').forEach(b => b.onclick = () => { const v = D.LS.get('ideasDone', {}); v[b.dataset.idone] = !v[b.dataset.idone]; D.LS.set('ideasDone', v); renderView(true); });
    $$('[data-itask]').forEach(b => b.onclick = () => openForm('tasks', null, { title: 'تنفيذ فكرة: ' + b.dataset.itask, priority: 'مهمة', status: 'لم تبدأ' }));
  },
};

/* ── المهام ── */
VIEWS.tasks = {
  title: () => 'المهام',
  sub: () => `${S.tasks.filter(t => !t.done).length} مهمة مفتوحة`,
  render() {
    if (!S.tasks.length) return emptyState('list-checks', 'مفيش مهام لسه', 'سجّل مهامك (تسليم ملفات، متابعة عميل، تصميم…) ويجيلك إشعار في ميعادها.', `<button class="btn primary" data-add="tasks">${ic('plus')} مهمة جديدة</button>`);
    const groups = [
      ['متأخرة', 'siren', t => !t.done && t.days != null && t.days < 0],
      ['النهارده', 'sun', t => !t.done && t.days === 0],
      ['الجاية', 'calendar-days', t => !t.done && t.days > 0],
      ['من غير ميعاد', 'inbox', t => !t.done && t.days == null],
      ['خلصت', 'badge-check', t => t.done],
    ];
    const pr = { 'عاجلة': 'critical', 'مهمة': 'warning', 'عادية': 'muted' };
    return groups.map(([l, i, f]) => { const ts = S.tasks.filter(f).sort((a, b) => (a.days ?? 999) - (b.days ?? 999)); return ts.length ? `
      <h2 class="section-title">${ic(i)} ${l} <span class="muted small">(${ts.length})</span></h2>
      <div class="card"><div class="list">${ts.map(t => `<div class="list-item" data-edit="tasks:${t.id}">
        <input type="checkbox" data-toggle="${t.id}" ${t.done ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)" aria-label="تمت">
        <div class="li-body"><div class="li-title" style="${t.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(t.title)}</div><div class="li-sub">${esc(t.client || '')}${t.notes ? ' · ' + esc(t.notes) : ''}</div></div>
        <div class="li-end">${t.priority ? `<span class="badge tone-${pr[t.priority] || 'muted'}">${esc(t.priority)}</span>` : ''}${t.dueDate && !t.done ? `<span class="small muted">${fmtDate(t.dueDate)} · ${dueText(t.days)}</span>` : ''}</div></div>`).join('')}</div></div>` : ''; }).join('');
  },
  after() {
    $$('[data-toggle]').forEach(c => { c.onclick = e => e.stopPropagation(); c.onchange = async () => { const t = S.tasks.find(x => x.id === c.dataset.toggle); await save('tasks', 'update', t._row, { status: c.checked ? 'تمت' : 'لم تبدأ' }, checkFor('tasks', t)); if (c.checked) confetti(); }; });
  },
};

/* ── المصروفات ── */
const addExpenseBtns = `<div class="row"><button class="btn primary sm" data-add="expenses" data-kind="شغل">${ic('briefcase')} مصروف شغل</button><button class="btn sm" data-add="expenses" data-kind="شخصي">${ic('user')} مصروف شخصي</button></div>`;

VIEWS.expenses = {
  title: () => 'المصروفات',
  sub: () => 'مصاريف الشغل والمصاريف الشخصية',
  render() {
    const note = `<p class="muted small" style="margin:0 0 14px">${ic('info')} الاشتراكات والأقساط وصرف الحملات الإعلانية بيتحسبوا لوحدهم في تقفيل الشهر، فمتسجلهمش هنا تاني.</p>`;
    if (!S.expenses.length) return note + emptyState('receipt', 'مفيش مصروفات متسجلة', 'سجّل مصاريف الشغل (فريلانسرز، إنترنت، أدوات) والمصاريف الشخصية (بيت، مواصلات، أكل) عشان تعرف فلوسك راحت فين آخر الشهر.', addExpenseBtns);
    const mk = D.monthKey(new Date());
    const cur = S.expenses.filter(e => e.dateObj && D.monthKey(e.dateObj) === mk);
    const work = cur.filter(e => e.kindKey === 'work'), personal = cur.filter(e => e.kindKey === 'personal');
    const cats = Object.entries(I.groupBy(cur.length ? cur : S.expenses, e => e.category || 'أخرى')).map(([c, es]) => [c, sum(es, e => e.amountEGP), es[0].kindKey]).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...cats.map(c => c[1]));
    const list = [...S.expenses].sort((a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0) || b._row - a._row);
    return `<div class="row between" style="margin-bottom:14px">${addExpenseBtns}</div>${note}
    <div class="grid g-3">
      ${kpi({ icon: 'briefcase', cls: 'i1', label: `مصاريف الشغل في ${I.monthName(new Date())}`, value: I.fmt(sum(work, e => e.amountEGP)), unit: 'ج.م', foot: `${work.length} بند` })}
      ${kpi({ icon: 'user', cls: 'i4', label: `مصاريف شخصية في ${I.monthName(new Date())}`, value: I.fmt(sum(personal, e => e.amountEGP)), unit: 'ج.م', foot: `${personal.length} بند` })}
      ${kpi({ icon: 'tag', cls: 'i3', label: 'أكبر بند الشهر ده', value: esc(cats[0]?.[0] || '—'), foot: cats[0] ? I.money(cats[0][1]) : '' })}
    </div>
    <div class="grid g-main" style="margin-top:16px">
      <div class="card"><div class="card-head"><h3>${ic('chart-column')} المصاريف كل شهر</h3>${legend([['شغل', '--s1'], ['شخصي', '--s5']])}</div><div class="chart-box"><canvas id="eChart" aria-label="مصاريف الشغل والمصاريف الشخصية كل شهر"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>${ic('tags')} حسب الفئة</h3><span class="sub">${cur.length ? 'الشهر ده' : 'الكل'}</span></div>${cats.map(([c, v, k]) => `<div class="hbar"><span>${esc(c)}</span><div class="track"><span style="width:${v / max * 100}%;background:var(${k === 'personal' ? '--s5' : '--s1'})"></span></div><b class="num small">${I.fmt(v)}</b></div>`).join('')}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="list">${list.map(e => `<div class="list-item" data-edit="expenses:${e.id}"><div class="avatar" style="background:linear-gradient(135deg,${e.kindKey === 'personal' ? '#ec4899,#8b5cf6' : '#f59e0b,#f97316'})">${ic(e.kindKey === 'personal' ? 'user' : 'briefcase')}</div>
      <div class="li-body"><div class="li-title">${esc(e.title)}</div><div class="li-sub">${e.kindKey === 'personal' ? 'شخصي' : 'شغل'} · ${esc(e.category || '')} · ${fmtDate(e.dateObj) || esc(e.date)}</div></div><div class="li-end"><b>${esc(e.amount)}</b></div></div>`).join('')}</div></div>`;
  },
  after() {
    if (!S.expenses.length || !$('#eChart')) return;
    const months = I.lastMonths(6), c = colors();
    const byKind = k => months.map(m => Math.round(sum(S.expenses.filter(e => e.kindKey === k && e.dateObj && D.monthKey(e.dateObj) === m), e => e.amountEGP)));
    mkChart('eChart', { type: 'bar', data: { labels: months.map(I.monthLabel), datasets: [
      { label: 'شغل', data: byKind('work'), backgroundColor: c.s1, stack: 'a', borderWidth: { top: 2 }, borderColor: c.surface, maxBarThickness: 36 },
      { label: 'شخصي', data: byKind('personal'), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--s5').trim(), stack: 'a', borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 36 },
    ] }, options: baseOpts({ stacked: true }) });
  },
};

/* ═════════════ الفلوس: تقفيل الشهر، اشتراكات، أقساط، مصروفات، دخل تاني ═════════════ */

const MONEY_TABS = [['close', 'تقفيل الشهر', 'calculator'], ['subs', 'الاشتراكات', 'repeat'], ['inst', 'الأقساط', 'calendar-range'], ['expenses', 'المصروفات', 'receipt'], ['income', 'دخل تاني', 'hand-coins']];
const moneyData = () => ({ payments: S.payments, projects: S.projects, incomes: S.incomes, otherIncome: S.otherIncome, campaigns: S.campaigns, subs: S.subscriptions, installments: S.installments, expenses: S.expenses });
const shiftMonth = (key, n) => { const [y, m] = key.split('-').map(Number); return D.monthKey(new Date(y, m - 1 + n, 1)); };
const fullMonth = key => { const [y, m] = key.split('-').map(Number); return `${I.monthName(new Date(y, m - 1, 1))} ${y}`; };
const LEFT_COLOR = '--s3';

function monthCloseHTML() {
  const nowKey = D.monthKey(new Date()), key = S.closeMonth || nowKey;
  const mc = I.monthClose(key, moneyData(), S.incomeMode), pc = I.monthClose(shiftMonth(key, -1), moneyData(), S.incomeMode);
  const dl = (a, b, invert = false) => b ? `${deltaHTML((a - b) / Math.abs(b) * 100 * (invert ? 1 : 1), 'عن الشهر اللي فات')}` : '';
  const base = mc.income || mc.spend || 1;
  const segs = [...mc.groups.filter(g => g.total > 0).map(g => ({ label: g.label, color: g.color, v: g.total })), ...(mc.left > 0 ? [{ label: 'فاضلك', color: LEFT_COLOR, v: mc.left }] : [])];
  const segTotal = sum(segs, s => s.v) || 1;
  const pctOf = v => Math.round(v / base * 100);
  const detail = g => g.items.length ? `<details class="money-details"><summary><span class="row" style="gap:8px"><i class="dot" style="background:var(${g.color})"></i>${ic(g.icon)} <b>${g.label}</b></span><span class="num"><b>${I.money(g.total)}</b> <span class="muted small">${mc.income ? `(${pctOf(g.total)}% من دخلك)` : ''}</span></span></summary>
    <div class="list">${g.items.map(x => `<div class="list-item" style="cursor:default"><div class="li-body"><div class="li-title">${esc(x.label)}</div><div class="li-sub">${esc(x.sub || '')}</div></div><div class="li-end"><b class="num">${I.fmt(x.amount)}</b></div></div>`).join('')}</div></details>`
    : `<div class="money-details empty-row"><span class="row" style="gap:8px"><i class="dot" style="background:var(${g.color})"></i>${ic(g.icon)} ${g.label}</span><span class="muted small">مفيش الشهر ده</span></div>`;
  return `
    <div class="row between" style="margin-bottom:14px">
      <div class="row">
        <button class="icon-btn" data-mshift="-1" aria-label="الشهر اللي فات" title="الشهر اللي فات">${ic('chevron-right')}</button>
        <h2 style="font-size:20px;min-width:140px;text-align:center">${fullMonth(key)}</h2>
        <button class="icon-btn" data-mshift="1" aria-label="الشهر الجاي" title="الشهر الجاي" ${key >= nowKey ? 'disabled style="opacity:.35"' : ''}>${ic('chevron-left')}</button>
      </div>
      <div class="row"><span class="muted small">الدخل من العملاء محسوب من:</span><div class="seg" id="incMode">${[['auto', 'تلقائي'], ['transfers', 'التحويلات المؤكدة'], ['projects', 'المشاريع في الشيت']].map(([v, l]) => `<button class="${S.incomeMode === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="grid g-4">
      ${kpi({ icon: 'arrow-down-to-line', cls: 'i2', label: 'دخلك', value: I.fmt(mc.income), unit: 'ج.م', foot: dl(mc.income, pc.income) })}
      ${kpi({ icon: 'arrow-up-from-line', cls: 'i3', label: 'صرفت', value: I.fmt(mc.spend), unit: 'ج.م', foot: pc.spend ? `${I.pct((mc.spend - pc.spend) / pc.spend * 100)} عن الشهر اللي فات` : '' })}
      ${kpi({ icon: 'piggy-bank', cls: 'i1', label: mc.left >= 0 ? 'فاضلك' : 'عجز', value: `<span style="color:${mc.left >= 0 ? 'var(--good-text)' : 'var(--critical)'}">${I.fmt(Math.abs(mc.left))}</span>`, unit: 'ج.م', foot: dl(mc.left, pc.left) })}
      ${kpi({ icon: 'percent', cls: 'i4', label: 'نسبة اللي فضل من دخلك', value: mc.income ? pctOf(mc.left) + '%' : '—', foot: mc.income ? (mc.left / mc.income >= 0.2 ? 'ادخار ممتاز' : mc.left >= 0 ? 'حاول توصل لـ 20%' : 'صرفت أكتر من دخلك') : 'سجّل دخلك' })}
    </div>
    <div class="grid g-main" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h3>${ic('pie-chart')} فلوسك راحت فين</h3><span class="sub">${mc.income ? `من دخل ${I.money(mc.income)}` : 'من إجمالي المصاريف'}</span></div>
        ${segs.length ? `<div class="stackbar" role="img" aria-label="توزيع الدخل على المصاريف">${segs.map(s => `<span style="width:${s.v / segTotal * 100}%;background:var(${s.color})" title="${s.label}: ${I.money(s.v)}"></span>`).join('')}</div>
        <div class="legend" style="margin:10px 0 16px">${segs.map(s => `<span><i style="background:var(${s.color})"></i>${s.label} ${pctOf(s.v)}%</span>`).join('')}</div>` : ''}
        <div class="stack" style="gap:6px">${mc.groups.map(detail).join('')}
          <div class="money-details empty-row" style="border-top:2px solid var(--border-strong)"><span class="row" style="gap:8px"><i class="dot" style="background:var(${LEFT_COLOR})"></i>${ic('piggy-bank')} <b>${mc.left >= 0 ? 'فاضلك' : 'عجز'}</b></span><b class="num" style="color:${mc.left >= 0 ? 'var(--good-text)' : 'var(--critical)'}">${I.money(mc.left)}</b></div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>${ic('arrow-down-to-line')} الدخل</h3></div>
          <div class="list">
            <div class="list-item" style="cursor:default"><div class="li-body"><div class="li-title">من العملاء</div><div class="li-sub">${mc.useTransfers ? 'التحويلات اللي أكدتها الشهر ده' : 'المدفوع في المشاريع اللي اتسجلت الشهر ده'}</div></div><div class="li-end"><b class="num">${I.fmt(mc.clients)}</b></div></div>
            ${mc.fromAds ? `<div class="list-item" style="cursor:default;padding-inline-start:24px"><div class="li-body"><div class="li-sub">${ic('megaphone')} إيرادات متسجلة من حملاتك الإعلانية (للمعلومة)</div></div><div class="li-end"><span class="num small">${I.fmt(mc.fromAds)}</span></div></div>` : ''}
            ${mc.otherItems.map(x => `<div class="list-item" style="cursor:default"><div class="li-body"><div class="li-title">${esc(x.label)}</div><div class="li-sub">${esc(x.sub || 'دخل تاني')}</div></div><div class="li-end"><b class="num">${I.fmt(x.amount)}</b></div></div>`).join('')}
          </div>
          <div class="row" style="margin-top:10px"><button class="btn sm" data-add="otherIncome">${ic('plus')} دخل تاني (مرتب، أرباح…)</button></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>${ic('briefcase')} ربح الشغل</h3></div>
          <p style="margin:0" class="small muted">الدخل − (الإعلانات + الاشتراكات + مصاريف الشغل)، من غير المصاريف الشخصية والأقساط</p>
          <div class="kpi" style="margin-top:8px"><div class="value" style="color:${mc.businessProfit >= 0 ? 'var(--good-text)' : 'var(--critical)'}">${I.fmt(mc.businessProfit)} <small>ج.م</small></div></div>
          ${mc.groups[0].total ? `<p class="small" style="margin:10px 0 0">${ic('megaphone')} الإعلانات: صرفت ${I.money(mc.groups[0].total)} وجابت ${I.money(mc.fromAds)}${mc.adsReturn != null ? ` — كل 1 جنيه رجّع <b>${mc.adsReturn.toFixed(1)}</b>` : ''}</p>` : ''}
        </div>
        <div class="row"><button class="btn" id="mcCopy">${ic('copy')} انسخ ملخص الشهر</button>${addExpenseBtns}</div>
      </div>
    </div>`;
}

function monthSummaryText() {
  const key = S.closeMonth || D.monthKey(new Date()), mc = I.monthClose(key, moneyData(), S.incomeMode);
  return [
    `تقفيل شهر ${fullMonth(key)}`, '',
    `الدخل: ${I.money(mc.income)}`,
    `- من العملاء: ${I.money(mc.clients)}`,
    ...(mc.fromAds ? [`- إيرادات متسجلة من الحملات الإعلانية: ${I.money(mc.fromAds)}`] : []),
    ...mc.otherItems.map(x => `- ${x.label}: ${I.money(x.amount)}`), '',
    `المصاريف: ${I.money(mc.spend)}`,
    ...mc.groups.filter(g => g.total).map(g => `- ${g.label}: ${I.money(g.total)}`), '',
    `ربح الشغل: ${I.money(mc.businessProfit)}`,
    `${mc.left >= 0 ? 'فاضلي' : 'عجز'}: ${I.money(Math.abs(mc.left))}${mc.income ? ` (${Math.round(mc.left / mc.income * 100)}% من الدخل)` : ''}`,
  ].join('\n');
}

const subAvatar = s => avatar(s.name, s.name);

function subsHTML() {
  const subs = [...S.subscriptions].sort((a, b) => a.cancelled - b.cancelled || (a.daysToNext ?? 999) - (b.daysToNext ?? 999));
  const active = subs.filter(s => !s.cancelled);
  const monthly = sum(active, s => s.monthlyEGP);
  const next = active.filter(s => s.next).sort((a, b) => a.next - b.next)[0];
  const have = new Set(S.subscriptions.map(s => s.name.toLowerCase()));
  const presets = D.SUB_PRESETS.filter(([n]) => !have.has(n.toLowerCase()));
  const chips = `<div class="card" style="margin-bottom:16px"><div class="card-head" style="margin-bottom:10px"><h3>${ic('zap')} ضيف بسرعة</h3><span class="sub">دوس على البرنامج واكتب سعره وتاريخ الدفع</span></div>
    <div class="chips" style="flex-wrap:wrap">${presets.map(([n, c]) => `<button class="chip" data-add="subscriptions" data-pre='${esc(JSON.stringify({ name: n, category: c }))}'>${ic('plus')}${n}</button>`).join('')}<button class="chip" data-add="subscriptions">${ic('plus')}برنامج تاني</button></div></div>`;
  if (!subs.length) return chips + emptyState('repeat', 'مفيش اشتراكات متسجلة', 'سجّل اشتراكات البرامج اللي بتشتغل عليها، وهيجيلك تذكير قبل كل تجديد، وهتدخل لوحدها في تقفيل الشهر.');
  return `<div class="grid g-4">
      ${kpi({ icon: 'repeat', cls: 'i1', label: 'اشتراكات شغالة', value: active.length, foot: subs.length > active.length ? `${subs.length - active.length} ملغي` : '' })}
      ${kpi({ icon: 'calendar', cls: 'i3', label: 'بتدفع في الشهر', value: I.fmt(monthly), unit: 'ج.م', foot: `بسعر الدولار ${S.settings.usdRate} ج.م` })}
      ${kpi({ icon: 'calendar-range', cls: 'i4', label: 'في السنة', value: I.fmt(monthly * 12), unit: 'ج.م' })}
      ${kpi({ icon: 'bell-ring', cls: 'i2', label: 'أقرب تجديد', value: next ? esc(next.name) : '—', foot: next ? `${fmtDate(next.next)} · ${dueText(next.daysToNext)}` : '' })}
    </div>
    <div style="margin-top:16px">${chips}</div>
    <div class="project-grid">${subs.map(s => `<div class="card pcard" data-edit="subscriptions:${s.id}" style="${s.cancelled ? 'opacity:.55' : ''}">
      <div class="top">${subAvatar(s)}<div class="li-body"><div class="li-title">${esc(s.name)}</div><div class="li-sub">${esc(s.category || '')}${s.method ? ' · ' + esc(s.method) : ''}</div></div>
        ${s.cancelled ? `<span class="badge tone-muted">${ic('circle-x')}ملغي</span>` : s.next ? `<span class="badge tone-${s.daysToNext <= 2 ? 'warning' : 'info'}">${ic('repeat')}${dueText(s.daysToNext)}</span>` : ''}</div>
      <div class="money-row"><span>${s.yearly ? 'سنوي' : 'شهري'}</span><b>${esc(s.price)} ${esc(s.currency || '')}</b></div>
      <div class="money-row"><span>${s.cancelled ? 'اتلغى' : 'التجديد الجاي'}</span><span>${s.cancelled ? fmtDate(s.cancelDate ? D.parseDate(s.cancelDate) : null) || '—' : s.next ? fmtDate(s.next) : 'اكتب تاريخ الدفع'}</span></div>
      ${!s.cancelled ? `<div class="money-row"><span>≈ في الشهر</span><b>${I.money(s.monthlyEGP)}</b></div>` : ''}
    </div>`).join('')}</div>`;
}

function instHTML() {
  const list = [...S.installments].sort((a, b) => a.done - b.done || (a.daysToDue ?? 999) - (b.daysToDue ?? 999));
  const active = list.filter(i => !i.done);
  if (!list.length) return emptyState('calendar-range', 'مفيش أقساط متسجلة', 'سجّل أي قسط بتدفعه (لابتوب، موبايل، جمعية…) وهيجيلك تذكير قبل ميعاده، وتعرف فاضل عليك كام.', `<button class="btn primary" data-add="installments">${ic('plus')} ضيف قسط</button>`);
  const next = active.filter(i => i.nextDue).sort((a, b) => a.nextDue - b.nextDue)[0];
  return `<div class="grid g-3">
      ${kpi({ icon: 'calendar-range', cls: 'i3', label: 'أقساطك في الشهر', value: I.fmt(sum(active, i => i.monthlyEGP)), unit: 'ج.م', foot: `${active.length} قسط شغال` })}
      ${kpi({ icon: 'hourglass', cls: 'i4', label: 'فاضل عليك', value: I.fmt(sum(active, i => i.remainingEGP)), unit: 'ج.م' })}
      ${kpi({ icon: 'bell-ring', cls: 'i2', label: 'أقرب قسط', value: next ? esc(next.name) : '—', foot: next ? `${fmtDate(next.nextDue)} · ${dueText(next.daysToDue)}` : 'مفيش' })}
    </div>
    <div class="project-grid" style="margin-top:16px">${list.map(i => `<div class="card pcard" data-edit="installments:${i.id}" style="${i.done ? 'opacity:.6' : ''}">
      <div class="top"><div class="avatar" style="background:linear-gradient(135deg,#f59e0b,#f43f5e)">${ic('calendar-range')}</div><div class="li-body"><div class="li-title">${esc(i.name)}</div><div class="li-sub">${esc(i.monthly)} ${esc(i.currency || 'جنيه')} في الشهر · ${i.months} شهر</div></div>
        ${i.done ? `<span class="badge tone-good">${ic('badge-check')}خلص</span>` : i.nextDue ? `<span class="badge tone-${dueTone(i.daysToDue)}">${ic('calendar-clock')}${dueText(i.daysToDue)}</span>` : ''}</div>
      <div><div class="progress"><span style="width:${i.months ? i.paidCount / i.months * 100 : 0}%"></span></div>
        <div class="money-row" style="margin-top:6px"><span>اتدفع ${i.paidCount} من ${i.months}</span><span>فاضل <b>${I.fmt(i.remainingN)} ${esc(i.currency || 'جنيه')}</b></span></div></div>
      <div class="money-row"><span>آخر قسط</span><span>${i.endDate ? fmtDate(i.endDate) : '—'}</span></div>
      ${!i.done && !i.paidThisMonth && i.nextDue && i.daysToDue <= 7 ? `<button class="btn primary sm" data-ipay="${i.id}">${ic('check')} دفعت قسط الشهر ده</button>` : i.paidThisMonth ? `<span class="muted small">${ic('check')} قسط الشهر ده اتدفع</span>` : ''}
    </div>`).join('')}</div>`;
}

function incomeHTML() {
  const list = [...S.otherIncome].sort((a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0));
  const intro = `<p class="muted small" style="margin:0 0 14px">${ic('info')} أي فلوس بتدخلك غير فلوس العملاء اللي في الشيت: مرتب شغلك في KDP، أرباح كتب، شغل فريلانس تاني… بتدخل في تقفيل الشهر.</p>`;
  if (!list.length) return intro + emptyState('hand-coins', 'مفيش دخل تاني متسجل', 'زي "مرتب كل شهر من شغل Amazon KDP".', `<button class="btn primary" data-add="otherIncome" data-pre='${esc(JSON.stringify({ source: 'مرتب شغل KDP' }))}'>${ic('plus')} سجّل مرتب الشهر</button>`);
  const mk = D.monthKey(new Date());
  const cur = list.filter(x => x.dateObj && D.monthKey(x.dateObj) === mk);
  return intro + `<div class="grid g-3">
      ${kpi({ icon: 'hand-coins', cls: 'i2', label: `دخل تاني في ${I.monthName(new Date())}`, value: I.fmt(sum(cur, x => x.amountEGP)), unit: 'ج.م' })}
      ${kpi({ icon: 'sigma', cls: 'i1', label: 'إجمالي المتسجل', value: I.fmt(sum(list, x => x.amountEGP)), unit: 'ج.م' })}
      ${kpi({ icon: 'calendar', cls: 'i4', label: 'متوسط الشهر', value: I.fmt(sum(list, x => x.amountEGP) / Math.max(new Set(list.filter(x => x.dateObj).map(x => D.monthKey(x.dateObj))).size, 1)), unit: 'ج.م' })}
    </div>
    <div class="card" style="margin-top:16px"><div class="list">${list.map(x => `<div class="list-item" data-edit="otherIncome:${x.id}"><div class="avatar" style="background:linear-gradient(135deg,#10b981,#0fb5d4)">${ic('hand-coins')}</div>
      <div class="li-body"><div class="li-title">${esc(x.source)}</div><div class="li-sub">${fmtDate(x.dateObj) || esc(x.date)}${x.notes ? ' · ' + esc(x.notes) : ''}</div></div><div class="li-end"><b>${esc(x.amount)} ${esc(x.currency || '')}</b></div></div>`).join('')}</div></div>`;
}

VIEWS.money = {
  title: () => 'الفلوس والمصاريف',
  sub: () => 'دخلت كام، راحت فين، وفضلك كام',
  render() {
    const t = S.moneyTab;
    const tabs = `<div class="seg" id="mtabs" style="margin-bottom:16px;flex-wrap:wrap">${MONEY_TABS.map(([v, l, i]) => `<button class="${t === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    return tabs + ({ close: monthCloseHTML, subs: subsHTML, inst: instHTML, expenses: () => VIEWS.expenses.render(), income: incomeHTML }[t] || monthCloseHTML)();
  },
  after() {
    $$('#mtabs button').forEach(b => b.onclick = () => { S.moneyTab = b.dataset.v; history.replaceState(null, '', `#/money?t=${b.dataset.v}`); renderView(true); });
    $$('[data-mshift]').forEach(b => b.onclick = () => { const now = D.monthKey(new Date()); const k = shiftMonth(S.closeMonth || now, Number(b.dataset.mshift)); if (k > now) return; S.closeMonth = k; renderView(true); });
    $$('#incMode button').forEach(b => b.onclick = () => { S.incomeMode = b.dataset.v; D.LS.set('incomeMode', S.incomeMode); renderView(true); });
    $('#mcCopy') && ($('#mcCopy').onclick = () => navigator.clipboard.writeText(monthSummaryText()).then(() => toast('اتنسخ الملخص', 'ok')));
    $$('[data-ipay]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const i = S.installments.find(x => x.id === b.dataset.ipay);
      if (await save('installments', 'update', i._row, { paidCount: String(i.paidCount + 1), lastPaid: D.monthKey(new Date()) }, checkFor('installments', i))) confetti();
    });
    if (S.moneyTab === 'expenses') VIEWS.expenses.after();
  },
};

/* ── Amazon Ads ── */
const acosTone = a => a == null ? 'muted' : a < 30 ? 'good' : a < 50 ? 'warning' : 'critical';
VIEWS.ads = {
  title: () => 'حملات Amazon Ads',
  sub: () => 'تابع أداء إعلانات كتب عملاءك',
  render() {
    const intro = `<div class="card insight t-info" style="margin-bottom:16px"><div class="ins-icon tone-info">${ic('info')}</div><div><h4>سجّل أرقام كل حملة من لوحة Amazon Ads (أسبوعياً مثلاً)</h4><p>الأبلكيشن بيحسب ACoS وROAS وتكلفة النقرة ويقولك الحملة كسبانة ولا خسرانة. استخدم <a href="#/tools?t=ads" style="color:var(--accent)">حاسبة الإعلانات</a> عشان تعرف الـ Break-even ACoS لكل كتاب.</p></div></div>`;
    if (!S.ads.length) return intro + emptyState('target', 'مفيش حملات متسجلة', 'ابدأ بتسجيل أول حملة.', `<button class="btn primary" data-add="ads">${ic('plus')} حملة جديدة</button>`);
    const spend = sum(S.ads, a => a.spend), sales = sum(S.ads, a => a.sales), orders = sum(S.ads, a => a.orders), clicks = sum(S.ads, a => a.clicks);
    const byBook = Object.entries(I.groupBy(S.ads, a => a.book)).map(([b, as]) => { const sp = sum(as, a => a.spend), sa = sum(as, a => a.sales); return { b, sp, sa, acos: sa ? sp / sa * 100 : null, n: as.length }; });
    const list = [...S.ads].sort((a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0));
    return intro + `<div class="grid g-4">
      ${kpi({ icon: 'dollar-sign', cls: 'i3', label: 'إجمالي الإنفاق', value: '$' + spend.toFixed(0), foot: `≈ ${I.money(spend * S.settings.usdRate)}` })}
      ${kpi({ icon: 'trending-up', cls: 'i2', label: 'إجمالي المبيعات', value: '$' + sales.toFixed(0), foot: `${orders} طلب` })}
      ${kpi({ icon: 'percent', cls: 'i1', label: 'ACoS', value: sales ? Math.round(spend / sales * 100) + '%' : '—', foot: `<span class="badge tone-${acosTone(sales ? spend / sales * 100 : null)}">${sales && spend / sales < .3 ? 'ممتاز' : sales && spend / sales < .5 ? 'مقبول' : 'محتاج تحسين'}</span>` })}
      ${kpi({ icon: 'mouse-pointer-click', cls: 'i4', label: 'تكلفة النقرة CPC', value: clicks ? '$' + (spend / clicks).toFixed(2) : '—', foot: `ROAS ${spend ? (sales / spend).toFixed(1) : '—'}x` })}
    </div>
    <h2 class="section-title">${ic('book')} حسب الكتاب</h2>
    <div class="card"><div class="table-wrap"><table class="data"><thead><tr><th>الكتاب / العميل</th><th>سجلات</th><th>الإنفاق</th><th>المبيعات</th><th>ACoS</th></tr></thead><tbody>
      ${byBook.map(r => `<tr><td>${esc(r.b)}</td><td class="n">${r.n}</td><td class="n">$${r.sp.toFixed(2)}</td><td class="n">$${r.sa.toFixed(2)}</td><td class="n"><span class="badge tone-${acosTone(r.acos)}">${r.acos == null ? '—' : Math.round(r.acos) + '%'}</span></td></tr>`).join('')}
    </tbody></table></div></div>
    <h2 class="section-title">${ic('list')} كل السجلات</h2>
    <div class="card"><div class="list">${list.map(a => `<div class="list-item" data-edit="ads:${a.id}"><div class="avatar" style="background:linear-gradient(135deg,#f59e0b,#ec4899)">${ic('target')}</div>
      <div class="li-body"><div class="li-title">${esc(a.book)} — ${esc(a.campaign || a.type || '')}</div><div class="li-sub">${fmtDate(a.dateObj) || esc(a.date)} · ${a.clicks} نقرة · ${a.orders} طلب${a.cpc ? ` · CPC $${a.cpc.toFixed(2)}` : ''}</div></div>
      <div class="li-end"><b>$${a.spend} → $${a.sales}</b><span class="badge tone-${acosTone(a.acos)}">ACoS ${a.acos == null ? '—' : Math.round(a.acos) + '%'}</span></div></div>`).join('')}</div></div>`;
  },
};

/* ── الملاحظات ── */
VIEWS.notes = {
  title: () => 'ملاحظاتي وأفكاري',
  sub: () => 'أي فكرة تيجي في بالك سجّلها هنا — بتتحفظ في الشيت',
  render() {
    if (!S.notes.length) return emptyState('notebook-pen', 'مفيش ملاحظات', 'سجّل أفكار خدمات جديدة، عملاء محتملين، أو أي حاجة عايز تفتكرها.', `<button class="btn primary" data-add="notes">${ic('plus')} ملاحظة جديدة</button>`);
    const list = [...S.notes].sort((a, b) => b._row - a._row);
    return `<div class="grid g-3">${list.map(n => `<div class="card pcard" data-edit="notes:${n.id}"><div class="row between"><span class="tag">${ic('tag')}${esc(n.category || 'عام')}</span><span class="muted small">${fmtDate(n.dateObj) || esc(n.date || '')}</span></div><h3 style="font-size:16px">${esc(n.title)}</h3><p class="muted" style="margin:0;white-space:pre-wrap">${esc(n.body || '')}</p></div>`).join('')}</div>`;
  },
};

/* ── المزيد ── */
VIEWS.more = {
  title: () => 'المزيد',
  render() {
    const tiles = [['analytics', 'التحليلات', 'chart-column', 'البيزنس بيكبر ولا لأ'], ['ideas', 'الأفكار والنمو', 'lightbulb', 'أفكار من أرقامك'], ['tasks', 'المهام', 'list-checks', `${S.tasks.filter(t => !t.done).length} مفتوحة`], ['ads', 'Amazon Ads', 'target', `كتب العملاء · ${S.ads.length} سجل`], ['money', 'الفلوس والمصاريف', 'wallet', 'تقفيل الشهر، اشتراكات، أقساط'], ['notes', 'ملاحظاتي', 'notebook-pen', `${S.notes.length} ملاحظة`], ['tools', 'الأدوات والرسائل', 'calculator', 'عروض أسعار ورسائل جاهزة'], ['settings', 'الإعدادات', 'settings', 'الربط والإشعارات'], ['setup', 'دليل الربط والتثبيت', 'book-open-check', 'خطوة بخطوة']];
    return `<div class="more-grid">${tiles.map(([k, l, i, s]) => `<a class="card more-tile" href="#/${k}"><div class="kpi-icon">${ic(i)}</div><b>${l}</b><small>${s}</small></a>`).join('')}</div>`;
  },
};

// كروت الرئيسية: تحويلات مستنية تأكيد + الحملات الشغالة
function homeLiveCards() {
  const pend = S.payments.filter(p => p.statusKey === 'pending');
  const live = S.campaigns.filter(c => c.state === 'active');
  const hasMoney = S.subscriptions.length || S.installments.length || S.otherIncome.length || S.expenses.length;
  if (!pend.length && !live.length && !hasMoney) return '';
  const cards = [];
  if (hasMoney) {
    const mc = I.monthClose(D.monthKey(new Date()), moneyData(), S.incomeMode);
    const soon = [...S.subscriptions.filter(s => s.next && s.daysToNext <= 7).map(s => `${s.name} ${dueText(s.daysToNext)}`), ...S.installments.filter(i => i.nextDue && !i.done && i.daysToDue <= 7).map(i => `${i.name} ${dueText(i.daysToDue)}`)];
    cards.push(`<div class="card insight t-${mc.left >= 0 ? 'good' : 'critical'}"><div class="ins-icon tone-${mc.left >= 0 ? 'good' : 'critical'}">${ic('wallet')}</div><div>
      <div class="muted small">${I.monthName(new Date())} لحد النهارده</div>
      <h4>دخلك ${I.money(mc.income)} · صرفت ${I.money(mc.spend)} · ${mc.left >= 0 ? 'فاضلك' : 'عجز'} ${I.money(Math.abs(mc.left))}</h4>
      <p>${soon.length ? `جاي قريب: ${esc(soon.slice(0, 3).join('، '))}` : 'مفيش اشتراكات أو أقساط الأسبوع ده.'}</p>
      <a class="btn sm" href="#/money?t=close">تقفيل الشهر ${ic('chevron-left')}</a></div></div>`);
  }
  if (pend.length) cards.push(`<div class="card insight t-warning"><div class="ins-icon tone-warning">${ic('receipt-text')}</div><div><h4>${pend.length} تحويل مستني تأكيدك (${I.money(sum(pend, p => p.amountEGP))})</h4><p>${esc(pend.slice(0, 3).map(p => p.client).join('، '))}. اتأكد إن الفلوس وصلت ودوس "وصلت".</p><a class="btn sm" href="#/payments">راجعهم ${ic('chevron-left')}</a></div></div>`);
  live.slice(0, pend.length ? 1 : 2).forEach(c => cards.push(`<div class="card insight t-${c.revenueEGP >= c.spentEGP ? 'good' : 'info'}"><div class="ins-icon tone-${c.revenueEGP >= c.spentEGP ? 'good' : 'info'}">${ic('megaphone')}</div><div>
    <div class="muted small">حملة شغالة · اليوم ${c.elapsed} من ${c.totalDays}</div><h4>${esc(c.name)}</h4>
    <p>صرفت ${I.money(c.spentEGP)}${c.spentEstimated ? ' (الميزانية)' : ''} · جابت ${I.money(c.revenueEGP)}${c.roas != null && c.revenueEGP ? ` · كل 1 جنيه رجّع ${c.roas.toFixed(1)}` : ''}</p>
    <div class="row" style="margin-top:10px"><button class="btn sm primary" data-cinc="${c.rowId}">${ic('plus')} ضيف إيراد</button><a class="btn sm" href="#/campaign/${c.rowId}">التفاصيل</a></div></div></div>`));
  return `<div class="grid g-2" style="margin-top:16px">${cards.join('')}</div>`;
}

/* ═════════════ التحويلات والمدفوعات ═════════════ */

const PAY_TONE = { pending: 'warning', confirmed: 'good', rejected: 'critical' };
const PAY_ICON = { pending: 'hourglass', confirmed: 'badge-check', rejected: 'circle-x' };
const payBadge = p => `<span class="badge tone-${PAY_TONE[p.statusKey]}">${ic(PAY_ICON[p.statusKey])}${D.PAY_STATUS[p.statusKey]}</span>`;
const thumb = url => url
  ? `<button type="button" class="thumb" data-rcpt-view="${esc(url)}" aria-label="عرض صورة التحويل"><img data-rcpt="${esc(url)}" alt=""></button>`
  : `<div class="thumb empty" title="من غير صورة">${ic('image-off')}</div>`;
const unitOf = p => p.currency === 'SAR' ? 'ريال' : p.currency === 'USD' ? 'دولار' : 'جنيه';
const COUNTRY_OF = [['مصر', /مصر/], ['السعودية', /سعود/], ['الإمارات', /امارات|إمارات/], ['الكويت', /كويت/], ['قطر', /قطر/], ['البحرين', /بحرين/], ['عُمان', /عمان|عُمان/], ['الأردن', /أردن|اردن/], ['العراق', /عراق/], ['المغرب', /مغرب/]];
const countryOf = nat => (COUNTRY_OF.find(([, re]) => re.test(nat || '')) || [''])[0];

function paymentRow(p) {
  return `<div class="list-item" data-edit="payments:${p.id}">${thumb(p.receipt)}
    <div class="li-body"><div class="li-title">${esc(p.client || 'عميل')} — ${esc(p.amount)} ${esc(p.currency || '')}</div>
    <div class="li-sub">${esc(p.method || '')} · ${fmtDate(p.dateObj) || esc(p.date)}${p.project ? ' · ' + esc(I.short(p.project, 40)) : ''}</div></div>
    <div class="li-end">${payBadge(p)}</div></div>`;
}

// الصور بتتحمل مرة واحدة من درايف وبعدين بتتحفظ على الجهاز
const rcptMem = new Map();
async function receiptSrc(url) {
  if (rcptMem.has(url)) return rcptMem.get(url);
  let src;
  if (url.startsWith('local:')) src = await idbGet(url.slice(6));
  else {
    const id = driveId(url);
    src = id && await idbGet('rcpt:' + id);
    if (!src && id && hasRemote()) { src = await D.fetchReceipt(S.settings, id); idbSet('rcpt:' + id, src); }
  }
  if (!src) throw new Error('الصورة مش موجودة');
  rcptMem.set(url, src);
  return src;
}
function loadThumbs(root = document) {
  $$('img[data-rcpt]:not([src])', root).forEach(img => receiptSrc(img.dataset.rcpt)
    .then(src => { img.src = src; })
    .catch(() => { img.closest('.thumb, .pay-img')?.classList.add('err'); }));
}
async function viewReceipt(url) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<div class="muted">${ic('loader')} بتحميل الصورة…</div><div class="row">${url.startsWith('local:') ? '' : `<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">${ic('external-link')} افتحها في درايف</a>`}<button class="btn sm">${ic('x')} إغلاق</button></div>`;
  box.onclick = e => { if (e.target === box || e.target.closest('button')) box.remove(); };
  document.body.append(box); paint();
  try { const src = await receiptSrc(url); box.firstElementChild.outerHTML = `<img src="${src}" alt="صورة التحويل">`; }
  catch (e) { box.firstElementChild.textContent = 'مش قادر أحمّل الصورة: ' + e.message; }
}

// بنصغّر الصورة قبل الرفع (أسرع ومساحة أقل على درايف)
async function compressImage(blob, max = 1600, q = 0.82) {
  let src;
  try { src = await createImageBitmap(blob); }
  catch { const u = URL.createObjectURL(blob); src = new Image(); src.src = u; await src.decode(); }
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', q);
  return { dataUrl, b64: dataUrl.split(',')[1], mime: 'image/jpeg', name: `تحويل-${D.isoDay(new Date())}-${String(Date.now()).slice(-5)}.jpg` };
}
async function setReceiptDraft(blob) {
  if (!S.receiptDraft || !blob) return;
  try {
    const img = await compressImage(blob);
    S.receiptDraft.file = img;
    const prev = $('#rcPrev'); if (!prev) return;
    prev.src = img.dataUrl; prev.hidden = false; $('#rcEmpty').hidden = true;
  } catch { toast('الملف ده مش صورة أو مش مدعوم', 'err'); }
}

// المبلغ بعملة المشروع (لو العميل حوّل بعملة مختلفة)
const amountInProject = (proj, amount, unit) => {
  if (unit === unitOf(proj)) return amount;
  return Math.round(D.toEGP(amount, unit, S.settings) / proj.rate);
};

function openPaymentForm(item = null, pre = {}) {
  const selRow = item?.projectRowN || pre.project?._row || '';
  const projs = [...S.projects].sort((a, b) => (b._row === selRow) - (a._row === selRow) || b.remainingEGP - a.remainingEGP);
  S.receiptDraft = { file: null };
  const d = item?.dateObj || new Date();
  openSheet({
    title: `${ic('receipt-text')} ${item ? 'تعديل التحويل' : 'صورة تحويل جديدة'}`,
    body: `
      <label class="drop" id="rcDrop">
        <img id="rcPrev" alt="صورة التحويل" hidden>
        <div id="rcEmpty" class="drop-empty">${ic('image-plus')}<b>${item?.receipt ? 'اختار صورة جديدة لو عايز تغيرها' : 'ضيف صورة التحويل'}</b>
          <span class="muted small">دوس هنا واختار من الصور${matchMedia('(pointer: fine)').matches ? '، أو الصق الصورة (Ctrl+V)، أو اسحبها وافلتها هنا' : '، أو شارك الصورة من واتساب لـ KDP Hub'}</span></div>
        <input type="file" accept="image/*" id="rcFile" hidden>
      </label>
      ${item?.receipt ? `<div class="row" style="margin-top:8px">${thumb(item.receipt)}<span class="muted small">الصورة الحالية</span></div>` : ''}
      <form class="form" id="payForm" onsubmit="return false" style="margin-top:16px">
        <div class="field full"><label>${ic('folder-kanban')} المشروع</label><select name="projectRow">
          <option value="">— عميل مش في القايمة —</option>
          ${projs.map(p => `<option value="${p._row}" ${p._row === selRow ? 'selected' : ''}>${esc(p.displayName)} — ${esc(I.short(p.project, 40))}${p.remainingEGP > 0 ? ` (باقي ${I.fmt(p.remainingEGP / p.rate)} ${unitOf(p)})` : ''}</option>`).join('')}
        </select></div>
        <div class="field full"><label>${ic('user')} اسم العميل</label><input name="client" value="${esc(item?.client || pre.project?.displayName || '')}"></div>
        <div class="field"><label>${ic('coins')} المبلغ اللي اتحوّل</label><input name="amount" inputmode="decimal" value="${esc(item?.amount || '')}"></div>
        <div class="field"><label>${ic('banknote')} العملة</label><select name="currency">${D.MONEY_UNITS.map(u => `<option ${(item?.currency || 'جنيه') === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div class="field"><label>${ic('wallet')} طريقة الدفع</label><select name="method">${D.PAY_METHODS.map(m => `<option ${(item?.method || 'فودافون كاش') === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label>${ic('calendar')} التاريخ</label><input type="date" name="date" value="${D.isoDay(d)}"></div>
        <div class="field full"><label>${ic('sticky-note')} ملاحظات</label><textarea name="notes" style="min-height:60px">${esc(item?.notes || '')}</textarea></div>
        ${item ? '' : `<label class="check full"><input type="checkbox" id="payConfirmNow">${ic('badge-check')} راجعت وأكدت إن الفلوس وصلت فعلاً</label>
        <label class="check full" id="applyWrap" hidden><input type="checkbox" id="payApply" checked>${ic('file-pen-line')} ضيف المبلغ لحساب المشروع في الشيت (المدفوع والباقي)</label>`}
      </form>`,
    foot: `<button class="btn primary" id="paySave">${ic('check')} حفظ</button><button class="btn ghost" id="payCancel">إلغاء</button>${item ? `<button class="btn danger" id="payDel" style="margin-inline-start:auto">${ic('trash-2')} حذف</button>` : ''}`,
  });
  loadThumbs($('#sheet'));
  const form = $('#payForm'), f = n => form.querySelector(`[name="${n}"]`);
  const drop = $('#rcDrop');
  $('#rcFile').onchange = e => setReceiptDraft(e.target.files[0]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); setReceiptDraft([...e.dataTransfer.files].find(x => x.type.startsWith('image/'))); };
  if (pre.file) setReceiptDraft(pre.file);

  const syncProject = (first = false) => {
    const p = S.projects.find(x => x._row === Number(f('projectRow').value));
    if (p && (!first || !item)) {
      f('client').value = p.displayName;
      f('currency').value = unitOf(p);
      if (!f('amount').value && p.remainingEGP > 0) f('amount').value = Math.round(p.remainingEGP / p.rate);
      if (!item) f('method').value = /سعود|امارات|إمارات|كويت|قطر/.test(p.nationality) ? 'برق' : 'فودافون كاش';
    }
    const wrap = $('#applyWrap'); if (wrap) wrap.hidden = !(p && $('#payConfirmNow').checked);
  };
  f('projectRow').onchange = () => { f('amount').value = ''; syncProject(); };
  $('#payConfirmNow')?.addEventListener('change', () => syncProject());
  syncProject(true);

  $('#payCancel').onclick = () => { S.receiptDraft = null; pre.project ? openProject(pre.project.id) : closeSheet(); };
  $('#payDel') && ($('#payDel').onclick = () => confirmDelete('payments', { ...item, name: `تحويل ${item.client || ''} (${item.amount})` }));
  $('#paySave').onclick = async () => {
    const amount = Number(D.toLatin(f('amount').value).replace(/[^\d.]/g, ''));
    if (!amount) return toast('اكتب المبلغ اللي اتحوّل', 'err');
    const proj = S.projects.find(x => x._row === Number(f('projectRow').value));
    const values = {
      date: f('date').value ? D.sheetDay(new Date(f('date').value + 'T00:00')) : D.sheetDay(new Date()),
      client: f('client').value.trim() || proj?.displayName || '', project: proj ? I.short(proj.project, 80) : '', projectRow: proj ? String(proj._row) : '',
      amount: String(amount), currency: f('currency').value, method: f('method').value, notes: f('notes').value.trim(),
    };
    if (!values.client) return toast('اختار المشروع أو اكتب اسم العميل', 'err');
    $('#paySave').disabled = true;
    const file = S.receiptDraft?.file || null;
    let ok;
    if (item) ok = await save('payments', 'update', item._row, values, checkFor('payments', item), file);
    else {
      const confirmed = $('#payConfirmNow').checked, apply = confirmed && proj && $('#payApply').checked;
      if (apply && !(await save('clients', 'update', proj._row, paymentValues(proj, amountInProject(proj, amount, values.currency)), checkFor('clients', proj)))) { $('#paySave').disabled = false; return; }
      ok = await save('payments', 'add', null, { ...values, status: confirmed ? D.PAY_STATUS.confirmed : D.PAY_STATUS.pending, applied: apply ? 'نعم' : '' }, null, file);
    }
    if (ok) { S.receiptDraft = null; closeSheet(); if (!item) confetti(); } else $('#paySave').disabled = false;
  };
}

function linkedProject(p) {
  if (!p.projectRowN) return null;
  return S.projects.find(x => x._row === p.projectRowN && (!p.client || x.displayName === D.cleanName(p.client))) || null;
}

async function confirmPayment(p, apply = true) {
  const proj = linkedProject(p);
  const doApply = apply && proj && !p.applied;
  if (doApply && !(await save('clients', 'update', proj._row, paymentValues(proj, amountInProject(proj, p.amountN, p.currency)), checkFor('clients', proj)))) return false;
  const ok = await save('payments', 'update', p._row, { status: D.PAY_STATUS.confirmed, applied: doApply || p.applied ? 'نعم' : '' }, checkFor('payments', p));
  if (ok) confetti();
  return ok;
}

function openPaymentDetail(p) {
  const proj = linkedProject(p);
  const num = proj ? D.whatsappNumber(proj) : '';
  const thanks = `أهلًا بحضرتك،\nوصلني التحويل بمبلغ ${p.amount} ${p.currency || ''}، شكرًا جدًا.\n${proj && !proj.isDone ? 'هكمل الشغل على المشروع وأبعت لحضرتك التحديثات أول بأول.' : 'سعيد بالتعامل مع حضرتك.'}`;
  openSheet({
    title: `${ic('receipt-text')} تحويل — ${esc(p.client || 'عميل')}`,
    body: `
      ${p.receipt ? `<div class="pay-img big" data-rcpt-view="${esc(p.receipt)}"><img data-rcpt="${esc(p.receipt)}" alt="صورة التحويل"></div>` : `<div class="empty" style="padding:20px">${ic('image-off')} مفيش صورة للتحويل ده</div>`}
      <div class="row" style="margin-top:12px">${payBadge(p)}${p.applied ? `<span class="badge tone-good">${ic('file-check')}اتسجل في حساب المشروع</span>` : ''}</div>
      <div class="kv">
        <div><small>المبلغ</small><b>${esc(p.amount)} ${esc(p.currency || '')}</b></div>
        <div><small>طريقة الدفع</small><b>${esc(p.method || '—')}</b></div>
        <div><small>التاريخ</small><b>${fmtDate(p.dateObj) || esc(p.date || '—')}</b></div>
        <div><small>المشروع</small><b>${proj ? `<a href="#" data-open="${proj.id}" style="color:var(--accent)">${esc(I.short(proj.project, 40))}</a>` : esc(p.project || '—')}</b></div>
      </div>
      ${p.notes ? `<p class="muted">${esc(p.notes)}</p>` : ''}
      ${p.statusKey !== 'confirmed' && proj && !p.applied ? `<label class="check"><input type="checkbox" id="pdApply" checked>${ic('file-pen-line')} لما أأكد: ضيف ${esc(p.amount)} ${esc(p.currency || '')} لحساب المشروع (باقي حالياً ${I.fmt(proj.remainingEGP / proj.rate)} ${unitOf(proj)})</label>` : ''}
      ${p.statusKey === 'confirmed' && proj && !p.applied ? `<button class="btn" id="pdApplyNow" style="margin-top:8px">${ic('file-pen-line')} ضيف المبلغ لحساب المشروع دلوقتي</button>` : ''}
      ${num && p.statusKey === 'confirmed' ? `<div class="row" style="margin-top:12px"><a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/${num}?text=${encodeURIComponent(thanks)}">${ic('send')} ابعت للعميل إن التحويل وصل</a></div>` : ''}`,
    foot: `${p.statusKey !== 'confirmed' ? `<button class="btn primary" id="pdOk">${ic('badge-check')} الفلوس وصلت — أكّد</button>` : ''}
      ${p.statusKey === 'pending' ? `<button class="btn" id="pdNo">${ic('circle-x')} مش واصلة</button>` : ''}
      <button class="btn ghost" id="pdEdit">${ic('pencil')} تعديل</button>`,
  });
  loadThumbs($('#sheet'));
  $('#pdOk') && ($('#pdOk').onclick = async () => { $('#pdOk').disabled = true; if (await confirmPayment(p, $('#pdApply')?.checked ?? true)) { const np = S.payments.find(x => x._row === p._row); np ? openPaymentDetail(np) : closeSheet(); } else $('#pdOk').disabled = false; });
  $('#pdNo') && ($('#pdNo').onclick = async () => { if (await save('payments', 'update', p._row, { status: D.PAY_STATUS.rejected }, checkFor('payments', p))) closeSheet(); });
  $('#pdApplyNow') && ($('#pdApplyNow').onclick = () => confirmPayment(p, true).then(ok => ok && closeSheet()));
  $('#pdEdit').onclick = () => openPaymentForm(p);
}

async function handleSharedReceipt() {
  try {
    const cache = await caches.open('kdphub-share');
    const res = await cache.match('shared-receipt');
    if (!res) return;
    const blob = await res.blob();
    await cache.delete('shared-receipt');
    history.replaceState(null, '', '#/payments');
    openPaymentForm(null, { file: blob });
  } catch { /* مفيش صورة متشاركة */ }
}

VIEWS.payments = {
  title: () => 'التحويلات والمدفوعات',
  sub: () => 'صور تحويلات العملاء: أكّدها وهتتسجل في حسابهم',
  render() {
    const d = device();
    const tip = `<div class="card insight t-info" style="margin-bottom:16px"><div class="ins-icon tone-info">${ic('share-2')}</div><div><h4>أسرع طريقة تبعت بيها صورة التحويل للأبلكيشن</h4><p>${d.ios
      ? 'على iPhone: احفظ الصورة من واتساب، وبعدين دوس + واختارها من الصور.'
      : d.mobile ? 'من واتساب: دوس على صورة التحويل ← مشاركة ← اختار <b>KDP Hub</b>، وهيفتحلك الأبلكيشن والصورة جاهزة (لازم يكون الأبلكيشن متثبت).'
        : 'على اللابتوب: من واتساب ويب انسخ الصورة (كليك يمين ← نسخ الصورة) وارجع هنا ودوس <b>Ctrl+V</b>، وهتتفتح لوحدها.'}</p></div></div>`;
    if (!S.payments.length) return tip + emptyState('receipt-text', 'مفيش تحويلات متسجلة', 'لما عميل يبعتلك صورة تحويل ضيفها هنا. بتتحفظ في فولدر على جوجل درايف، ولما تأكد إن الفلوس وصلت بيتسجل المبلغ في حساب المشروع لوحده.', `<button class="btn primary" data-act="new-payment">${ic('plus')} ضيف صورة تحويل</button>`);
    const pend = S.payments.filter(p => p.statusKey === 'pending');
    const conf = S.payments.filter(p => p.statusKey === 'confirmed');
    const mk = D.monthKey(new Date());
    const confMonth = conf.filter(p => p.dateObj && D.monthKey(p.dateObj) === mk);
    const list = [...S.payments].sort((a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0) || b._row - a._row);
    return tip + `<div class="grid g-4">
      ${kpi({ icon: 'badge-check', cls: 'i2', label: `اتأكد في ${I.monthName(new Date())}`, value: I.fmt(sum(confMonth, p => p.amountEGP)), unit: 'ج.م', foot: `${confMonth.length} تحويل` })}
      ${kpi({ icon: 'hourglass', cls: 'i3', label: 'مستني تأكيدك', value: pend.length, foot: pend.length ? `بقيمة ${I.money(sum(pend, p => p.amountEGP))}` : 'كله متأكد' })}
      ${kpi({ icon: 'wallet', cls: 'i1', label: 'إجمالي المؤكد', value: I.fmt(sum(conf, p => p.amountEGP)), unit: 'ج.م', foot: `${conf.length} تحويل` })}
      ${kpi({ icon: 'circle-x', cls: 'i4', label: 'مش واصلة', value: S.payments.filter(p => p.statusKey === 'rejected').length, foot: 'تحويلات اتقال إنها وصلت ومالقتهاش' })}
    </div>
    ${pend.length ? `<h2 class="section-title">${ic('hourglass')} مستني تأكيدك</h2>
    <div class="project-grid">${pend.map(p => `<div class="card pay-card">
      ${p.receipt ? `<div class="pay-img" data-rcpt-view="${esc(p.receipt)}"><img data-rcpt="${esc(p.receipt)}" alt="صورة التحويل"></div>` : `<div class="pay-img">${ic('image-off')}</div>`}
      <div><div class="li-title">${esc(p.client || 'عميل')} — ${esc(p.amount)} ${esc(p.currency || '')}</div><div class="li-sub">${esc(p.method || '')} · ${fmtDate(p.dateObj) || esc(p.date)}${p.project ? ' · ' + esc(I.short(p.project, 35)) : ''}</div></div>
      <div class="row"><button class="btn primary sm" data-pok="${p.id}" title="${linkedProject(p) ? 'وهيتسجل المبلغ في حساب المشروع' : ''}">${ic('badge-check')} وصلت</button><button class="btn sm" data-pno="${p.id}">${ic('circle-x')} مش واصلة</button><button class="btn ghost sm" data-edit="payments:${p.id}">التفاصيل</button></div>
    </div>`).join('')}</div>` : ''}
    <h2 class="section-title">${ic('list')} كل التحويلات</h2>
    <div class="card"><div class="list">${list.map(paymentRow).join('')}</div></div>`;
  },
  after(r) {
    loadThumbs();
    $$('[data-pok]').forEach(b => b.onclick = async () => { b.disabled = true; const p = S.payments.find(x => x.id === b.dataset.pok); if (!(await confirmPayment(p, true))) b.disabled = false; });
    $$('[data-pno]').forEach(b => b.onclick = async () => { const p = S.payments.find(x => x.id === b.dataset.pno); if (confirm(`تأكيد إن تحويل ${p.client} (${p.amount}) مش واصل؟`)) save('payments', 'update', p._row, { status: D.PAY_STATUS.rejected }, checkFor('payments', p)); });
    if (r.params.get('shared')) handleSharedReceipt();
  },
};

/* ═════════════ حملاتي الإعلانية ═════════════ */

const campBadge = c => { const s = I.CAMPAIGN_STATE[c.state]; return `<span class="badge tone-${s.tone}">${ic(s.icon)}${s.label}</span>`; };
const roiBadge = c => c.roi == null || (!c.revenueEGP && c.state === 'scheduled') ? '' : `<span class="badge tone-${c.roi >= 0 ? 'good' : 'critical'}">${ic(c.roi >= 0 ? 'trending-up' : 'trending-down')}العائد ${I.pct(c.roi)}</span>`;
const campRange = c => `${fmtDate(c.startDate)} ← ${fmtDate(c.endDate)}`;

function campaignCard(c) {
  return `<div class="card pcard" data-edit="campaigns:${c.rowId}">
    <div class="top"><div class="avatar" style="background:linear-gradient(135deg,#ec4899,#8b5cf6)">${ic('megaphone')}</div>
      <div class="li-body"><div class="li-title">${esc(c.name)}</div><div class="li-sub">${esc(c.platform || '')} · ${campRange(c)}</div></div>${campBadge(c)}</div>
    <div class="row" style="gap:6px">${c.countriesList.map(x => `<span class="tag">${ic('map-pin')}${esc(x)}</span>`).join('') || '<span class="muted small">بدون دول محددة</span>'}</div>
    ${c.state === 'active' ? `<div><div class="progress"><span style="width:${c.elapsed / c.totalDays * 100}%"></span></div><div class="money-row" style="margin-top:6px"><span>اليوم ${c.elapsed} من ${c.totalDays}</span><span>فاضل ${c.daysLeft} يوم</span></div></div>` : ''}
    <div class="kv kv3"><div><small>صرفت${c.spentEstimated ? ' (الميزانية)' : ''}</small><b>${I.fmt(c.spentEGP)}</b></div><div><small>جابت</small><b>${I.fmt(c.revenueEGP)}</b></div><div><small>الربح</small><b style="color:${c.profitEGP >= 0 ? 'var(--good-text)' : 'var(--critical)'}">${I.fmt(c.profitEGP)}</b></div></div>
    <div class="row between">${roiBadge(c) || '<span></span>'}${c.state !== 'scheduled' ? `<button class="btn sm primary" data-cinc="${c.rowId}">${ic('plus')} ضيف إيراد</button>` : ''}</div>
  </div>`;
}

VIEWS.campaigns = {
  title: () => 'حملاتي الإعلانية',
  sub: () => 'كل حملة: صرفت فيها كام وجابتلك كام',
  render() {
    if (!S.campaigns.length) return emptyState('megaphone', 'مفيش حملات لسه', 'سجّل كل إعلان بتشغله: الدول، الميزانية، والمدة. وكل ما فلوس تيجي منه ضيفها، وهتعرف الإعلان كسبان ولا خسران وأنهي حملة أحسن.', `<button class="btn primary" data-act="new-campaign">${ic('plus')} ابدأ أول حملة</button>`);
    const cs = [...S.campaigns].sort((a, b) => b.startDate - a.startDate);
    const running = cs.filter(c => c.state === 'active' || c.state === 'scheduled');
    const spent = sum(cs, c => c.spentEGP), rev = sum(cs, c => c.revenueEGP);
    const byCountry = {};
    S.incomes.forEach(i => { const k = i.country || 'غير محدد'; byCountry[k] = (byCountry[k] || 0) + i.amountEGP; });
    const countries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]), maxC = Math.max(1, ...countries.map(c => c[1]));
    return `<div class="grid g-4">
      ${kpi({ icon: 'radio', cls: 'i2', label: 'حملات شغالة', value: cs.filter(c => c.state === 'active').length, foot: `${cs.length} حملة إجمالاً` })}
      ${kpi({ icon: 'flame', cls: 'i3', label: 'صرفت على الإعلانات', value: I.fmt(spent), unit: 'ج.م' })}
      ${kpi({ icon: 'banknote', cls: 'i1', label: 'جالك من الإعلانات', value: I.fmt(rev), unit: 'ج.م', foot: `ربح ${I.money(rev - spent)}` })}
      ${kpi({ icon: 'gauge', cls: 'i4', label: 'كل 1 جنيه إعلان رجّع', value: spent ? (rev / spent).toFixed(1) : '—', unit: 'جنيه', foot: spent ? `العائد ${I.pct((rev - spent) / spent * 100)}` : '' })}
    </div>
    ${running.length ? `<h2 class="section-title">${ic('radio')} الحملات الشغالة</h2><div class="project-grid">${running.map(campaignCard).join('')}</div>` : ''}
    <div class="grid g-main" style="margin-top:16px">
      <div class="card"><div class="card-head"><h3>${ic('chart-column')} الصرف مقابل العائد لكل حملة</h3>${legend([['العائد', '--s1'], ['الصرف', '--s2']])}</div><div class="chart-box"><canvas id="cChart" aria-label="الصرف مقابل العائد لكل حملة"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>${ic('globe-2')} الفلوس جت منين</h3><span class="sub">حسب الدولة</span></div>
        ${countries.map(([c, v]) => `<div class="hbar"><span>${esc(c)}</span><div class="track"><span style="width:${v / maxC * 100}%;background:var(--s1)"></span></div><b class="num small">${I.fmt(v)}</b></div>`).join('') || '<p class="muted">لما تضيف إيرادات هيظهر هنا أكتر دولة بتجيبلك فلوس.</p>'}
      </div>
    </div>
    <h2 class="section-title">${ic('history')} كل الحملات</h2>
    <div class="card"><div class="table-wrap"><table class="data"><thead><tr><th>الحملة</th><th>المدة</th><th>الدول</th><th>الصرف</th><th>العائد</th><th>الربح</th><th>العائد %</th></tr></thead><tbody>
      ${cs.map(c => `<tr data-edit="campaigns:${c.rowId}" style="cursor:pointer"><td>${esc(c.name)} ${c.state === 'active' ? campBadge(c) : ''}</td><td>${campRange(c)}</td><td>${esc(c.countriesList.join('، '))}</td><td class="n">${I.fmt(c.spentEGP)}${c.spentEstimated ? '*' : ''}</td><td class="n">${I.fmt(c.revenueEGP)}</td><td class="n" style="color:${c.profitEGP >= 0 ? 'var(--good-text)' : 'var(--critical)'}">${I.fmt(c.profitEGP)}</td><td class="n">${roiBadge(c) || '—'}</td></tr>`).join('')}
    </tbody></table></div><p class="muted small" style="margin-bottom:0">* محسوب على الميزانية كاملة لحد ما تسجّل المصروف الفعلي من مدير الإعلانات. كل المبالغ بالجنيه.</p></div>`;
  },
  after() {
    if (!S.campaigns.length) return;
    const cs = [...S.campaigns].filter(c => c.state !== 'scheduled').sort((a, b) => a.startDate - b.startDate).slice(-10), c = colors();
    mkChart('cChart', { type: 'bar', data: { labels: cs.map(x => I.short(x.name, 16)), datasets: [
      { label: 'العائد', data: cs.map(x => Math.round(x.revenueEGP)), backgroundColor: c.s1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26 },
      { label: 'الصرف', data: cs.map(x => Math.round(x.spentEGP)), backgroundColor: c.s2, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26 },
    ] }, options: baseOpts() });
  },
};

function openCampaign(key) {
  const c = S.campaigns.find(x => x.rowId === key || x.id === key);
  if (!c) return;
  const prev = S.campaigns.filter(x => x.startDate < c.startDate && x.spentEGP && x.state !== 'scheduled').sort((a, b) => b.startDate - a.startDate)[0];
  const cur = c.currency || 'جنيه';
  const good = c.revenueEGP && c.roas >= 1;
  const verdict = !c.revenueEGP
    ? { tone: c.state === 'scheduled' ? 'info' : 'warning', icon: 'hourglass', title: c.state === 'scheduled' ? 'الحملة لسه ما بدأتش' : 'لسه مفيش إيراد متسجل من الحملة دي', text: 'كل ما عميل يجيلك منها ويدفع، دوس "ضيف إيراد" وسجّل المبلغ.' }
    : good
      ? { tone: 'good', icon: 'trophy', title: `الحملة كسبانة: كل 1 جنيه صرفته رجّعلك ${c.roas.toFixed(1)} جنيه`, text: `صافي ربح ${I.money(c.profitEGP)} من ${c.clients || 'عدة'} ${c.clients === 1 ? 'عميل' : 'عملاء'}.` }
      : { tone: 'warning', icon: 'trending-down', title: `الحملة لحد دلوقتي خسرانة ${I.money(-c.profitEGP)}`, text: c.state === 'active' ? 'لسه فيه وقت: جرّب تغيّر الإعلان أو الاستهداف، أو ركّز الميزانية على الدولة اللي جابت أكتر.' : 'قارنها بأحسن حملة عندك (الدول والإعلان والمنصة) قبل الحملة الجاية.' };
  const countries = Object.entries(c.byCountry).sort((a, b) => b[1] - a[1]), maxC = Math.max(1, ...countries.map(x => x[1]));
  openSheet({
    title: `${ic('megaphone')} ${esc(c.name)}`,
    body: `
      <div class="row" style="margin-bottom:10px">${campBadge(c)}<span class="tag">${ic('monitor-smartphone')}${esc(c.platform || '—')}</span>${c.countriesList.map(x => `<span class="tag">${ic('map-pin')}${esc(x)}</span>`).join('')}</div>
      <p class="muted small" style="margin:0">${campRange(c)} · ${c.totalDays} يوم${c.state === 'active' ? ` · اليوم ${c.elapsed} · فاضل ${c.daysLeft} يوم` : ''}</p>
      ${c.state === 'active' ? `<div class="progress" style="margin-top:10px"><span style="width:${c.elapsed / c.totalDays * 100}%"></span></div>` : ''}
      <div class="result-grid">
        ${result('الميزانية', `${I.fmt(c.budgetN)} ${cur}`)}
        ${result(`صرفت${c.spentEstimated ? ' (الميزانية)' : ''}`, `${I.fmt(c.spentN)} ${cur}`)}
        ${result('جابتلك', I.money(c.revenueEGP), true)}
        ${result('صافي الربح', I.money(c.profitEGP))}
        ${result('العائد ROI', c.roi == null ? '—' : I.pct(c.roi))}
        ${result('كل 1 جنيه رجّع', c.roas == null ? '—' : c.roas.toFixed(2))}
        ${result('عملاء منها', c.clients)}
        ${result('تكلفة العميل', c.cpa == null ? '—' : I.money(c.cpa))}
      </div>
      <div class="card insight t-${verdict.tone}" style="margin-top:14px;box-shadow:none"><div class="ins-icon tone-${verdict.tone}">${ic(verdict.icon)}</div><div><h4>${esc(verdict.title)}</h4><p>${esc(verdict.text)}</p>
        ${prev && c.roas != null && prev.roas != null ? `<p class="small" style="margin-top:6px">مقارنة بالحملة اللي قبلها "${esc(prev.name)}": ${prev.roas.toFixed(1)}x ← ${c.roas.toFixed(1)}x <b style="color:${c.roas >= prev.roas ? 'var(--good-text)' : 'var(--critical)'}">(${c.roas >= prev.roas ? 'أحسن' : 'أضعف'})</b></p>` : ''}</div></div>
      ${c.spentEstimated ? `<p class="small muted">${ic('info')} الصرف محسوب على الميزانية كاملة. لما الحملة تخلص دوس "سجّل المصروف الفعلي" واكتب الرقم من مدير الإعلانات.</p>` : ''}
      ${countries.length ? `<h4 style="margin:18px 0 8px">${ic('globe-2')} الإيراد حسب الدولة</h4>${countries.map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><div class="track"><span style="width:${v / maxC * 100}%;background:var(--s1)"></span></div><b class="num small">${I.fmt(v)}</b></div>`).join('')}` : ''}
      <h4 style="margin:18px 0 8px">${ic('banknote')} الفلوس اللي جت من الحملة (${c.incomes.length})</h4>
      ${c.incomes.length ? `<div class="list">${c.incomes.map(i => `<div class="list-item" data-edit="incomes:${i.id}"><div class="avatar" style="background:linear-gradient(135deg,#10b981,#0fb5d4)">${ic('banknote')}</div><div class="li-body"><div class="li-title">${esc(i.client || 'عميل')}</div><div class="li-sub">${fmtDate(i.dateObj) || esc(i.date)}${i.country ? ' · ' + esc(i.country) : ''}${i.notes ? ' · ' + esc(i.notes) : ''}</div></div><div class="li-end"><b>${esc(i.amount)} ${esc(i.currency || '')}</b></div></div>`).join('')}</div>` : '<p class="muted small">لسه مفيش.</p>'}
      ${c.notes ? `<h4 style="margin:18px 0 8px">${ic('sticky-note')} ملاحظات</h4><p class="muted" style="white-space:pre-wrap">${esc(c.notes)}</p>` : ''}`,
    foot: `${c.state !== 'scheduled' ? `<button class="btn primary" id="cInc">${ic('plus')} ضيف إيراد</button>` : ''}
      <button class="btn" id="cSpent">${ic('flame')} سجّل المصروف الفعلي</button>
      ${c.state === 'active' ? `<button class="btn" id="cStop">${ic('circle-pause')} وقّف الحملة</button>` : c.state === 'stopped' ? `<button class="btn" id="cResume">${ic('circle-play')} رجّعها شغالة</button>` : ''}
      <button class="btn ghost" id="cEdit">${ic('pencil')} تعديل</button>`,
  });
  $('#cInc') && ($('#cInc').onclick = () => openIncomeForm(c.rowId));
  $('#cEdit').onclick = () => openCampaignForm(c);
  $('#cStop') && ($('#cStop').onclick = async () => { if (confirm('توقيف الحملة؟ هتفضل إيراداتها محفوظة.') && await save('campaigns', 'update', c._row, { status: 'موقوفة' }, checkFor('campaigns', c))) openCampaign(c.rowId); });
  $('#cResume') && ($('#cResume').onclick = async () => { if (await save('campaigns', 'update', c._row, { status: '' }, checkFor('campaigns', c))) openCampaign(c.rowId); });
  $('#cSpent').onclick = () => {
    openSheet({
      title: `${ic('flame')} المصروف الفعلي — ${esc(c.name)}`,
      body: `<div class="form"><div class="field full"><label>${ic('coins')} صرفت كام لحد دلوقتي؟ (${esc(cur)})</label><input id="spIn" inputmode="decimal" value="${esc(c.spent || Math.round(c.spentN))}"><div class="hint">الرقم ده موجود في مدير الإعلانات (Ads Manager) — خانة "المبلغ الذي تم إنفاقه".</div></div></div>`,
      foot: `<button class="btn primary" id="spSave">${ic('check')} حفظ</button><button class="btn ghost" id="spBack">رجوع</button>`,
    });
    $('#spBack').onclick = () => openCampaign(c.rowId);
    $('#spSave').onclick = async () => { const v = D.toLatin($('#spIn').value).replace(/[^\d.]/g, ''); if (await save('campaigns', 'update', c._row, { spent: v }, checkFor('campaigns', c))) openCampaign(c.rowId); };
  };
}

function openCampaignForm(item = null) {
  const today = new Date(), start = item?.startDate || today;
  const end = item?.endDate || new Date(today.getFullYear(), today.getMonth(), today.getDate() + 13);
  let picked = new Set(item?.countriesList || ['مصر', 'السعودية']);
  openSheet({
    title: `${ic('megaphone')} ${item ? 'تعديل الحملة' : 'حملة إعلانية جديدة'}`,
    body: `<form class="form" id="cForm" onsubmit="return false">
      <div class="field full"><label>${ic('megaphone')} اسم الحملة *</label><input name="name" placeholder="مثلاً: حملة النشر على أمازون — أكتوبر" value="${esc(item?.name || '')}"></div>
      <div class="field"><label>${ic('monitor-smartphone')} المنصة</label><select name="platform">${D.PLATFORMS.map(p => `<option ${(item?.platform || D.PLATFORMS[0]) === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="field"><label>${ic('wallet')} الميزانية</label><div class="row" style="flex-wrap:nowrap"><input name="budget" inputmode="decimal" value="${esc(item?.budget || '')}" style="flex:1"><select name="currency" style="width:auto">${D.MONEY_UNITS.map(u => `<option ${(item?.currency || 'جنيه') === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
      <div class="field full"><label>${ic('globe-2')} الدول المستهدفة</label><div class="chips" id="cCountries" style="flex-wrap:wrap">${D.COUNTRIES.map(x => `<button type="button" class="chip ${picked.has(x) ? 'on' : ''}" data-country="${x}">${x}</button>`).join('')}</div></div>
      <div class="field"><label>${ic('calendar')} تاريخ البداية</label><input type="date" name="start" value="${D.isoDay(start)}"></div>
      <div class="field"><label>${ic('calendar-check')} تاريخ النهاية</label><input type="date" name="end" value="${D.isoDay(end)}"></div>
      <div class="field full"><div class="chips">${[[7, 'أسبوع'], [14, 'أسبوعين'], [30, 'شهر'], [60, 'شهرين']].map(([n, l]) => `<button type="button" class="chip" data-dur="${n}">${ic('timer')}${l}</button>`).join('')}</div></div>
      <div class="field"><label>${ic('flame')} المصروف الفعلي (اختياري)</label><input name="spent" inputmode="decimal" value="${esc(item?.spent || '')}" placeholder="سيبه فاضي ويتحسب على الميزانية"></div>
      <div class="field full"><label>${ic('sticky-note')} ملاحظات (الإعلان، الجمهور، الهدف)</label><textarea name="notes" style="min-height:60px">${esc(item?.notes || '')}</textarea></div>
    </form>`,
    foot: `<button class="btn primary" id="cSave">${ic('check')} ${item ? 'حفظ' : 'شغّل الحملة'}</button><button class="btn ghost" id="cCancel">إلغاء</button>${item ? `<button class="btn danger" id="cDel" style="margin-inline-start:auto">${ic('trash-2')} حذف</button>` : ''}`,
  });
  const form = $('#cForm'), f = n => form.querySelector(`[name="${n}"]`);
  $$('[data-country]', form).forEach(b => b.onclick = () => { b.classList.toggle('on'); picked.has(b.dataset.country) ? picked.delete(b.dataset.country) : picked.add(b.dataset.country); });
  $$('[data-dur]', form).forEach(b => b.onclick = () => { const s = new Date((f('start').value || D.isoDay(new Date())) + 'T00:00'); s.setDate(s.getDate() + Number(b.dataset.dur) - 1); f('end').value = D.isoDay(s); });
  $('#cCancel').onclick = () => item ? openCampaign(item.rowId) : closeSheet();
  $('#cDel') && ($('#cDel').onclick = () => confirmDelete('campaigns', item));
  $('#cSave').onclick = async () => {
    const name = f('name').value.trim();
    if (!name) return toast('اكتب اسم الحملة', 'err');
    if (!picked.size) return toast('اختار دولة واحدة على الأقل', 'err');
    if (f('end').value < f('start').value) return toast('تاريخ النهاية قبل البداية', 'err');
    const day = v => D.sheetDay(new Date(v + 'T00:00'));
    const values = {
      name, platform: f('platform').value, countries: [...picked].join('، '), start: day(f('start').value), end: day(f('end').value),
      budget: D.toLatin(f('budget').value).replace(/[^\d.]/g, ''), currency: f('currency').value, spent: D.toLatin(f('spent').value).replace(/[^\d.]/g, ''), notes: f('notes').value.trim(),
    };
    $('#cSave').disabled = true;
    const ok = item
      ? await save('campaigns', 'update', item._row, values, checkFor('campaigns', item))
      : await save('campaigns', 'add', null, { id: 'C' + Date.now().toString(36).toUpperCase(), date: D.sheetDay(new Date()), status: '', ...values });
    if (!ok) { $('#cSave').disabled = false; return; }
    if (item) {
      // لو اسم الحملة اتغير نحدّث اسمها في الإيرادات كمان
      if (item.name !== name) for (const i of item.incomes) await save('campaignIncome', 'update', i._row, { campaign: name }, checkFor('campaignIncome', i));
      const np = S.campaigns.find(x => x._row === item._row); np ? openCampaign(np.rowId) : closeSheet();
    } else { closeSheet(); confetti(); }
  };
}

function openIncomeForm(campKey, item = null) {
  const c = S.campaigns.find(x => x.rowId === campKey || x.id === (item?.campaignId || campKey)) || S.campaigns.find(x => x.name === item?.campaign);
  const projs = [...S.projects].sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  const countryList = [...new Set([...(c?.countriesList || []), ...D.COUNTRIES])];
  openSheet({
    title: `${ic('banknote')} ${item ? 'تعديل إيراد' : 'فلوس جت من الحملة'}`,
    body: `<form class="form" id="iForm" onsubmit="return false">
      <div class="field full"><label>${ic('megaphone')} الحملة</label><select name="camp">${S.campaigns.map(x => `<option value="${x.rowId}" ${x === c ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field full"><label>${ic('folder-kanban')} العميل من الشيت (اختياري)</label><select name="proj"><option value="">— اختار عميل أو اكتب الاسم تحت —</option>${projs.map(p => `<option value="${p._row}">${esc(p.displayName)} — ${esc(I.short(p.project, 35))} (${I.fmt(p.totalEGP / p.rate)} ${unitOf(p)})</option>`).join('')}</select></div>
      <div class="field full"><label>${ic('user')} اسم العميل</label><input name="client" value="${esc(item?.client || '')}"></div>
      <div class="field"><label>${ic('coins')} المبلغ</label><input name="amount" inputmode="decimal" value="${esc(item?.amount || '')}"></div>
      <div class="field"><label>${ic('banknote')} العملة</label><select name="currency">${D.MONEY_UNITS.map(u => `<option ${(item?.currency || 'جنيه') === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="field"><label>${ic('map-pin')} الدولة</label><select name="country"><option value="">—</option>${countryList.map(x => `<option ${(item?.country || c?.countriesList[0] || '') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label>${ic('calendar')} التاريخ</label><input type="date" name="date" value="${D.isoDay(item?.dateObj || new Date())}"></div>
      <div class="field full"><label>${ic('sticky-note')} ملاحظات</label><input name="notes" value="${esc(item?.notes || '')}" placeholder="مثلاً: مقدم / الباقي / مشروع ترجمة"></div>
    </form>`,
    foot: `<button class="btn primary" id="iSave">${ic('check')} حفظ</button><button class="btn ghost" id="iCancel">رجوع</button>${item ? `<button class="btn danger" id="iDel" style="margin-inline-start:auto">${ic('trash-2')} حذف</button>` : ''}`,
  });
  const form = $('#iForm'), f = n => form.querySelector(`[name="${n}"]`);
  f('proj').onchange = () => {
    const p = S.projects.find(x => x._row === Number(f('proj').value)); if (!p) return;
    f('client').value = p.displayName; f('currency').value = unitOf(p);
    f('amount').value = Math.round((p.paidEGP || p.totalEGP) / p.rate) || '';
    const ctry = countryOf(p.nationality); if (ctry) f('country').value = ctry;
  };
  const back = () => { const cc = S.campaigns.find(x => x.rowId === f('camp').value); cc ? openCampaign(cc.rowId) : closeSheet(); };
  $('#iCancel').onclick = back;
  $('#iDel') && ($('#iDel').onclick = async () => { if (confirm('تمسح الإيراد ده؟') && await save('campaignIncome', 'delete', item._row, {}, checkFor('campaignIncome', item))) back(); });
  $('#iSave').onclick = async () => {
    const cc = S.campaigns.find(x => x.rowId === f('camp').value);
    const amount = D.toLatin(f('amount').value).replace(/[^\d.]/g, '');
    if (!cc) return toast('اختار الحملة', 'err');
    if (!Number(amount)) return toast('اكتب المبلغ', 'err');
    const values = { date: D.sheetDay(new Date(f('date').value + 'T00:00')), campaignId: cc.id, campaign: cc.name, client: f('client').value.trim(), country: f('country').value, amount, currency: f('currency').value, notes: f('notes').value.trim() };
    $('#iSave').disabled = true;
    const ok = item ? await save('campaignIncome', 'update', item._row, values, checkFor('campaignIncome', item)) : await save('campaignIncome', 'add', null, values);
    if (ok) { const nc = S.campaigns.find(x => x.id === cc.id); nc ? openCampaign(nc.rowId) : closeSheet(); if (!item) confetti(); } else $('#iSave').disabled = false;
  };
}

/* ── الأدوات ── */
const TRIMS = [['5 × 8', 5, 8], ['5.25 × 8', 5.25, 8], ['5.5 × 8.5', 5.5, 8.5], ['6 × 9', 6, 9], ['6.14 × 9.21', 6.14, 9.21], ['7 × 10', 7, 10], ['8.5 × 11', 8.5, 11]];
const PAPERS = [['أبيض — أبيض وأسود', 0.002252], ['كريمي — أبيض وأسود', 0.0025], ['ألوان Standard', 0.002252], ['ألوان Premium', 0.002347]];
const num = (id, d = 0) => { const v = Number(D.toLatin($('#' + id)?.value).replace(/[^\d.]/g, '')); return isFinite(v) && v !== 0 ? v : d; };
const inp = (id, label, val, icon, extra = '') => `<div class="field"><label for="${id}">${ic(icon)} ${label}</label><input id="${id}" inputmode="decimal" value="${val}" ${extra}></div>`;
const result = (label, value, hl = false) => `<div class="result ${hl ? 'hl' : ''}"><small>${label}</small><b>${value}</b></div>`;

// [المفتاح، الاسم، الأيقونة، وحدة العدد لو الخدمة ليها عدد]
const QUOTE_ITEMS = [
  ['format', 'تنسيق وتجهيز الكتاب', 'align-justify'], ['proofread', 'تدقيق لغوي وإملائي', 'spell-check'], ['translate', 'ترجمة', 'languages'],
  ['cover', 'تصميم غلاف', 'book-image'], ['cover2', 'غلاف اللغة الثانية (عند الترجمة)', 'book-copy'],
  ['account', 'إنشاء حساب KDP (أول مرة)', 'user-plus'], ['ebook', 'نشر النسخة الإلكترونية', 'tablet-smartphone', 'كتاب'], ['paper', 'نشر النسخة الورقية (إنجليزي فقط)', 'book', 'كتاب'],
  ['bulk', 'رفع ونشر كتب جاهزة (دور نشر)', 'library', 'كتاب'],
  ['poster', 'بوستر / موك أب دعائي', 'image', 'تصميم'], ['reel', 'فيديو Reels دعائي', 'clapperboard', 'دقيقة'], ['marketing', 'خطة تسويق متكاملة (فيسبوك وإنستجرام)', 'megaphone', 'شهر'],
];
const PKG_ITEMS = ['format', 'account', 'ebook']; // الحاجات اللي الباقة بتغطيها
const mktSeg = id => `<div class="seg" id="${id}">${[['EG', 'مصر (جنيه)'], ['SA', 'السعودية (ريال)']].map(([v, l]) => `<button class="${S.quoteMkt === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;

VIEWS.tools = {
  title: () => 'الأدوات والحاسبات',
  sub: () => 'حاسبات ورسائل جاهزة بتوفر وقتك في شغل KDP',
  render() {
    const t = S.toolTab;
    const tabs = `<div class="seg" id="ttabs" style="margin-bottom:16px;flex-wrap:wrap">${[['quote', 'عرض سعر للعميل'], ['msgs', 'رسائل جاهزة'], ['royalty', 'أرباح KDP'], ['cover', 'مقاس الغلاف والكعب'], ['ads', 'حاسبة الإعلانات']].map(([v, l]) => `<button class="${t === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    if (t === 'msgs') {
      const list = templates(S.settings.prices[S.quoteMkt], S.quoteMkt);
      return tabs + `<div class="row between" style="margin-bottom:14px">${mktSeg('mMkt')}<span class="muted small">${ic('info')} الأسعار في الرسايل بتتاخد من الإعدادات، فلو غيرت سعر هيتغير هنا لوحده.</span></div>
      <div class="grid g-2">${list.map(x => `<div class="card"><div class="card-head"><h3>${ic(x.icon)} ${esc(x.title)}</h3></div>
        <pre class="msg" style="max-height:230px;overflow:auto;margin-top:0">${esc(x.text)}</pre>
        <div class="row" style="margin-top:12px"><button class="btn sm" data-tcopy="${x.id}">${ic('copy')} نسخ</button><a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(x.text)}">${ic('send')} ابعت واتساب</a></div></div>`).join('')}</div>`;
    }
    if (t === 'quote') return tabs + `<div class="grid g-main" id="tool">
      <div class="card"><div class="card-head"><h3>${ic('file-badge')} اختار الخدمات</h3><a class="sub" href="#/settings">عدّل الأسعار</a></div>
        ${mktSeg('qMkt')}
        <div class="form" style="margin-top:14px">
          ${inp('qPages', 'عدد الصفحات', 150, 'file-text')}
          <div class="field"><label>${ic('image')} محتوى الكتاب</label><select id="qType"><option value="text">نص فقط</option><option value="media">فيه صور أو جداول</option></select></div>
          <div class="field"><label>${ic('package')} باقة جاهزة</label><select id="qPkg"><option value="">بدون باقة</option><option value="launch">باقة الانطلاقة (عميل جديد)</option><option value="continue">باقة الاستمرارية (عنده حساب)</option></select></div>
          <div class="field"><label>${ic('languages')} لغة الترجمة</label><select id="qLang"><option value="en">عربي - إنجليزي</option><option value="de">عربي - ألماني</option></select></div>
        </div>
        <p class="small" id="qPkgNote" style="margin:10px 0 0"></p>
        <div class="stack" style="gap:8px;margin-top:14px">${QUOTE_ITEMS.map(([k, l, i, unit]) => `<label class="check"><input type="checkbox" data-q="${k}" ${['format', 'account', 'ebook'].includes(k) ? 'checked' : ''}>${ic(i)}<span style="flex:1">${l}</span>${unit ? `<input data-qn="${k}" value="1" inputmode="numeric" style="width:54px;padding:4px 8px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-solid)" aria-label="العدد"><span class="muted small">${unit}</span>` : ''}</label>`).join('')}</div>
        <div class="form" style="margin-top:14px">
          ${inp('qDisc', 'خصم %', 0, 'badge-percent')}
          ${inp('qDays', 'مدة التنفيذ (أيام عمل)', '', 'calendar-clock')}
          <label class="check full"><input type="checkbox" id="qNotes" checked>${ic('file-text')} ضيف الملاحظات وطريقة الدفع في آخر الرسالة</label>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>${ic('receipt-text')} العرض</h3></div><div id="qOut"></div></div>
    </div>`;
    if (t === 'royalty') return tabs + `<div class="grid g-main" id="tool">
      <div class="card"><div class="card-head"><h3>${ic('book-open')} بيانات الكتاب</h3></div>
        <div class="seg" id="rFmt" style="margin-bottom:14px"><button class="on" data-v="ebook">Kindle eBook</button><button data-v="paper">Paperback</button></div>
        <div class="form">${inp('rPrice', 'سعر البيع $', 9.99, 'dollar-sign')}${inp('rPages', 'عدد الصفحات', 200, 'file-text')}${inp('rMB', 'حجم الملف MB (للإلكتروني)', 2, 'hard-drive')}${inp('rSales', 'مبيعات متوقعة في الشهر', 30, 'shopping-cart')}</div>
        <p class="muted small" style="margin-top:12px">${ic('info')} الحساب تقريبي على Amazon.com (طباعة أبيض وأسود). راجع حاسبة KDP الرسمية قبل ما تأكد للعميل.</p>
      </div>
      <div class="card"><div class="card-head"><h3>${ic('coins')} أرباح المؤلف</h3></div><div id="rOut"></div></div>
    </div>`;
    if (t === 'cover') return tabs + `<div class="grid g-main" id="tool">
      <div class="card"><div class="card-head"><h3>${ic('ruler')} مقاس الكتاب (Paperback)</h3></div>
        <div class="form">
          <div class="field"><label>${ic('scan')} مقاس القطع (بوصة)</label><select id="cTrim">${TRIMS.map((x, i) => `<option value="${i}" ${i === 3 ? 'selected' : ''}>${x[0]}</option>`).join('')}</select></div>
          <div class="field"><label>${ic('layers')} نوع الورق</label><select id="cPaper">${PAPERS.map((x, i) => `<option value="${i}">${x[0]}</option>`).join('')}</select></div>
          ${inp('cPages', 'عدد الصفحات', 200, 'file-text')}
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>${ic('book-image')} مقاس ملف الغلاف</h3></div><div id="cOut"></div></div>
    </div>`;
    return tabs + `<div class="grid g-main" id="tool">
      <div class="card"><div class="card-head"><h3>${ic('target')} أرقام الحملة</h3></div>
        <div class="form">${inp('aPrice', 'سعر الكتاب $', 9.99, 'tag')}${inp('aRoy', 'ربح المؤلف لكل نسخة $', 3.5, 'coins')}${inp('aSpend', 'الإنفاق $', 50, 'dollar-sign')}${inp('aSales', 'المبيعات $', 120, 'trending-up')}${inp('aClicks', 'النقرات', 200, 'mouse-pointer-click')}${inp('aOrders', 'الطلبات', 12, 'shopping-cart')}${inp('aImp', 'مرات الظهور', 40000, 'eye')}</div>
      </div>
      <div class="card"><div class="card-head"><h3>${ic('gauge')} التحليل</h3></div><div id="adOut"></div></div>
    </div>`;
  },
  after() {
    $$('#ttabs button').forEach(b => b.onclick = () => { S.toolTab = b.dataset.v; renderView(true); });
    $$('#qMkt button, #mMkt button').forEach(b => b.onclick = () => { S.quoteMkt = b.dataset.v; renderView(true); });
    if (S.toolTab === 'msgs') {
      const list = templates(S.settings.prices[S.quoteMkt], S.quoteMkt);
      $$('[data-tcopy]').forEach(b => b.onclick = () => navigator.clipboard.writeText(list.find(x => x.id === b.dataset.tcopy).text).then(() => toast('اتنسخت الرسالة', 'ok')));
      return;
    }
    const tool = $('#tool');
    if (S.toolTab === 'quote') { S.qDaysTouched = false; $('#qDays').addEventListener('input', () => { S.qDaysTouched = true; }); }
    const run = { quote: calcQuote, royalty: calcRoyalty, cover: calcCover, ads: calcAds }[S.toolTab];
    tool.addEventListener('input', run); tool.addEventListener('change', run);
    $$('#rFmt button').forEach(b => b.onclick = () => { $$('#rFmt button').forEach(x => x.classList.toggle('on', x === b)); calcRoyalty(); });
    run();
  },
};

// "150 صفحة" / "3 كتب" / "1 شهر"
const cnt = (n, one, few) => `${n} ${n >= 2 && n <= 10 ? few : one}`;

function calcQuote() {
  const mkt = S.quoteMkt, P = S.settings.prices[mkt], cur = D.CURRENCY[mkt];
  const pages = num('qPages', 0), type = $('#qType').value, lang = $('#qLang').value, pkg = $('#qPkg').value;
  const perPage = type === 'media' ? P.formatMedia : P.formatText;

  // الباقة بتغطي التنسيق والحساب والنشر الإلكتروني، فبنقفل الاختيارات دي
  QUOTE_ITEMS.forEach(([k]) => {
    const box = $(`[data-q="${k}"]`), locked = !!pkg && (PKG_ITEMS.includes(k) || (pkg === 'continue' && k === 'account'));
    box.disabled = locked; box.closest('label').style.opacity = locked ? .45 : 1;
  });
  const on = k => { const b = $(`[data-q="${k}"]`); return b.checked && !b.disabled; };
  const n = k => Math.max(1, Math.round(Number(D.toLatin($(`[data-qn="${k}"]`)?.value)) || 1));

  const note = $('#qPkgNote');
  note.innerHTML = !pkg ? '' : type === 'media'
    ? `<span style="color:var(--warning-text)">${ic('triangle-alert')} الباقات للكتب النص فقط. للكتب اللي فيها صور أو جداول استخدم الخدمات المنفصلة.</span>`
    : `<span class="muted">${ic('info')} الباقة بتشمل التنسيق لحد ${P.pkgPages} صفحة${pkg === 'launch' ? ' + إنشاء حساب KDP' : ''} + نشر النسخة الإلكترونية ومتابعة القبول. أي صفحة زيادة بتتحسب ${P.formatText} ${cur}.</span>`;

  const lines = [], notes = [];
  const add = (label, amount, custom) => lines.push({ label, amount: custom ? 0 : amount, custom });
  if (pkg) {
    add(pkg === 'launch'
      ? `باقة الانطلاقة (تنسيق لحد ${P.pkgPages} صفحة + إنشاء حساب KDP + نشر النسخة الإلكترونية ومتابعة القبول)`
      : `باقة الاستمرارية (تنسيق لحد ${P.pkgPages} صفحة + نشر النسخة الإلكترونية ومتابعة القبول)`, pkg === 'launch' ? P.pkgLaunch : P.pkgContinue);
    const extra = Math.max(pages - P.pkgPages, 0);
    if (extra) add(`صفحات إضافية على الباقة (${cnt(extra, 'صفحة', 'صفحات')})`, extra * perPage);
  }
  if (on('format')) add(`تنسيق وتجهيز الكتاب (${cnt(pages, 'صفحة', 'صفحات')}${type === 'media' ? ' بصور أو جداول' : ''})`, pages * perPage);
  if (on('proofread')) add(`تدقيق لغوي وإملائي (${cnt(pages, 'صفحة', 'صفحات')})`, pages * P.proofread);
  if (on('translate')) { add(`ترجمة ${lang === 'de' ? 'عربي - ألماني' : 'عربي - إنجليزي'} (${cnt(pages, 'صفحة', 'صفحات')})`, pages * (lang === 'de' ? P.translateDe : P.translateEn)); notes.push('السعر النهائي للترجمة يُحسب بعد مراجعة الملف وتحديد عدد الصفحات الفعلي.'); }
  if (on('cover')) add('تصميم غلاف الكتاب', P.cover);
  if (on('cover2')) { add('غلاف اللغة الثانية', P.cover2); notes.push('سعر غلاف اللغة الثانية بيبدأ من السعر المذكور حسب التصميم المطلوب.'); }
  if (on('account')) add('إنشاء حساب Amazon KDP', P.account);
  if (on('account') || pkg === 'launch') notes.push('حساب KDP يُحتسب مرة واحدة فقط لكل مؤلف، وليس مع كل كتاب جديد.');
  if (on('ebook')) add(`نشر النسخة الإلكترونية ومتابعة القبول${n('ebook') > 1 ? ` (${cnt(n('ebook'), 'كتاب', 'كتب')})` : ''}`, P.ebook * n('ebook'));
  if (on('paper')) { add(`نشر النسخة الورقية ومتابعة القبول${n('paper') > 1 ? ` (${cnt(n('paper'), 'كتاب', 'كتب')})` : ''}`, P.paper * n('paper')); notes.push('النسخة الورقية متاحة للكتب الإنجليزية فقط، لأن أمازون لا تدعم طباعة الكتب العربية.'); }
  if (on('bulk')) {
    const b = n('bulk'), rate = b <= 3 ? P.bulk1 : b <= 9 ? P.bulk4 : P.bulk10;
    if (b >= 50) add(`رفع ونشر ${b} كتاب جاهز`, 0, 'عرض سعر مخصص بعد مراجعة عينة من الملفات');
    else add(`رفع ونشر ${cnt(b, 'كتاب', 'كتب')} جاهزة (${I.fmt(rate)} ${cur} للكتاب)`, rate * b);
    if (b >= 10) notes.push('الطلبات الكبيرة (10 كتب فأكثر) يُفضَّل تنفيذها بدفعة تجريبية أولى قبل الاتفاق النهائي على الكمية الكاملة.');
  }
  if (on('poster')) add(`بوستر / موك أب دعائي (${cnt(n('poster'), 'تصميم', 'تصميمات')})`, P.poster * n('poster'));
  if (on('reel')) { add(`فيديو Reels دعائي (${cnt(n('reel'), 'دقيقة', 'دقائق')})`, P.reelMin * n('reel')); notes.push('سعر فيديوهات Reels بيبدأ من السعر المذكور ويتحدد نهائيًا حسب المطلوب.'); }
  if (on('marketing')) add(`خطة تسويق متكاملة على فيسبوك وإنستجرام (${cnt(n('marketing'), 'شهر', 'شهور')})`, P.marketingMonth * n('marketing'));
  notes.push(P.payment);

  const disc = Math.min(num('qDisc', 0), 90), step = mkt === 'EG' ? 10 : 5;
  const subtotal = sum(lines, l => l.amount);
  const total = disc ? Math.round(subtotal * (1 - disc / 100) / step) * step : subtotal;
  const deposit = Math.ceil(total / 2);

  // لو الخدمات المنفصلة اللي اخترتها بتساوي باقة جاهزة بسعر أقل، نقولك
  let cheaper = '';
  if (!pkg && type === 'text' && on('format') && on('ebook') && n('ebook') === 1) {
    const extra = Math.max(pages - P.pkgPages, 0) * P.formatText;
    const [price, name] = on('account') ? [P.pkgLaunch, 'باقة الانطلاقة'] : [P.pkgContinue, 'باقة الاستمرارية'];
    const separate = pages * P.formatText + (on('account') ? P.account : 0) + P.ebook;
    if (price + extra < separate) cheaper = `${name} أوفر للعميل هنا: ${I.fmt(price + extra)} ${cur} بدل ${I.fmt(separate)} ${cur}. اختارها من "باقة جاهزة".`;
  }

  // مدة تقريبية بتتحسب لوحدها لحد ما تكتب رقم بإيدك
  if (!S.qDaysTouched) {
    const formatting = on('format') || !!pkg;
    const est = (formatting || on('ebook') || on('paper') || on('bulk') ? 3 : 0) + (formatting ? pages / 50 : 0) + (on('translate') ? pages / 20 : 0) + (on('proofread') ? pages / 100 : 0) + (on('cover') || on('cover2') ? 2 : 0) + (on('bulk') ? n('bulk') : 0) + (on('poster') || on('reel') ? 2 : 0);
    $('#qDays').value = est ? Math.ceil(est) : '';
  }
  const days = num('qDays', 0);

  const msg = [
    'أهلًا بحضرتك،',
    'تفاصيل عرض السعر الخاص بكتابك:',
    '',
    ...lines.map(l => `- ${l.label}: ${l.custom || `${I.fmt(l.amount)} ${cur}`}`),
    ...(disc ? [`- خصم خاص: ${disc}%`] : []),
    '',
    `الإجمالي: ${I.fmt(total)} ${cur}`,
    `المقدم المطلوب لتأكيد الحجز والبدء (50%): ${I.fmt(deposit)} ${cur}، والباقي عند التسليم.`,
    ...(days ? [`مدة التنفيذ المتوقعة: حوالي ${cnt(days, 'يوم', 'أيام')} عمل من استلام المقدم والملفات.`] : []),
    ...($('#qNotes').checked ? ['', 'ملاحظات:', ...notes.map(x => `- ${x}`)] : []),
  ].join('\n');

  $('#qOut').innerHTML = lines.length ? `
    <div class="result-grid" style="margin-top:0">${result('الإجمالي', `${I.fmt(total)} ${cur}`, true)}${result('المقدم 50%', `${I.fmt(deposit)} ${cur}`)}${result('مدة التنفيذ', days ? cnt(days, 'يوم', 'أيام') : '—')}</div>
    ${cheaper ? `<p class="small" style="color:var(--good-text);margin:12px 0 0">${ic('lightbulb')} ${cheaper}</p>` : ''}
    <pre class="msg" id="qMsg">${esc(msg)}</pre>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="qCopy">${ic('copy')} نسخ</button>
      <a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">${ic('send')} ابعت واتساب</a>
      <button class="btn primary" id="qSave">${ic('user-plus')} سجّله كعميل</button>
    </div>` : emptyState('mouse-pointer-click', 'اختار خدمة واحدة على الأقل', '');
  paint();
  $('#qCopy') && ($('#qCopy').onclick = () => navigator.clipboard.writeText(msg).then(() => toast('اتنسخ', 'ok')));
  $('#qSave') && ($('#qSave').onclick = () => openForm('clients', null, {
    date: D.sheetDay(new Date()), project: lines.map(l => l.label.replace(/\s*\(.*\)/, '')).join(' + '), pages: pages || '',
    books: on('ebook') || on('paper') ? String(Math.max(on('ebook') ? n('ebook') : 0, on('paper') ? n('paper') : 0)) : '',
    total: String(total) + (mkt === 'SA' ? ' ريال' : ''), deposit: '0', remaining: '', status: 'في انتظار العربون', nationality: mkt === 'SA' ? 'سعودي' : 'مصري',
  }));
}

function calcRoyalty() {
  const fmtSel = $('#rFmt .on').dataset.v, price = num('rPrice', 0), pages = num('rPages', 0), mb = num('rMB', 0), sales = num('rSales', 0);
  let roy, plan, extra = '';
  if (fmtSel === 'ebook') {
    if (price >= 2.99 && price <= 9.99) { roy = 0.7 * (price - 0.15 * mb); plan = '70%'; extra = result('رسوم التوصيل', '$' + (0.15 * mb).toFixed(2)); }
    else { roy = 0.35 * price; plan = '35%'; extra = result('ملحوظة', 'لـ70% خلّي السعر بين 2.99 و 9.99'); }
  } else {
    const print = pages <= 108 ? 2.30 : 1.00 + 0.012 * pages;
    const r = price >= 9.99 ? 0.6 : 0.5;
    roy = r * price - print; plan = Math.round(r * 100) + '%';
    extra = result('تكلفة الطباعة', '$' + print.toFixed(2)) + result('أقل سعر مسموح تقريباً', '$' + (print / r).toFixed(2));
  }
  const usd = S.settings.usdRate;
  $('#rOut').innerHTML = `<div class="result-grid" style="margin-top:0">
    ${result('ربح النسخة', '$' + Math.max(roy, 0).toFixed(2), true)}${result('بالجنيه', I.money(Math.max(roy, 0) * usd))}${result('نسبة الأرباح', plan)}
    ${result('ربح الشهر', '$' + Math.max(roy * sales, 0).toFixed(0))}${result('ربح السنة', '$' + Math.max(roy * sales * 12, 0).toFixed(0))}${extra}</div>
    ${roy <= 0 ? `<p style="color:var(--critical)">${ic('triangle-alert')} السعر أقل من تكلفة الطباعة — زوّد السعر.</p>` : ''}
    <p class="muted small">${ic('lightbulb')} نصيحة للعميل: Break-even ACoS لإعلانات الكتاب ده = ${price ? Math.round(Math.max(roy, 0) / price * 100) : 0}%</p>`;
  paint();
}

function calcCover() {
  const [, w, h] = TRIMS[+$('#cTrim').value], factor = PAPERS[+$('#cPaper').value][1], pages = num('cPages', 24);
  const spine = pages * factor, bleed = 0.125;
  const W = bleed * 2 + w * 2 + spine, H = h + bleed * 2;
  const mm = x => (x * 25.4).toFixed(1), px = x => Math.round(x * 300);
  const sc = 560 / W, sw = Math.max(spine * sc, 2);
  $('#cOut').innerHTML = `<div class="result-grid" style="margin-top:0">
    ${result('عرض الكعب', `${spine.toFixed(3)}″ · ${mm(spine)} مم`, true)}
    ${result('مقاس الغلاف الكامل', `${W.toFixed(3)}″ × ${H.toFixed(3)}″`)}
    ${result('بالمليمتر', `${mm(W)} × ${mm(H)}`)}
    ${result('بالبكسل (300 DPI)', `${px(W)} × ${px(H)}`)}
  </div>
  <p class="small" style="margin:12px 0 0;color:${pages >= 80 ? 'var(--good-text)' : 'var(--warning-text)'}">${ic(pages >= 80 ? 'check' : 'triangle-alert')} ${pages >= 80 ? 'ينفع تكتب اسم الكتاب على الكعب' : 'أقل من 80 صفحة — KDP مش بيسمح بكتابة على الكعب'}</p>
  <div class="cover-diagram"><svg viewBox="-10 -30 ${W * sc + 20} ${H * sc + 60}" role="img" aria-label="مخطط الغلاف">
    <rect x="0" y="0" width="${W * sc}" height="${H * sc}" rx="4" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5"/>
    <rect x="${bleed * sc}" y="${bleed * sc}" width="${(W - 2 * bleed) * sc}" height="${h * sc}" fill="none" stroke="var(--ink-muted)" stroke-dasharray="5 4"/>
    <rect x="${(bleed + w) * sc}" y="0" width="${sw}" height="${H * sc}" fill="var(--s2)" opacity=".85"/>
    <text x="${(bleed + w / 2) * sc}" y="${H * sc / 2}" text-anchor="middle" fill="var(--text-2)" font-size="15" font-family="Cairo">الغلاف الخلفي</text>
    <text x="${(bleed + w + spine + w / 2) * sc}" y="${H * sc / 2}" text-anchor="middle" fill="var(--text-2)" font-size="15" font-family="Cairo">الغلاف الأمامي</text>
    <text x="${(bleed + w) * sc + sw / 2}" y="-10" text-anchor="middle" fill="var(--text-2)" font-size="12">الكعب ${mm(spine)} مم</text>
    <text x="${W * sc / 2}" y="${H * sc + 22}" text-anchor="middle" fill="var(--ink-muted)" font-size="12">الخط المتقطع = حدود القص (Bleed 0.125″)</text>
  </svg></div>
  <p class="muted small">${ic('info')} الغلاف الأمامي على اليمين في ملف KDP لو الكتاب إنجليزي (يفتح من الشمال)، ولو الكتاب عربي يتعكس الترتيب.</p>`;
  paint();
}

function calcAds() {
  const price = num('aPrice', 0), roy = num('aRoy', 0), spend = num('aSpend', 0), sales = num('aSales', 0), clicks = num('aClicks', 0), orders = num('aOrders', 0), imp = num('aImp', 0);
  const acos = sales ? spend / sales * 100 : 0, be = price ? roy / price * 100 : 0, cvr = clicks ? orders / clicks : 0, cpc = clicks ? spend / clicks : 0;
  const profit = orders * roy - spend, maxCpc = roy * cvr;
  const good = acos && acos <= be;
  $('#adOut').innerHTML = `<div class="result-grid" style="margin-top:0">
    ${result('ACoS', acos ? acos.toFixed(1) + '%' : '—', true)}${result('Break-even ACoS', be.toFixed(1) + '%')}${result('ROAS', spend ? (sales / spend).toFixed(2) + 'x' : '—')}
    ${result('CPC', '$' + cpc.toFixed(2))}${result('CTR', imp ? (clicks / imp * 100).toFixed(2) + '%' : '—')}${result('معدل التحويل', (cvr * 100).toFixed(1) + '%')}
    ${result('صافي ربح الإعلان', (profit >= 0 ? '+' : '') + '$' + profit.toFixed(2))}${result('أقصى Bid للتعادل', '$' + maxCpc.toFixed(2))}</div>
    <div class="card insight t-${good ? 'good' : 'warning'}" style="margin-top:14px;box-shadow:none"><div class="ins-icon tone-${good ? 'good' : 'warning'}">${ic(good ? 'thumbs-up' : 'wrench')}</div><div>
    <h4>${good ? 'الحملة كسبانة 👌' : 'الحملة محتاجة تظبيط'}</h4>
    <p>${good ? `ACoS أقل من نقطة التعادل. زوّد الميزانية تدريجياً (20%) على الكلمات اللي بتجيب طلبات، وخلي الـ Bid أقل من $${maxCpc.toFixed(2)}.` : `ACoS أعلى من ${be.toFixed(0)}% (نقطة التعادل). نزّل الـ Bid لحد $${(maxCpc * 0.8).toFixed(2)} تقريباً، وضيف الكلمات اللي ليها نقرات من غير طلبات كـ Negative، وراجع صفحة الكتاب (الغلاف والوصف) لأن التحويل ${(cvr * 100).toFixed(1)}%.`}</p></div></div>`;
  paint();
}

/* ── الإعدادات ── */
VIEWS.settings = {
  title: () => 'الإعدادات',
  sub: () => sourceLabel(),
  render() {
    const st = S.settings, nd = st.notify, perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const priceFields = [
      ['formatText', 'تنسيق نص فقط — للصفحة'], ['formatMedia', 'تنسيق بصور أو جداول — للصفحة'], ['proofread', 'تدقيق لغوي وإملائي — للصفحة'],
      ['translateEn', 'ترجمة عربي - إنجليزي — للصفحة'], ['translateDe', 'ترجمة عربي - ألماني — للصفحة'],
      ['cover', 'تصميم غلاف (لغة واحدة)'], ['cover2', 'غلاف اللغة الثانية (يبدأ من)'],
      ['account', 'إنشاء حساب KDP (مرة واحدة)'], ['ebook', 'نشر النسخة الإلكترونية — للكتاب'], ['paper', 'نشر النسخة الورقية — للكتاب'],
      ['reelMin', 'فيديو Reels — للدقيقة (يبدأ من)'], ['poster', 'بوستر / موك أب — للتصميم'], ['marketingMonth', 'خطة تسويق متكاملة — للشهر'],
      ['bulk1', 'دور النشر: 1 - 3 كتب — للكتاب'], ['bulk4', 'دور النشر: 4 - 9 كتب — للكتاب'], ['bulk10', 'دور النشر: 10 - 49 كتاب — للكتاب'],
      ['pkgLaunch', 'باقة الانطلاقة (عميل جديد)'], ['pkgContinue', 'باقة الاستمرارية (عنده حساب)'], ['pkgPages', 'عدد صفحات الباقة'],
    ];
    const pin = (m, k) => `<input data-price="${m}:${k}" inputmode="decimal" value="${st.prices[m][k]}" aria-label="${m === 'EG' ? 'مصر' : 'السعودية'}" style="width:100%;padding:8px 10px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface-2)">`;
    return `<div class="grid g-2">
    <div class="card">
      <div class="card-head"><h3>${ic('sheet')} الربط بشيت "ادارة العمل"</h3><span class="badge tone-${S.source === 'live' ? 'good' : S.source === 'local' ? 'muted' : 'warning'}">${S.source === 'live' ? 'متصل' : S.source === 'local' ? 'غير مربوط' : 'غير متصل'}</span></div>
      <div class="form">
        <div class="field full"><label>${ic('link')} رابط Apps Script (بينتهي بـ /exec)</label><input id="sUrl" dir="ltr" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(st.url)}"></div>
        <div class="field full"><label>${ic('key-round')} كلمة السر (API_KEY)</label><input id="sKey" dir="ltr" type="password" value="${esc(st.key)}"></div>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn primary" id="sConnect">${ic('plug-zap')} حفظ واختبار الاتصال</button><a class="btn" href="#/setup">${ic('book-open-check')} إزاي أجيب الرابط؟</a>
      ${st.url ? `<button class="btn ghost danger" id="sDisconnect">${ic('unplug')} فصل</button>` : ''}</div>
    </div>
    <div class="card">
      <div class="card-head"><h3>${ic('bell-ring')} الإشعارات</h3><span class="badge tone-${perm === 'granted' ? 'good' : 'muted'}">${perm === 'granted' ? 'مسموحة' : perm === 'denied' ? 'مرفوضة من المتصفح' : perm === 'unsupported' ? 'غير مدعومة' : 'مش مفعلة'}</span></div>
      <div class="setting-row"><div><b>تفعيل الإشعارات</b><div class="muted small">تذكير بالتسليمات، العربون، المهام، وفكرة كل يوم</div></div><label class="switch"><input type="checkbox" id="nOn" ${nd.enabled && perm === 'granted' ? 'checked' : ''}><span></span></label></div>
      <div class="setting-row"><div><b>تذكير قبل التسليم بـ</b></div><select id="nDays" class="btn sm">${[1, 2, 3, 5].map(d => `<option ${nd.deadlineDays === d ? 'selected' : ''} value="${d}">${d} يوم</option>`).join('')}</select></div>
      <div class="setting-row"><div><b>تذكير العربون بعد</b></div><select id="nDep" class="btn sm">${[2, 3, 5, 7].map(d => `<option ${nd.depositDays === d ? 'selected' : ''} value="${d}">${d} أيام</option>`).join('')}</select></div>
      <div class="setting-row"><div><b>تذكير المهام</b></div><label class="switch"><input type="checkbox" id="nTasks" ${nd.tasks ? 'checked' : ''}><span></span></label></div>
      <div class="setting-row"><div><b>فكرة اليوم 💡</b></div><label class="switch"><input type="checkbox" id="nIdea" ${nd.dailyIdea ? 'checked' : ''}><span></span></label></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" id="nTest">${ic('bell')} إشعار تجريبي</button></div>
      <p class="muted small" style="margin-bottom:0">${ic('info')} على الموبايل (Android) واللابتوب (Chrome/Edge) الإشعارات بتشتغل حتى والأبلكيشن مقفول بعد التثبيت. على iPhone لازم تثبته على الشاشة الرئيسية الأول. ولضمان التذكير اليومي فعّل كمان "الملخص اليومي على الإيميل" من دليل الربط.</p>
    </div>
    <div class="card">
      <div class="card-head"><h3>${ic('user-round-cog')} عام</h3></div>
      <div class="form">
        <div class="field"><label>${ic('user')} اسمك (للترحيب)</label><input id="sName" value="${esc(st.userName)}"></div>
        <div class="field"><label>${ic('sun-moon')} المظهر</label><select id="sTheme">${[['auto', 'تلقائي'], ['dark', 'ليلي'], ['light', 'نهاري']].map(([v, l]) => `<option value="${v}" ${st.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>${ic('coins')} سعر الريال بالجنيه</label><input id="sSar" inputmode="decimal" value="${st.sarRate}"></div>
        <div class="field"><label>${ic('dollar-sign')} سعر الدولار بالجنيه</label><input id="sUsd" inputmode="decimal" value="${st.usdRate}"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>${ic('download')} تثبيت التطبيق</h3>${standalone ? `<span class="badge tone-good">${ic('check')}متثبت</span>` : ''}</div>
      ${S.installPrompt ? `<button class="btn primary" id="sInstall">${ic('download')} ثبّت KDP Hub على الجهاز ده</button>` : `<button class="btn" data-act="install-help">${ic('smartphone')} خطوات التثبيت على الموبايل</button>`}
      <ul class="steps" style="margin-top:12px">
        ${isIOS ? '<li>على iPhone: افتح الرابط من Safari ← زرار المشاركة ⬆️ ← "Add to Home Screen"</li>' : '<li>على الموبايل (Chrome): القائمة ⋮ ← "تثبيت التطبيق" أو "Add to Home screen"</li><li>على اللابتوب (Chrome / Edge): أيقونة التثبيت ⊕ في شريط العنوان</li>'}
      </ul>
    </div>
    <div class="card span-2">
      <div class="card-head"><h3>${ic('badge-dollar-sign')} أسعار خدماتك (من قائمة أسعار سبتمبر 2026)</h3><button class="btn sm ghost" id="rReset">${ic('rotate-ccw')} رجّع أسعار القائمة</button></div>
      <p class="muted small" style="margin-top:0">الأسعار دي بتستخدمها حاسبة عرض السعر والرسائل الجاهزة. أي تعديل بيتحفظ على الجهاز ده.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>الخدمة</th><th style="min-width:110px">مصر (جنيه)</th><th style="min-width:110px">السعودية (ريال)</th></tr></thead>
      <tbody>${priceFields.map(([k, l]) => `<tr><td style="white-space:normal">${l}</td><td>${pin('EG', k)}</td><td>${pin('SA', k)}</td></tr>`).join('')}</tbody></table></div>
      <div class="form" style="margin-top:14px">
        <div class="field"><label>${ic('wallet')} طريقة الدفع (مصر)</label><textarea data-pay="EG" style="min-height:60px">${esc(st.prices.EG.payment)}</textarea></div>
        <div class="field"><label>${ic('wallet')} طريقة الدفع (السعودية)</label><textarea data-pay="SA" style="min-height:60px">${esc(st.prices.SA.payment)}</textarea></div>
      </div>
    </div>
    <div class="card span-2">
      <div class="card-head"><h3>${ic('database')} البيانات</h3></div>
      <div class="row"><button class="btn" id="dExport">${ic('file-down')} تنزيل نسخة احتياطية (JSON)</button>
      ${!hasRemote() ? `<button class="btn" id="dReset">${ic('rotate-ccw')} رجّع البيانات التجريبية</button><button class="btn danger" id="dEmpty">${ic('eraser')} ابدأ بدون بيانات تجريبية</button>` : `<button class="btn" id="dClear">${ic('eraser')} امسح النسخة المحفوظة على الجهاز</button>`}</div>
    </div></div>`;
  },
  after() {
    const st = S.settings;
    const persist = (msg = 'اتحفظ ✓') => { D.saveSettings(st); toast(msg, 'ok'); };
    $('#sConnect').onclick = async () => {
      st.url = $('#sUrl').value.trim(); st.key = $('#sKey').value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(st.url)) return toast('الرابط لازم يكون رابط Apps Script اللي بينتهي بـ /exec', 'err');
      D.saveSettings(st);
      try {
        $('#sConnect').disabled = true;
        const data = await D.fetchRemote(st);
        S.raw = data; S.source = 'live'; S.error = null; S.lastSync = Date.now();
        D.LS.set('cache', data); D.LS.set('lastSync', S.lastSync);
        processData(); renderView(true);
        toast(`اتربط بنجاح 🎉 — لقيت ${data.clients.length} صف في الشيت`, 'ok'); confetti();
      } catch (e) { toast('فشل الاتصال: ' + e.message, 'err'); $('#sConnect').disabled = false; }
    };
    $('#sDisconnect') && ($('#sDisconnect').onclick = () => { if (!confirm('فصل الأبلكيشن عن الشيت؟ (الشيت نفسه مش هيتأثر)')) return; st.url = ''; st.key = ''; D.saveSettings(st); D.LS.del('cache'); loadInitial(); renderView(); });
    $('#nOn').onchange = async e => {
      if (e.target.checked) {
        const ok = await enableNotifications();
        st.notify.enabled = ok; e.target.checked = ok;
      } else st.notify.enabled = false;
      persist(); checkNotifications();
    };
    $('#nDays').onchange = e => { st.notify.deadlineDays = +e.target.value; persist(); processData(); };
    $('#nDep').onchange = e => { st.notify.depositDays = +e.target.value; persist(); processData(); };
    $('#nTasks').onchange = e => { st.notify.tasks = e.target.checked; persist(); processData(); };
    $('#nIdea').onchange = e => { st.notify.dailyIdea = e.target.checked; persist(); processData(); };
    $('#nTest').onclick = async () => { if (await enableNotifications()) notify({ id: 'test-' + Date.now(), title: 'KDP Hub شغال 🎉', body: 'كده الإشعارات هتوصلك على الجهاز ده.', href: '#/home' }); };
    $('#sName').onchange = e => { st.userName = e.target.value.trim(); persist(); };
    $('#sTheme').onchange = e => { st.theme = e.target.value; persist('اتغير المظهر'); applyTheme(); renderView(true); };
    $('#sSar').onchange = e => { st.sarRate = Number(e.target.value) || 13; persist(); processData(); };
    $('#sUsd').onchange = e => { st.usdRate = Number(e.target.value) || 50; persist(); processData(); };
    $$('[data-price]').forEach(i => i.onchange = () => { const [m, k] = i.dataset.price.split(':'); st.prices[m][k] = Number(D.toLatin(i.value).replace(/[^\d.]/g, '')) || 0; persist(); });
    $$('[data-pay]').forEach(t => t.onchange = () => { st.prices[t.dataset.pay].payment = t.value.trim(); persist(); });
    $('#rReset').onclick = () => { st.prices = JSON.parse(JSON.stringify(D.DEFAULT_PRICES)); persist('رجعت أسعار القائمة'); renderView(true); };
    $('#sInstall') && ($('#sInstall').onclick = async () => { S.installPrompt.prompt(); await S.installPrompt.userChoice; S.installPrompt = null; renderView(true); });
    $('#dExport').onclick = () => {
      const blob = new Blob([JSON.stringify(S.raw, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `kdp-hub-backup-${D.isoDay(new Date())}.json` });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('#dReset') && ($('#dReset').onclick = () => { D.LS.del('local'); loadInitial(); renderView(); toast('رجعت البيانات التجريبية', 'ok'); });
    $('#dEmpty') && ($('#dEmpty').onclick = () => { if (!confirm('هتمسح البيانات التجريبية من الجهاز ده. تكمل؟')) return; S.raw = { clients: [], tasks: [], expenses: [], ads: [], notes: [] }; D.LS.set('local', S.raw); processData(); renderView(); });
    $('#dClear') && ($('#dClear').onclick = () => { D.LS.del('cache'); toast('اتمسحت النسخة المحلية — هتتحمل من الشيت تاني', 'ok'); sync(); });
  },
};

/* ── دليل الربط ── */
VIEWS.setup = {
  title: () => 'دليل الربط والتثبيت',
  sub: () => '3 خطوات وتبقى شغال — مرة واحدة بس',
  render: () => `
  <div class="grid g-2">
    <div class="card span-2 insight t-info"><div class="ins-icon tone-info">${ic('shield-check')}</div><div><h4>بياناتك بتفضل في الشيت بتاعك على جوجل درايف</h4><p>الأبلكيشن بيكلم الشيت عن طريق "Apps Script" صغير انت اللي بتركبه في الشيت بنفسك ومحمي بكلمة سر. مفيش أي سيرفر وسيط بيشوف بيانات عملاءك.</p></div></div>
    <div class="card">
      <div class="card-head"><h3>${ic('sheet')} 1) ربط الشيت (5 دقايق)</h3></div>
      <ol class="steps">
        <li>افتح شيت <b>"ادارة العمل"</b> على جوجل درايف من اللابتوب.</li>
        <li>من القائمة اللي فوق: <b>Extensions ← Apps Script</b> (الإضافات ← برمجة التطبيقات).</li>
        <li>امسح أي كود موجود، والصق كود الملف <code>apps-script/Code.gs</code> <button class="btn sm" id="copyGs">${ic('copy')} انسخ الكود</button></li>
        <li>غيّر السطر <code>const API_KEY = 'CHANGE-ME-2026'</code> لكلمة سر من اختيارك (إنجليزي وأرقام)، ودوس حفظ 💾.</li>
        <li>دوس <b>Deploy ← New deployment</b> ← اختار النوع <b>Web app</b>.</li>
        <li>خلي <b>Execute as: Me</b> و <b>Who has access: Anyone</b> ← Deploy ← وافق على الصلاحيات (Advanced ← Go to project).</li>
        <li>انسخ الرابط <b>Web app URL</b> اللي بينتهي بـ <code>/exec</code>.</li>
        <li>في الأبلكيشن: <a href="#/settings" style="color:var(--accent)">الإعدادات</a> ← الصق الرابط وكلمة السر ← "حفظ واختبار الاتصال" 🎉</li>
      </ol>
    </div>
    <div class="card">
      <div class="card-head"><h3>${ic('mail')} 2) ملخص يومي على الإيميل (اختياري)</h3></div>
      <ol class="steps">
        <li>في نفس صفحة Apps Script، اختار الدالة <code>setupDailyDigest</code> من القائمة اللي فوق.</li>
        <li>دوس <b>Run ▶</b> مرة واحدة ووافق على الصلاحيات.</li>
        <li>كل يوم الساعة 9 الصبح هيوصلك إيميل بالتسليمات القريبة والمتأخرات والعربون — وده بيوصلك كإشعار Gmail على الموبايل حتى لو الأبلكيشن مقفول.</li>
      </ol>
      <div class="card-head" style="margin-top:20px"><h3>${ic('refresh-ccw')} لو عدّلت الكود بعدين</h3></div>
      <p class="muted small">Deploy ← Manage deployments ← ✏️ ← Version: New version ← Deploy. الرابط بيفضل زي ما هو.</p>
      <p class="muted small">أول مرة بعد إضافة صور التحويلات، جوجل هيطلب صلاحية على Google Drive عشان يحفظ الصور في فولدر "KDP Hub - صور التحويلات" جنب الشيت. وافق عليها (Advanced ← Go to project ← Allow).</p>
    </div>
    <div class="card span-2">
      <div class="card-head"><h3>${ic('smartphone')} 3) تثبيت الأبلكيشن على الموبايل واللابتوب</h3></div>
      <p class="muted">عشان يتسطّب على الموبايل لازم الأبلكيشن يكون على رابط https. أسهل طريقة مجانية:</p>
      <ol class="steps">
        <li>ادخل على <b>app.netlify.com/drop</b> (أو GitHub Pages) واعمل حساب مجاني.</li>
        <li>اسحب فولدر <code>KDP-Hub</code> كله وافلته في الصفحة ← هيديك رابط زي <code>https://اسم-عشوائي.netlify.app</code>.</li>
        <li><b>اللابتوب:</b> افتح الرابط في Chrome أو Edge ← أيقونة التثبيت ⊕ في شريط العنوان.</li>
        <li><b>Android:</b> افتح الرابط في Chrome ← ⋮ ← "تثبيت التطبيق".</li>
        <li><b>iPhone:</b> افتح الرابط في Safari ← مشاركة ⬆️ ← "Add to Home Screen".</li>
        <li>على كل جهاز: الإعدادات ← الصق رابط الشيت وكلمة السر ← فعّل الإشعارات 🔔</li>
      </ol>
    </div>
  </div>`,
  after() {
    $('#copyGs').onclick = async () => {
      try { const txt = await (await fetch('apps-script/Code.gs')).text(); await navigator.clipboard.writeText(txt); toast('اتنسخ الكود ✓ الصقه في Apps Script', 'ok'); }
      catch { toast('افتح ملف apps-script/Code.gs من الفولدر وانسخه يدوي', 'err'); }
    };
  },
};

/* ═════════════ النماذج ═════════════ */

const SERVICE_CHIPS = ['تنسيق نسخة عربية', 'ترجمة إنجليزي', 'إنشاء حساب KDP', 'نشر إلكتروني', 'نشر ورقي', 'تصميم غلاف', 'تصميم 3D', 'ريلز', 'خطة تسويق', 'إعلانات Amazon Ads', 'كتاب صوتي'];

function fieldHTML(f, raw) {
  raw = raw ?? '';
  const list = f.list ? `list="dl-${f.key}"` : f.clientList ? 'list="dl-clients"' : '';
  let input;
  if (f.type === 'date') {
    const d = D.parseDate(raw);
    input = raw && !d ? `<input name="${f.key}" type="text" value="${esc(raw)}">` : `<input name="${f.key}" type="date" value="${D.isoDay(d)}">`;
  } else if (f.type === 'select') {
    const opts = f.options.includes(raw) || !raw ? f.options : [raw, ...f.options];
    input = `<select name="${f.key}">${opts.map(o => `<option ${o === raw ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea name="${f.key}">${esc(raw)}</textarea>`;
  } else {
    const t = f.type === 'number' ? 'text" inputmode="numeric' : f.type === 'money' ? 'text" inputmode="decimal' : f.type === 'tel' ? 'tel" dir="ltr' : 'text';
    input = `<input name="${f.key}" type="${t}" value="${esc(raw)}" ${list} ${f.required ? 'required' : ''}>`;
  }
  const chips = f.chips ? `<div class="chips">${SERVICE_CHIPS.map(c => `<button type="button" class="chip" data-chip="${esc(c)}">${ic('plus')}${esc(c)}</button>`).join('')}</div>` : '';
  const dl = f.list ? `<datalist id="dl-${f.key}">${f.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '';
  return `<div class="field ${f.full ? 'full' : ''}"><label>${ic(f.icon)} ${f.label}${f.required ? ' *' : ''}</label>${input}${dl}${chips}${f.hint ? `<div class="hint">${f.hint}</div>` : ''}</div>`;
}

function readForm(schema, root) {
  const out = {};
  schema.forEach(f => {
    const el = root.querySelector(`[name="${f.key}"]`);
    if (!el) return;
    out[f.key] = el.type === 'date' ? (el.value ? D.sheetDay(new Date(el.value + 'T00:00')) : '') : el.value.trim();
  });
  return out;
}

function openForm(sheet, item = null, prefill = {}) {
  const schema = SCHEMAS[sheet].filter(f => !f.auto || item);
  const defaults = { subscriptions: { currency: 'دولار', cycle: 'شهري', status: 'شغال' }, installments: { status: 'شغال', paidCount: '0' }, expenses: { kind: 'شغل' } }[sheet] || {};
  const vals = item || { ...defaults, ...prefill };
  const clientNames = [...new Set(S.projects.map(p => p.displayName))];
  openSheet({
    title: `${ic(item ? 'pencil' : SHEET_ICONS[sheet])} ${item ? 'تعديل' : 'إضافة'} ${LABELS[sheet]}`,
    body: `<form class="form" id="fForm" onsubmit="return false">${schema.map(f => fieldHTML(f, vals[f.key])).join('')}</form><datalist id="dl-clients">${clientNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      ${!hasRemote() ? `<p class="muted small" style="margin-top:14px">${ic('info')} الأبلكيشن مش مربوط بالشيت لسه — البيانات هتتحفظ على الجهاز ده بس.</p>` : sheet !== 'clients' && !(S.raw[sheet] || []).length ? `<p class="muted small" style="margin-top:14px">${ic('info')} أول مرة تضيف هنا هيتعمل تاب جديد اسمه "${esc({ tasks: 'المهام', expenses: 'المصروفات', ads: 'حملات Amazon Ads', notes: 'ملاحظات وأفكار', subscriptions: 'الاشتراكات', installments: 'الأقساط', otherIncome: 'دخل إضافي' }[sheet])}" في نفس الشيت.</p>` : ''}`,
    foot: `<button class="btn primary" id="fSave">${ic('check')} حفظ${hasRemote() ? ' في الشيت' : ''}</button><button class="btn ghost" id="fCancel">إلغاء</button>${item ? `<button class="btn danger" id="fDel" style="margin-inline-start:auto">${ic('trash-2')} حذف</button>` : ''}`,
  });
  const form = $('#fForm');
  $$('[data-chip]', form).forEach(c => c.onclick = () => { const ta = form.querySelector('[name="project"]'); ta.value = ta.value.trim() ? ta.value.trim() + ' + ' + c.dataset.chip : c.dataset.chip; c.classList.add('on'); });
  $('#fCancel').onclick = () => item && sheet === 'clients' ? openProject(item.id) : closeSheet();
  $('#fDel') && ($('#fDel').onclick = () => confirmDelete(sheet, item));
  $('#fSave').onclick = async () => {
    let values = readForm(schema, form);
    const missing = schema.find(f => f.required && !values[f.key]);
    if (missing) return toast(`اكتب "${missing.label}"`, 'err');
    if (sheet === 'clients' && !values.remaining && values.total) {
      const t = D.parseMoney(values.total), d = D.parseMoney(values.deposit);
      if (t.has) values.remaining = String(Math.max(t.amount - d.amount, 0)) + (t.currency === 'SAR' ? ' ريال' : '');
      if (t.has && t.amount - d.amount <= 0) values.remaining = 'خالص';
    }
    if (!item) {
      if ('date' in values && !values.date) values.date = D.sheetDay(new Date());
      if (SCHEMAS[sheet].some(f => f.key === 'date' && f.auto)) values.date = D.sheetDay(new Date());
    } else {
      // بنبعت بس الخانات اللي اتغيرت عشان منغيرش شكل باقي الشيت
      values = Object.fromEntries(Object.entries(values).filter(([k, v]) => {
        const f = schema.find(x => x.key === k), o = item[k] ?? '';
        if (f.type === 'date' && D.parseDate(o) && v) return D.isoDay(D.parseDate(o)) !== D.isoDay(D.parseDate(v));
        return String(o).trim() !== v;
      }));
      if (!Object.keys(values).length) return item && sheet === 'clients' ? openProject(item.id) : closeSheet();
    }
    $('#fSave').disabled = true;
    const ok = await save(sheet, item ? 'update' : 'add', item?._row ?? null, values, item ? checkFor(sheet, item) : null);
    if (ok) { if (item && sheet === 'clients') { S.openProjectId = item.id; refreshOpenProject(); } else closeSheet(); if (!item) confetti(); }
    else $('#fSave').disabled = false;
  };
}

function openQuickAdd() {
  const opts = [['clients', 'عميل / مشروع جديد', 'user-plus', 'يتسجل في شيت ادارة العمل'], ['payment', 'صورة تحويل من عميل', 'receipt-text', 'تتحفظ وتأكدها'], ['campaign', 'حملة إعلانية جديدة', 'megaphone', 'تتابع صرفها وعائدها'], ['tasks', 'مهمة', 'square-check', 'بتذكير في ميعادها'], ['expenses', 'مصروف (شغل أو شخصي)', 'receipt', 'فريلانسرز، بيت، مواصلات…'], ['subscriptions', 'اشتراك برنامج', 'repeat', 'Canva، ChatGPT، Claude…'], ['installments', 'قسط', 'calendar-range', 'لابتوب، موبايل، جمعية…'], ['otherIncome', 'دخل تاني', 'hand-coins', 'مرتب، أرباح كتب…'], ['ads', 'سجل حملة Amazon Ads', 'target', 'إنفاق ومبيعات'], ['notes', 'ملاحظة أو فكرة', 'notebook-pen', 'أي حاجة عايز تفتكرها'], ['quote', 'عرض سعر لعميل', 'file-badge', 'يتحسب ويتبعت واتساب']];
  openSheet({
    title: `${ic('plus')} إضافة`,
    body: `<div class="more-grid">${opts.map(([k, l, i, s]) => `<button class="card more-tile" data-q="${k}" style="text-align:right;cursor:pointer"><div class="kpi-icon">${ic(i)}</div><b>${l}</b><small>${s}</small></button>`).join('')}</div>`,
  });
  $$('#sheet [data-q]').forEach(b => b.onclick = () => {
    const k = b.dataset.q;
    if (k === 'quote') { closeSheet(); location.hash = '#/tools?t=quote'; }
    else if (k === 'payment') openPaymentForm();
    else if (k === 'campaign') openCampaignForm();
    else openForm(k);
  });
}

/* ═════════════ مساعدة التثبيت على الموبايل ═════════════ */

const UA = navigator.userAgent;
const device = () => ({
  ios: /iphone|ipad|ipod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  android: /android/i.test(UA),
  mobile: /android|iphone|ipad|ipod|mobile/i.test(UA) || matchMedia('(max-width: 900px) and (pointer: coarse)').matches,
  inApp: /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok|; wv\)/i.test(UA),
  iosNotSafari: /CriOS|FxiOS|EdgiOS|OPiOS/i.test(UA),
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
});

function installHintHTML() {
  const d = device();
  if (!d.mobile || d.standalone || D.LS.get('installHintHidden', false)) return '';
  return `<div class="banner" style="border-style:solid">${ic('smartphone')}<p><b>ثبّت KDP Hub على موبايلك</b><br><span class="muted small">عشان يفتح زي أي أبلكيشن وتوصلك الإشعارات.</span></p>
    <button class="btn primary sm" data-act="install-help">${ic('download')} ثبّته</button><button class="icon-btn" data-act="install-hide" aria-label="إخفاء" style="width:34px;height:34px">${ic('x')}</button></div>`;
}

async function openInstallHelp() {
  if (S.installPrompt) { S.installPrompt.prompt(); await S.installPrompt.userChoice; S.installPrompt = null; renderView(true); return; }
  const d = device(), link = location.origin + location.pathname;
  let steps;
  if (d.inApp) steps = [
    'الرابط اتفتح جوه أبلكيشن تاني (واتساب أو فيسبوك)، ومن هنا التثبيت مش متاح.',
    d.ios ? 'دوس زرار البوصلة أو النقط التلاتة تحت أو فوق ← <b>Open in Safari</b> (افتح في Safari).' : 'دوس النقط التلاتة ⋮ فوق ← <b>Open in Chrome</b> (افتح في Chrome).',
    'أو انسخ الرابط من الزرار اللي تحت والصقه في ' + (d.ios ? 'Safari' : 'Chrome') + ' بنفسك.',
    'بعد ما يفتح هناك ارجع للصفحة دي واتبع الخطوات.',
  ];
  else if (d.ios) steps = [
    d.iosNotSafari ? 'افتح الرابط في <b>Safari</b> (الأضمن على iPhone). انسخه من الزرار اللي تحت.' : 'إنت فاتحه من Safari، تمام.',
    'دوس زرار المشاركة <b>⬆️</b> (مربع وخارج منه سهم) تحت في نص الشاشة.',
    'انزل في القايمة واختار <b>Add to Home Screen</b> (إضافة إلى الشاشة الرئيسية).',
    'دوس <b>Add</b> (إضافة) فوق على اليمين.',
    'افتح KDP Hub من الأيقونة الجديدة على الشاشة، ومن الإعدادات فعّل الإشعارات.',
  ];
  else steps = [
    'لازم يكون الرابط مفتوح في <b>Google Chrome</b>. لو فاتحه من متصفح تاني (سامسونج أو شاومي) انسخ الرابط وافتحه في Chrome.',
    'دوس النقط التلاتة <b>⋮</b> فوق على اليمين.',
    'اختار <b>تثبيت التطبيق</b> (Install app). لو مش لاقيها، اختار <b>إضافة إلى الشاشة الرئيسية</b> (Add to Home screen) ← وبعدين <b>تثبيت</b>.',
    'افتح KDP Hub من الأيقونة الجديدة، ومن الإعدادات اربط الشيت وفعّل الإشعارات.',
  ];
  openSheet({
    title: `${ic('smartphone')} تثبيت على ${d.ios ? 'iPhone' : d.android ? 'Android' : 'الموبايل'}`,
    body: `<ol class="steps">${steps.map(s => `<li><span>${s}</span></li>`).join('')}</ol>
      <div class="row" style="margin-top:16px"><button class="btn" id="copyLink">${ic('copy')} انسخ رابط الأبلكيشن</button></div>
      <p class="muted small" style="margin-top:12px;direction:ltr;text-align:right">${esc(link)}</p>`,
  });
  $('#copyLink').onclick = () => navigator.clipboard.writeText(link).then(() => toast('اتنسخ الرابط', 'ok')).catch(() => toast('انسخ الرابط اللي تحت يدوي', 'err'));
}

/* ═════════════ الـ Sheet والـ Toast ═════════════ */

function openSheet({ title, body, foot = '' }) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="sheet-head"><h2>${title}</h2><button class="icon-btn" id="sheetX" aria-label="إغلاق">${ic('x')}</button></div><div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
  sh.hidden = false; $('#sheetBackdrop').hidden = false;
  $('#sheetX').onclick = () => closeSheet();
  document.body.style.overflow = 'hidden';
  paint();
}
function closeSheet(silent) {
  $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true; document.body.style.overflow = '';
  S.openProjectId = null;
  if (!silent && location.hash.startsWith('#/project/')) history.replaceState(null, '', '#/projects');
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${ic(kind === 'ok' ? 'circle-check' : 'circle-alert')}<span>${esc(msg)}</span>`;
  $('#toasts').append(el); paint();
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3000);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#7b5cff', '#10c2e0', '#f59e0b', '#ec4899', '#10b981'];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('span');
    const x = (Math.random() - .5) * 500, y = -200 - Math.random() * 300;
    Object.assign(p.style, { position: 'fixed', left: '50%', top: '60%', width: '8px', height: '12px', borderRadius: '2px', background: colors[i % 5], zIndex: 99, pointerEvents: 'none' });
    document.body.append(p);
    p.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${x}px,${y}px) rotate(${Math.random() * 720}deg)`, opacity: 1, offset: .6 }, { transform: `translate(${x * 1.2}px,${y + 400}px) rotate(900deg)`, opacity: 0 }], { duration: 1400 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => p.remove();
  }
}

// كليكات عامة (فتح مشروع، تعديل عنصر، إضافة، عميل جديد)
document.addEventListener('click', e => {
  const rcv = e.target.closest('[data-rcpt-view]');
  if (rcv) { viewReceipt(rcv.dataset.rcptView); return; }
  const cinc = e.target.closest('[data-cinc]');
  if (cinc) { openIncomeForm(cinc.dataset.cinc); return; }
  if (e.target.closest('[data-act="new-payment"]')) { openPaymentForm(); return; }
  if (e.target.closest('[data-act="new-campaign"]')) { openCampaignForm(); return; }
  const open = e.target.closest('[data-open]');
  if (open) { openProject(open.dataset.open); return; }
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const [sheet, id] = edit.dataset.edit.split(':');
    if (sheet === 'payments') { const p = S.payments.find(x => x.id === id); if (p) openPaymentDetail(p); return; }
    if (sheet === 'campaigns') { openCampaign(id); return; }
    if (sheet === 'incomes') { const x = S.incomes.find(i => i.id === id); if (x) openIncomeForm(null, x); return; }
    const item = S[sheet].find(x => x.id === id); if (item) openForm(sheet, item);
    return;
  }
  const add = e.target.closest('[data-add]');
  if (add) { openForm(add.dataset.add, null, add.dataset.kind ? { kind: add.dataset.kind } : add.dataset.pre ? JSON.parse(add.dataset.pre) : {}); return; }
  if (e.target.closest('[data-act="new-client"]')) openForm('clients');
  if (e.target.closest('[data-act="install-help"]')) openInstallHelp();
  if (e.target.closest('[data-act="install-hide"]')) { D.LS.set('installHintHidden', true); renderView(true); }
});

/* ═════════════ الثيم ═════════════ */

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').content = dark ? '#0b0a17' : '#f4f3fb';
  const b = $('#themeBtn'); if (b) b.innerHTML = ic(t === 'auto' ? 'sun-moon' : dark ? 'moon-star' : 'sun');
  paint();
}
function cycleTheme() {
  const order = ['auto', 'dark', 'light'];
  S.settings.theme = order[(order.indexOf(S.settings.theme) + 1) % 3];
  D.saveSettings(S.settings); applyTheme(); renderView(true);
  toast({ auto: 'المظهر: تلقائي حسب الجهاز', dark: 'المظهر: ليلي 🌙', light: 'المظهر: نهاري ☀️' }[S.settings.theme], 'ok');
}

/* ═════════════ الإشعارات ═════════════ */

function openNotificationCenter() {
  const due = dueReminders(), idea = I.ideaOfTheDay();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  openSheet({
    title: `${ic('bell')} التنبيهات`,
    body: `${perm !== 'granted' && perm !== 'unsupported' ? `<div class="banner">${ic('bell-ring')}<p>فعّل الإشعارات عشان التنبيهات دي توصلك على الموبايل واللابتوب.</p><button class="btn primary sm" id="ncEnable">فعّل</button></div>` : ''}
      ${due.length ? `<div class="list">${due.map(r => `<a class="list-item" href="${r.href}"><div class="ins-icon tone-${r.tone}" style="width:40px;height:40px;border-radius:12px;display:grid;place-items:center">${ic(r.icon)}</div><div class="li-body"><div class="li-title">${esc(r.title)}</div><div class="li-sub">${esc(r.body)}</div></div>${ic('chevron-left')}</a>`).join('')}</div>`
        : emptyState('bell-off', 'مفيش تنبيهات دلوقتي', 'كل حاجة تحت السيطرة 👌')}
      <div class="card insight t-info" style="margin-top:14px;box-shadow:none"><div class="ins-icon tone-info">${ic('lightbulb')}</div><div><div class="muted small">فكرة اليوم</div><h4>${esc(idea.title)}</h4><p>${esc(idea.text)}</p></div></div>`,
  });
  $('#ncEnable') && ($('#ncEnable').onclick = async () => { if (await enableNotifications()) { S.settings.notify.enabled = true; D.saveSettings(S.settings); checkNotifications(); openNotificationCenter(); } });
  $$('#sheet a.list-item').forEach(a => a.addEventListener('click', () => closeSheet(true)));
}

async function enableNotifications() {
  if (!('Notification' in window)) { toast('المتصفح ده مش بيدعم الإشعارات — على iPhone ثبّت الأبلكيشن على الشاشة الرئيسية الأول', 'err'); return false; }
  let p = Notification.permission;
  if (p === 'default') p = await Notification.requestPermission();
  if (p !== 'granted') { toast('الإشعارات مرفوضة — فعّلها من إعدادات المتصفح للموقع ده', 'err'); return false; }
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.periodicSync) {
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => null);
      if (!st || st.state === 'granted') await reg.periodicSync.register('kdphub-check', { minInterval: 4 * 60 * 60 * 1000 });
    }
  } catch { /* الفحص الدوري في الخلفية مش متاح — هنكتفي بالفحص وقت فتح الأبلكيشن */ }
  return true;
}

async function notify(r) {
  const opts = { body: r.body, tag: r.id, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', lang: 'ar', dir: 'rtl', data: { href: r.href || '#/home' } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(r.title, opts); else new Notification(r.title, opts);
  } catch { /* */ }
}

async function checkNotifications() {
  if (!S.settings.notify.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const today = D.isoDay(new Date());
  const notified = (await idbGet('notified')) || {};
  const due = S.reminders.filter(r => r.fireOn <= today && !notified[r.id] && (r.kind !== 'idea' || new Date().getHours() >= 9));
  if (!due.length) return;
  const urgent = due.filter(r => r.kind !== 'idea');
  const show = urgent.length > 4 ? [...urgent.slice(0, 3), { id: 'sum-' + today + '-' + urgent.length, title: `و ${urgent.length - 3} تنبيهات تانية`, body: 'افتح KDP Hub عشان تشوفهم', href: '#/home' }] : urgent;
  for (const r of show) await notify(r);
  const idea = due.find(r => r.kind === 'idea'); if (idea) await notify(idea);
  due.forEach(r => { notified[r.id] = Date.now(); });
  const cutoff = Date.now() - 45 * 864e5;
  Object.keys(notified).forEach(k => notified[k] < cutoff && delete notified[k]);
  await idbSet('notified', notified);
}

/* ═════════════ Service Worker و IndexedDB ═════════════ */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(() => checkNotifications()).catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.href) location.hash = e.data.href; });
}

function idb() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('no idb'));
    const r = indexedDB.open('kdphub', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) { try { const db = await idb(); return await new Promise(r => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); } catch { return D.LS.get('idb-' + k, null); } }
async function idbSet(k, v) { try { const db = await idb(); await new Promise(r => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(JSON.parse(JSON.stringify(v)), k); t.oncomplete = r; t.onerror = r; }); } catch { D.LS.set('idb-' + k, v); } }

boot();
