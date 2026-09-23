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

const S = {
  settings: D.loadSettings(),
  raw: null, source: 'local', syncing: false, error: null, lastSync: D.LS.get('lastSync', null),
  projects: [], tasks: [], expenses: [], ads: [], notes: [], k: null, reminders: [],
  charts: [], route: { name: 'home', params: new URLSearchParams() },
  pf: { f: 'all', q: '', svc: '', sort: 'recent' }, aPeriod: '6', ideasTab: 'smart', toolTab: 'quote', quoteMkt: 'EG', qDaysTouched: false,
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
    map[S.route.name] ? openForm(map[S.route.name]) : openQuickAdd();
  };
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
  S.k = I.kpis(S.projects, S.expenses);
  S.reminders = I.reminders(S.projects, S.tasks, st);
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

async function save(sheet, action, row, values, check) {
  if (!hasRemote()) {
    applyLocal(sheet, action, row, values);
    D.LS.set('local', S.raw);
    processData(); renderView(true);
    toast(action === 'delete' ? 'اتمسح' : 'اتحفظ (وضع تجريبي على الجهاز)', 'ok');
    return true;
  }
  const payload = { sheet, action, row, values, check };
  if (!navigator.onLine) {
    if (action !== 'add') { toast('التعديل محتاج إنترنت', 'err'); return false; }
    S.queue.push(payload); D.LS.set('queue', S.queue);
    applyLocal(sheet, action, row, values); processData(); renderView(true);
    toast('مفيش نت — هيتحفظ في الشيت أول ما النت يرجع', 'ok');
    return true;
  }
  try {
    $('#syncBtn').classList.add('spin');
    await D.postRemote(S.settings, payload);
    toast(action === 'delete' ? 'اتمسح من الشيت' : 'اتحفظ في الشيت ✓', 'ok');
    applyLocal(sheet, action, row, values); processData(); renderView(true);
    sync(true);
    return true;
  } catch (e) {
    toast(e.message, 'err');
    return false;
  } finally { $('#syncBtn').classList.remove('spin'); }
}

const checkFor = (sheet, item) => sheet === 'clients' ? { name: item.name } : sheet === 'ads' ? { book: item.book } : { title: item.title };

/* ═════════════ التنقل ═════════════ */

const NAV = [
  { items: [['home', 'الرئيسية', 'layout-dashboard'], ['projects', 'المشاريع والعملاء', 'folder-kanban'], ['analytics', 'التحليلات', 'chart-column'], ['ideas', 'الأفكار والنمو', 'lightbulb']] },
  { group: 'الشغل', items: [['tasks', 'المهام', 'list-checks'], ['ads', 'Amazon Ads', 'target'], ['expenses', 'المصروفات', 'receipt'], ['notes', 'ملاحظاتي', 'notebook-pen'], ['tools', 'الأدوات والحاسبات', 'calculator']] },
  { group: 'النظام', items: [['settings', 'الإعدادات', 'settings'], ['setup', 'دليل الربط والتثبيت', 'book-open-check']] },
];
const BOTTOM = [['home', 'الرئيسية', 'layout-dashboard'], ['projects', 'المشاريع', 'folder-kanban'], ['analytics', 'التحليلات', 'chart-column'], ['ideas', 'الأفكار', 'lightbulb'], ['more', 'المزيد', 'layout-grid']];

function buildNav() {
  $('#sideNav').innerHTML = NAV.map(g => (g.group ? `<div class="nav-group">${g.group}</div>` : '') +
    g.items.map(([k, l, i]) => `<a class="nav-link" data-nav="${k}" href="#/${k}">${ic(i)}<span>${l}</span>${k === 'projects' || k === 'tasks' ? `<span class="count" data-count="${k}" hidden></span>` : ''}</a>`).join('')).join('');
  $('#bottomNav').innerHTML = BOTTOM.map(([k, l, i]) => `<a data-nav="${k}" href="#/${k}">${ic(i)}<span>${l}</span>${k === 'projects' ? `<span class="count" data-count="projects" hidden></span>` : ''}</a>`).join('');
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
  if (!VIEWS[r.name]) r.name = 'home';
  if (r.name === 'projects' && r.params.get('f')) S.pf.f = r.params.get('f');
  if (r.name === 'tools' && r.params.get('t')) S.toolTab = r.params.get('t');
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
  const active = ['tasks', 'ads', 'expenses', 'notes', 'tools', 'settings', 'setup'].includes(S.route.name) ? 'more' : S.route.name;
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
    const ins = I.insights(S.projects, k, { ads: S.ads }).slice(0, 4);
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
      ${others.length ? `<h4 style="margin:18px 0 8px">${ic('history')} مشاريع تانية لنفس العميل</h4><div class="list">${others.map(o => `<div class="list-item" data-open="${o.id}"><div class="li-body"><div class="li-title">${esc(I.short(o.project, 60))}</div><div class="li-sub">${fmtDate(o.date)}</div></div><div class="li-end"><b>${origMoney(o, o.totalEGP)}</b>${statusBadge(o)}</div></div>`).join('')}</div>` : ''}
    `,
    foot: `<button class="btn primary" id="pEdit">${ic('pencil')} تعديل</button>
      ${p.totalEGP && p.remainingEGP > 0 ? `<button class="btn" id="pPay">${ic('hand-coins')} سجّل دفعة</button>` : ''}
      <button class="btn danger" id="pDel" style="margin-inline-start:auto">${ic('trash-2')} حذف</button>`,
  });
  $('#pEdit').onclick = () => openForm('clients', p);
  $('#pPay') && ($('#pPay').onclick = () => openPayment(p));
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
    const paid = Math.round(p.paidEGP / p.rate) + amt, rem = Math.max(p.totalRaw - paid, 0);
    const suffix = p.currency === 'SAR' ? ' ريال' : '';
    const values = { deposit: paid + suffix, remaining: rem === 0 ? 'خالص' : rem + suffix };
    if (p.statusKey === 'waiting') values.status = 'قيد العمل';
    if (await save('clients', 'update', p._row, values, checkFor('clients', p))) closeSheet();
  };
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
    const exp = sum(S.expenses.filter(e => e.dateObj && set.has(D.monthKey(e.dateObj))), e => e.amountEGP);
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
      const ins = I.insights(S.projects, S.k, { ads: S.ads });
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
VIEWS.expenses = {
  title: () => 'المصروفات',
  sub: () => 'عشان تعرف صافي ربحك الحقيقي',
  render() {
    if (!S.expenses.length) return emptyState('receipt', 'مفيش مصروفات متسجلة', 'سجّل اشتراكاتك (Canva، Adobe…)، الإعلانات، والفريلانسرز — والتحليلات هتحسبلك صافي الربح.', `<button class="btn primary" data-add="expenses">${ic('plus')} مصروف جديد</button>`);
    const mk = D.monthKey(new Date());
    const cur = S.expenses.filter(e => e.dateObj && D.monthKey(e.dateObj) === mk);
    const cats = Object.entries(I.groupBy(S.expenses, e => e.category || 'أخرى')).map(([c, es]) => [c, sum(es, e => e.amountEGP)]).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...cats.map(c => c[1]));
    const list = [...S.expenses].sort((a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0));
    return `<div class="grid g-3">
      ${kpi({ icon: 'calendar', cls: 'i3', label: 'مصروفات الشهر ده', value: I.fmt(sum(cur, e => e.amountEGP)), unit: 'ج.م', foot: `صافي الشهر: ${I.money(S.k.revCur - sum(cur, e => e.amountEGP))}` })}
      ${kpi({ icon: 'sigma', cls: 'i1', label: 'إجمالي المصروفات', value: I.fmt(sum(S.expenses, e => e.amountEGP)), unit: 'ج.م' })}
      ${kpi({ icon: 'tag', cls: 'i4', label: 'أكبر بند', value: esc(cats[0]?.[0] || '—'), foot: cats[0] ? I.money(cats[0][1]) : '' })}
    </div>
    <div class="grid g-main" style="margin-top:16px">
      <div class="card"><div class="card-head"><h3>${ic('chart-column')} الإيراد مقابل المصروفات</h3>${legend([['الإيراد', '--s1'], ['المصروفات', '--s2']])}</div><div class="chart-box"><canvas id="eChart"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>${ic('tags')} حسب الفئة</h3></div>${cats.map(([c, v]) => `<div class="hbar"><span>${esc(c)}</span><div class="track"><span style="width:${v / max * 100}%;background:var(--s2)"></span></div><b class="num small">${I.fmt(v)}</b></div>`).join('')}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="list">${list.map(e => `<div class="list-item" data-edit="expenses:${e.id}"><div class="avatar" style="background:linear-gradient(135deg,#f59e0b,#f97316)">${ic('receipt')}</div>
      <div class="li-body"><div class="li-title">${esc(e.title)}</div><div class="li-sub">${esc(e.category || '')} · ${fmtDate(e.dateObj) || esc(e.date)}</div></div><div class="li-end"><b>${esc(e.amount)}</b></div></div>`).join('')}</div></div>`;
  },
  after() {
    if (!S.expenses.length) return;
    const rows = I.monthly(S.projects, I.lastMonths(6), S.expenses), c = colors();
    mkChart('eChart', { type: 'bar', data: { labels: rows.map(r => r.label), datasets: [
      { label: 'الإيراد', data: rows.map(r => r.revenue), backgroundColor: c.s1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 },
      { label: 'المصروفات', data: rows.map(r => r.expenses), backgroundColor: c.s2, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 },
    ] }, options: baseOpts() });
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
    const tiles = [['tasks', 'المهام', 'list-checks', `${S.tasks.filter(t => !t.done).length} مفتوحة`], ['ads', 'Amazon Ads', 'target', `${S.ads.length} سجل`], ['expenses', 'المصروفات', 'receipt', 'صافي الربح'], ['notes', 'ملاحظاتي', 'notebook-pen', `${S.notes.length} ملاحظة`], ['tools', 'الأدوات والرسائل', 'calculator', 'عروض أسعار ورسائل جاهزة'], ['settings', 'الإعدادات', 'settings', 'الربط والإشعارات'], ['setup', 'دليل الربط والتثبيت', 'book-open-check', 'خطوة بخطوة']];
    return `<div class="more-grid">${tiles.map(([k, l, i, s]) => `<a class="card more-tile" href="#/${k}"><div class="kpi-icon">${ic(i)}</div><b>${l}</b><small>${s}</small></a>`).join('')}</div>`;
  },
};

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
  const vals = item || prefill;
  const clientNames = [...new Set(S.projects.map(p => p.displayName))];
  openSheet({
    title: `${ic(item ? 'pencil' : SHEET_ICONS[sheet])} ${item ? 'تعديل' : 'إضافة'} ${LABELS[sheet]}`,
    body: `<form class="form" id="fForm" onsubmit="return false">${schema.map(f => fieldHTML(f, vals[f.key])).join('')}</form><datalist id="dl-clients">${clientNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      ${!hasRemote() ? `<p class="muted small" style="margin-top:14px">${ic('info')} الأبلكيشن مش مربوط بالشيت لسه — البيانات هتتحفظ على الجهاز ده بس.</p>` : sheet !== 'clients' && !(S.raw[sheet] || []).length ? `<p class="muted small" style="margin-top:14px">${ic('info')} أول مرة تضيف هنا هيتعمل تاب جديد اسمه "${esc({ tasks: 'المهام', expenses: 'المصروفات', ads: 'حملات Amazon Ads', notes: 'ملاحظات وأفكار' }[sheet])}" في نفس الشيت.</p>` : ''}`,
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
  const opts = [['clients', 'عميل / مشروع جديد', 'user-plus', 'يتسجل في شيت ادارة العمل'], ['tasks', 'مهمة', 'square-check', 'بتذكير في ميعادها'], ['expenses', 'مصروف', 'receipt', 'اشتراكات، إعلانات، فريلانسرز'], ['ads', 'سجل حملة Amazon Ads', 'target', 'إنفاق ومبيعات'], ['notes', 'ملاحظة أو فكرة', 'notebook-pen', 'أي حاجة عايز تفتكرها'], ['quote', 'عرض سعر لعميل', 'file-badge', 'يتحسب ويتبعت واتساب']];
  openSheet({
    title: `${ic('plus')} إضافة`,
    body: `<div class="more-grid">${opts.map(([k, l, i, s]) => `<button class="card more-tile" data-q="${k}" style="text-align:right;cursor:pointer"><div class="kpi-icon">${ic(i)}</div><b>${l}</b><small>${s}</small></button>`).join('')}</div>`,
  });
  $$('#sheet [data-q]').forEach(b => b.onclick = () => { const k = b.dataset.q; if (k === 'quote') { closeSheet(); location.hash = '#/tools?t=quote'; } else openForm(k); });
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
  const open = e.target.closest('[data-open]');
  if (open) { openProject(open.dataset.open); return; }
  const edit = e.target.closest('[data-edit]');
  if (edit) { const [sheet, id] = edit.dataset.edit.split(':'); const item = S[sheet].find(x => x.id === id); if (item) openForm(sheet, item); return; }
  const add = e.target.closest('[data-add]');
  if (add) { openForm(add.dataset.add); return; }
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
