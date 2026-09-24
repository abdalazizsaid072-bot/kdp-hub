// طبقة البيانات: الإعدادات، الاتصال بالشيت، التخزين المحلي، وفهم بيانات الشيت "زي ما هي مكتوبة"

const LS = {
  get(k, fallback) { try { const v = localStorage.getItem('kdphub.' + k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem('kdphub.' + k, JSON.stringify(v)); } catch { /* تخزين غير متاح */ } },
  del(k) { try { localStorage.removeItem('kdphub.' + k); } catch { /* */ } },
};
export { LS };

/* ─────────── الإعدادات ─────────── */

// من "قائمة الأسعار الرسمية — سبتمبر 2026" (مصر والسعودية). كل الأرقام تتعدل من الإعدادات
export const DEFAULT_PRICES = {
  EG: {
    formatText: 12, formatMedia: 18, proofread: 6, translateEn: 20, translateDe: 30,
    cover: 450, cover2: 250, account: 550, ebook: 400, paper: 600,
    reelMin: 300, poster: 350, marketingMonth: 6000,
    bulk1: 400, bulk4: 360, bulk10: 320, pkgLaunch: 2600, pkgContinue: 2100, pkgPages: 150,
    payment: 'الدفع عن طريق فودافون كاش على رقم الواتساب.',
  },
  SA: {
    formatText: 3, formatMedia: 5, proofread: 2, translateEn: 30, translateDe: 40,
    cover: 350, cover2: 200, account: 250, ebook: 300, paper: 400,
    reelMin: 300, poster: 200, marketingMonth: 1500,
    bulk1: 300, bulk4: 270, bulk10: 240, pkgLaunch: 900, pkgContinue: 700, pkgPages: 150,
    payment: 'التحويل عبر تطبيق برق أو أي تطبيق يدعم التحويل للمحافظ الإلكترونية في مصر، على رقم الواتساب.',
  },
};
export const CURRENCY = { EG: 'جنيه', SA: 'ريال' };

const DEFAULT_SETTINGS = {
  url: '', key: '', userName: '', sarRate: 13.2, usdRate: 50, theme: 'auto',
  notify: { enabled: false, deadlineDays: 2, depositDays: 3, dailyIdea: true, tasks: true },
  prices: DEFAULT_PRICES,
};

export function loadSettings() {
  const s = LS.get('settings', {});
  const { rates, ...rest } = s; // "rates" كانت أسعار تقديرية في النسخة الأولى — اتشالت
  return {
    ...DEFAULT_SETTINGS, ...rest,
    notify: { ...DEFAULT_SETTINGS.notify, ...(s.notify || {}) },
    prices: { EG: { ...DEFAULT_PRICES.EG, ...(s.prices?.EG || {}) }, SA: { ...DEFAULT_PRICES.SA, ...(s.prices?.SA || {}) } },
  };
}
export function saveSettings(s) { LS.set('settings', s); }

/* ─────────── تعريف الحقول (لازم تطابق Code.gs) ─────────── */

export const STATUS_PRESETS = ['قيد التفكير', 'في انتظار العربون', 'قيد العمل', 'تحت التعديل', 'تم التسليم', 'منتهي'];
export const AMAZON_PRESETS = ['إنشاء حساب جديد', 'حساب موجود', 'تم إنشاء الحساب', 'في مراجعة أمازون', 'تم النشر'];

export const SCHEMAS = {
  clients: [
    { key: 'date', label: 'التاريخ', type: 'date', icon: 'calendar' },
    { key: 'name', label: 'اسم العميل', type: 'text', icon: 'user', required: true },
    { key: 'nationality', label: 'الجنسية', type: 'text', icon: 'flag', list: ['مصري', 'سعودي', 'إماراتي', 'كويتي', 'أردني', 'أخرى'] },
    { key: 'phone', label: 'رقم الموبايل / واتساب', type: 'tel', icon: 'phone' },
    { key: 'project', label: 'المشروع / المطلوب', type: 'textarea', icon: 'briefcase', chips: true, full: true },
    { key: 'books', label: 'عدد الكتب', type: 'number', icon: 'library' },
    { key: 'pages', label: 'عدد الصفحات', type: 'number', icon: 'file-text' },
    { key: 'total', label: 'الحساب (الإجمالي)', type: 'money', icon: 'wallet' },
    { key: 'deposit', label: 'العربون / المدفوع', type: 'money', icon: 'hand-coins' },
    { key: 'remaining', label: 'الباقي', type: 'money', icon: 'coins', hint: 'سيبه فاضي ويتحسب لوحده' },
    { key: 'deadline', label: 'موعد التسليم', type: 'date', icon: 'calendar-clock' },
    { key: 'status', label: 'الحالة', type: 'text', icon: 'activity', list: STATUS_PRESETS },
    { key: 'amazon', label: 'حالة الحساب والنشر على Amazon', type: 'text', icon: 'store', list: AMAZON_PRESETS, full: true },
  ],
  tasks: [
    { key: 'title', label: 'المهمة', type: 'text', icon: 'check-square', required: true, full: true },
    { key: 'client', label: 'العميل (اختياري)', type: 'text', icon: 'user', clientList: true },
    { key: 'due', label: 'الموعد', type: 'date', icon: 'alarm-clock' },
    { key: 'priority', label: 'الأولوية', type: 'select', icon: 'flame', options: ['عادية', 'مهمة', 'عاجلة'] },
    { key: 'status', label: 'الحالة', type: 'select', icon: 'activity', options: ['لم تبدأ', 'جارية', 'تمت'] },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', icon: 'sticky-note', full: true },
    { key: 'date', label: 'تاريخ الإضافة', type: 'date', icon: 'calendar', auto: true },
  ],
  expenses: [
    { key: 'kind', label: 'النوع', type: 'select', icon: 'split', options: ['شغل', 'شخصي'] },
    { key: 'date', label: 'التاريخ', type: 'date', icon: 'calendar' },
    { key: 'title', label: 'البند', type: 'text', icon: 'receipt', required: true },
    { key: 'category', label: 'الفئة', type: 'text', icon: 'tag', list: [] },
    { key: 'amount', label: 'المبلغ', type: 'money', icon: 'wallet', required: true, hint: 'اكتب "دولار" أو "ريال" جنب الرقم لو مش بالجنيه' },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', icon: 'sticky-note', full: true },
  ],
  ads: [
    { key: 'date', label: 'التاريخ', type: 'date', icon: 'calendar' },
    { key: 'book', label: 'الكتاب / العميل', type: 'text', icon: 'book', required: true, clientList: true },
    { key: 'campaign', label: 'اسم الحملة', type: 'text', icon: 'megaphone' },
    { key: 'type', label: 'النوع', type: 'select', icon: 'target', options: ['Sponsored Products - Auto', 'Sponsored Products - Keywords', 'Sponsored Products - Product targeting', 'Sponsored Brands', 'Lockscreen / Display'] },
    { key: 'spend', label: 'الإنفاق $', type: 'number', icon: 'dollar-sign' },
    { key: 'sales', label: 'المبيعات $', type: 'number', icon: 'trending-up' },
    { key: 'orders', label: 'الطلبات', type: 'number', icon: 'shopping-cart' },
    { key: 'clicks', label: 'النقرات', type: 'number', icon: 'mouse-pointer-click' },
    { key: 'impressions', label: 'مرات الظهور', type: 'number', icon: 'eye' },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', icon: 'sticky-note', full: true },
  ],
  notes: [
    { key: 'title', label: 'العنوان', type: 'text', icon: 'lightbulb', required: true, full: true },
    { key: 'category', label: 'التصنيف', type: 'text', icon: 'tag', list: ['فكرة تسويق', 'فكرة خدمة جديدة', 'تحسين شغل', 'عميل محتمل', 'عام'] },
    { key: 'body', label: 'التفاصيل', type: 'textarea', icon: 'align-right', full: true },
    { key: 'date', label: 'التاريخ', type: 'date', icon: 'calendar', auto: true },
  ],
};

/* ─────────── المدفوعات والحملات ─────────── */

export const PAY_METHODS = ['فودافون كاش', 'إنستاباي', 'برق', 'تحويل بنكي', 'بايونير', 'كاش', 'أخرى'];
export const MONEY_UNITS = ['جنيه', 'ريال', 'دولار'];
export const PAY_STATUS = { pending: 'في انتظار التأكيد', confirmed: 'مؤكد', rejected: 'مش واصل' };
export const PLATFORMS = ['فيسبوك وإنستجرام', 'تيك توك', 'جوجل', 'سناب شات', 'يوتيوب', 'X (تويتر)', 'أخرى'];
export const COUNTRIES = ['مصر', 'السعودية', 'الإمارات', 'الكويت', 'قطر', 'البحرين', 'عُمان', 'الأردن', 'العراق', 'المغرب', 'الجزائر', 'تونس', 'ليبيا', 'فلسطين', 'لبنان', 'أوروبا', 'أمريكا', 'دول أخرى'];

/* ─────────── الفلوس: مصاريف، اشتراكات، أقساط، دخل ─────────── */

export const WORK_CATS = ['مترجمين / فريلانسرز', 'أدوات وتصميم', 'إنترنت واتصالات', 'إعلانات (غير الحملات)', 'أجهزة وصيانة', 'مصاريف شغل تانية'];
export const PERSONAL_CATS = ['أكل وشرب', 'مواصلات وبنزين', 'بيت وفواتير', 'صحة وعلاج', 'لبس', 'خروج وترفيه', 'أهل وهدايا', 'تعليم وكورسات', 'مصاريف شخصية تانية'];
SCHEMAS.expenses.find(f => f.key === 'category').list = [...WORK_CATS, ...PERSONAL_CATS];
export const INCOME_SOURCES = ['مرتب شغل KDP', 'أرباح كتب على أمازون', 'شغل فريلانس تاني', 'مكافأة / عمولة', 'دخل تاني'];
export const SUB_CATEGORIES = ['تصميم', 'ذكاء اصطناعي', 'صوت وفيديو', 'تخزين وأدوات', 'تعليم', 'ترفيه', 'أخرى'];
// [الاسم، التصنيف] — السعر بتكتبه انت
export const SUB_PRESETS = [['Canva', 'تصميم'], ['ChatGPT', 'ذكاء اصطناعي'], ['Claude', 'ذكاء اصطناعي'], ['Gemini', 'ذكاء اصطناعي'], ['ElevenLabs', 'صوت وفيديو'], ['CapCut', 'صوت وفيديو'], ['YouTube Premium', 'ترفيه'], ['Adobe', 'تصميم'], ['Freepik', 'تصميم'], ['Google One', 'تخزين وأدوات']];

SCHEMAS.subscriptions = [
  { key: 'name', label: 'اسم البرنامج', type: 'text', icon: 'app-window', required: true, list: SUB_PRESETS.map(x => x[0]) },
  { key: 'price', label: 'السعر', type: 'money', icon: 'wallet', required: true },
  { key: 'currency', label: 'العملة', type: 'select', icon: 'banknote', options: MONEY_UNITS },
  { key: 'cycle', label: 'التجديد', type: 'select', icon: 'repeat', options: ['شهري', 'سنوي'] },
  { key: 'start', label: 'آخر مرة دفعت فيها', type: 'date', icon: 'calendar', required: true, hint: 'منه بنحسب ميعاد التجديد الجاي' },
  { key: 'category', label: 'التصنيف', type: 'text', icon: 'tag', list: SUB_CATEGORIES },
  { key: 'method', label: 'طريقة الدفع', type: 'text', icon: 'credit-card', list: ['فيزا', 'ماستركارد', 'فودافون كاش', 'PayPal', 'أخرى'] },
  { key: 'status', label: 'الحالة', type: 'select', icon: 'activity', options: ['شغال', 'ملغي'] },
  { key: 'cancelDate', label: 'تاريخ الإلغاء (لو لغيته)', type: 'date', icon: 'calendar-x' },
  { key: 'notes', label: 'ملاحظات', type: 'textarea', icon: 'sticky-note', full: true },
];
SCHEMAS.installments = [
  { key: 'name', label: 'القسط', type: 'text', icon: 'calendar-range', required: true, list: ['قسط اللابتوب', 'قسط الموبايل', 'قسط العربية', 'جمعية', 'قرض'] },
  { key: 'monthly', label: 'القسط الشهري', type: 'money', icon: 'wallet', required: true },
  { key: 'months', label: 'عدد الشهور', type: 'number', icon: 'hash', required: true },
  { key: 'start', label: 'تاريخ أول قسط', type: 'date', icon: 'calendar', required: true, hint: 'اليوم ده هو ميعاد القسط كل شهر' },
  { key: 'paidCount', label: 'اتدفع كام قسط لحد دلوقتي', type: 'number', icon: 'check-check' },
  { key: 'total', label: 'المبلغ الكلي (اختياري)', type: 'money', icon: 'sigma' },
  { key: 'currency', label: 'العملة', type: 'select', icon: 'banknote', options: MONEY_UNITS },
  { key: 'status', label: 'الحالة', type: 'select', icon: 'activity', options: ['شغال', 'خلص'] },
  { key: 'notes', label: 'ملاحظات', type: 'textarea', icon: 'sticky-note', full: true },
];
SCHEMAS.otherIncome = [
  { key: 'date', label: 'التاريخ', type: 'date', icon: 'calendar' },
  { key: 'source', label: 'المصدر', type: 'text', icon: 'hand-coins', required: true, list: INCOME_SOURCES },
  { key: 'amount', label: 'المبلغ', type: 'money', icon: 'wallet', required: true },
  { key: 'currency', label: 'العملة', type: 'select', icon: 'banknote', options: MONEY_UNITS },
  { key: 'notes', label: 'ملاحظات', type: 'textarea', icon: 'sticky-note', full: true },
];

// تحويل أي مبلغ لجنيه عشان نجمع ونقارن
export function toEGP(amount, unit, settings) {
  const u = String(unit || '');
  if (/ريال|sar/i.test(u)) return amount * (Number(settings.sarRate) || 13);
  if (/دولار|\$|usd/i.test(u)) return amount * (Number(settings.usdRate) || 50);
  return amount;
}

/* ─────────── فهم النصوص ─────────── */

export const toLatin = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

// "200 ريال" / "(500-1700)" / "6,700" / "خالص"
export function parseMoney(raw) {
  const s = toLatin(raw).replace(/,/g, '').trim();
  const nums = s.match(/\d+(\.\d+)?/g);
  return {
    amount: nums ? nums.reduce((a, b) => a + Number(b), 0) : 0,
    has: !!nums,
    paidOff: /خالص|مدفوع بالكامل/.test(s),
    currency: /ريال|sar|ر\.س/i.test(s) ? 'SAR' : /\$|دولار|usd/i.test(s) ? 'USD' : 'EGP',
  };
}

// بيفهم: 2026-09-23 / 23-9-2026 / 23/09/2026 / رقم مسلسل من الإكسل (46164) / "يوم 21-8"
export function parseDate(raw, fallbackYear) {
  const s = toLatin(raw).trim();
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return mk(+m[3], +m[2], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 30000 && n < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5); return mk(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  }
  m = s.match(/(\d{1,2})[-/](\d{1,2})(?![-/\d])/);
  if (m && fallbackYear) return mk(fallbackYear, +m[2], +m[1]);
  return null;
}
function mk(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  return isNaN(dt) ? null : dt;
}

export const isoDay = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
export const sheetDay = d => d ? `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}` : '';
export const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);

export const STATUS = {
  lead:     { label: 'قيد التفكير',        icon: 'hourglass',      tone: 'muted' },
  waiting:  { label: 'في انتظار العربون',  icon: 'hand-coins',     tone: 'warning' },
  new:      { label: 'جديد',               icon: 'sparkles',       tone: 'info' },
  progress: { label: 'قيد العمل',          icon: 'loader',         tone: 'info' },
  revision: { label: 'تحت التعديل',        icon: 'pencil-ruler',   tone: 'serious' },
  done:     { label: 'تم التسليم',         icon: 'badge-check',    tone: 'good' },
};

export function classifyStatus(status, deadline) {
  const s = String(status || ''), d = String(deadline || '');
  if (/تفكير/.test(s)) return 'lead';
  if (/تعديل/.test(s)) return 'revision';
  if (/تم التسليم|منتهي|منتهى|تم الانتهاء|تم النشر|خلص/.test(s)) return 'done';
  if (/العربون/.test(s)) return 'waiting';
  if (/قيد العمل|جار|جاى|جاري|انتظار|شغال/.test(s)) return 'progress';
  if (/تم التسليم/.test(d)) return 'done';
  if (/قيد العمل|جار/.test(d)) return 'progress';
  return s.trim() ? 'progress' : 'new';
}

export const SERVICES = {
  translate: { label: 'ترجمة',           icon: 'languages',      re: /ترجم|ترحم|translat/i },
  format:    { label: 'تنسيق وتجهيز',    icon: 'align-justify',  re: /تنسيق|تجهيز|format/i },
  publish:   { label: 'حساب KDP ونشر',   icon: 'upload-cloud',   re: /نشر|حساب|kdp|كيندل|kindle/i },
  cover:     { label: 'تصميم غلاف',      icon: 'book-image',     re: /غلاف|كفر|cover/i },
  design3d:  { label: 'تصميمات 3D',      icon: 'box',            re: /3d|ثري ?دي|ثلاثي/i },
  marketing: { label: 'تسويق وإعلانات',  icon: 'megaphone',      re: /تسويق|خطة|اعلان|إعلان|ads/i },
  video:     { label: 'فيديو وريلز',     icon: 'clapperboard',   re: /فيديو|فديو|ريلز|reels?/i },
  audio:     { label: 'كتاب صوتي',       icon: 'headphones',     re: /صوت|audio/i },
  graphic:   { label: 'جرافيك ديزاين',   icon: 'palette',        re: /تصميم|تصميمات|جرافيك|graphic/i },
};

export function classifyServices(text) {
  const t = String(text || '');
  const out = Object.keys(SERVICES).filter(k => k !== 'graphic' && SERVICES[k].re?.test(t));
  if (/جرافيك|graphic/i.test(t) || (SERVICES.graphic.re.test(t) && !out.some(k => ['cover', 'design3d', 'video'].includes(k)))) out.push('graphic');
  return out.length ? out : ['other'];
}
SERVICES.other = { label: 'أخرى', icon: 'shapes' };

export function normPhone(raw) {
  let d = toLatin(raw).replace(/\D/g, '');
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = d.slice(2);
  return d.replace(/^0+/, '');
}
export function whatsappNumber(p) {
  const d = normPhone(p.phone);
  if (!d) return '';
  if (d.length >= 11 && !/^1\d{9}$/.test(d)) return d;       // فيه كود دولة (مثلاً 966...)
  if (/^5\d{8}$/.test(d) && /سعود/.test(p.nationality)) return '966' + d;
  return '20' + d;                                            // رقم مصري
}
export const cleanName = n => String(n || '').replace(/^\s*\d+\s*[-–.]\s*/, '').replace(/\s+\d+\s*$/, '').replace(/[⁠‏‎]/g, '').replace(/المنهدس/g, 'المهندس').trim();

/* ─────────── تحويل صف الشيت لمشروع مفهوم ─────────── */

export function enrichClient(row, settings) {
  const date = parseDate(row.date);
  const deadlineDate = parseDate(row.deadline, (date || new Date()).getFullYear());
  const total = parseMoney(row.total), dep = parseMoney(row.deposit), rem = parseMoney(row.remaining);
  const currency = [total, dep, rem].find(x => x.currency !== 'EGP')?.currency || 'EGP';
  const rate = currency === 'SAR' ? Number(settings.sarRate) || 13 : currency === 'USD' ? Number(settings.usdRate) || 50 : 1;

  let paid, remaining;
  if (rem.paidOff || dep.paidOff) { paid = total.amount; remaining = 0; }
  else if (rem.has) { remaining = rem.amount; paid = dep.has ? dep.amount : Math.max(total.amount - rem.amount, 0); if (dep.amount === 0 && rem.amount === 0) paid = total.amount; }
  else { paid = dep.amount; remaining = Math.max(total.amount - dep.amount, 0); }

  const statusKey = classifyStatus(row.status, row.deadline);
  const services = classifyServices(row.project);
  const phone = normPhone(row.phone);
  const flags = [];
  if (!date) flags.push('مفيش تاريخ');
  if (!phone) flags.push('مفيش رقم');
  if (!total.amount && statusKey !== 'lead') flags.push('مفيش سعر');
  if (total.amount && dep.has && rem.has && dep.amount === 0 && rem.amount === 0 && statusKey !== 'done') flags.push('العربون والباقي صفر');

  return {
    ...row, sheet: 'clients', id: 'c' + row._row,
    date, deadlineDate, statusKey, services, currency, rate,
    clientId: phone || cleanName(row.name),
    displayName: cleanName(row.name) || 'بدون اسم',
    totalEGP: total.amount * rate, paidEGP: Math.min(paid, total.amount || paid) * rate, remainingEGP: remaining * rate,
    totalRaw: total.amount, pagesN: Number(toLatin(row.pages).replace(/\D/g, '')) || 0,
    booksN: Number(toLatin(row.books).replace(/\D/g, '')) || 0,
    isLead: statusKey === 'lead', isDone: statusKey === 'done',
    flags,
  };
}

/* ─────────── الاتصال بـ Apps Script ─────────── */

export async function fetchRemote(settings) {
  const u = new URL(settings.url);
  u.searchParams.set('key', settings.key);
  u.searchParams.set('t', Date.now());
  const res = await fetch(u.toString(), { redirect: 'follow' });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'خطأ من الشيت');
  return json;
}

// صورة تحويل محفوظة على درايف (بترجع base64)
export async function fetchReceipt(settings, id) {
  const u = new URL(settings.url);
  u.searchParams.set('key', settings.key);
  u.searchParams.set('action', 'file');
  u.searchParams.set('id', id);
  const res = await fetch(u.toString(), { redirect: 'follow' });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'مش قادر أجيب الصورة');
  return `data:${json.mime};base64,${json.b64}`;
}

export async function postRemote(settings, payload) {
  const res = await fetch(settings.url, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // بيتفادى CORS preflight
    body: JSON.stringify({ key: settings.key, ...payload }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'خطأ من الشيت');
  return json;
}

/* ─────────── بيانات تجريبية (أسماء وهمية) لحد ما تربط الشيت ─────────── */

export function demoData() {
  const y = new Date().getFullYear(), m = new Date().getMonth();
  const d = (mo, day) => sheetDay(new Date(y, m - mo, day));
  const rows = [
    [5, 4, 'أحمد سمير', 'مصري', '01000000001', 'تنسيق نسختين (إنجليزي وألماني)', '', '', '2200', '2200', 'خالص', 'تم التسليم', 'منتهي'],
    [5, 12, 'منى عادل', 'مصري', '01000000002', 'ترجمة كتابين (إنجليزي - ألماني)', '2', '', '2300', '1150', '1150', 'تم التسليم', 'تحت التعديل'],
    [4, 3, 'م. خالد العتيبي', 'سعودي', '966500000003', 'إنشاء حساب على الكيندل ونشر كتاب بالنسخة العربية', '1', '', '200 ريال', '100 ريال', '100 ريال', '', 'قيد العمل'],
    [4, 20, 'حسام فؤاد', 'مصري', '01000000004', 'ترجمة كتاب وإنشاء الحساب والنشر على الكيندل', '1', '180', '2800', '1400', '1400', '', 'منتهي'],
    [3, 8, 'ياسر حسن', 'مصري', '01000000005', 'تنسيق نسخة عربية إلكتروني وترجمة إنجليزي إلكتروني وورقي', '1', '140', '1500', '750', '750', 'تم التسليم', 'منتهي'],
    [3, 26, 'أحمد سمير', 'مصري', '01000000001', 'خطة تسويق للكتاب على السوشيال ميديا وعلى أمازون', '', '', '3200', '1500', '1700', '', 'جاري العمل'],
    [2, 5, 'عمر أشرف', 'مصري', '01000000006', 'تصميم فيديو - تصميم ريلز', '', '', '800', '800', '0', 'تم التسليم', 'تم الانتهاء'],
    [2, 18, 'نبيل سالم', 'مصري', '01000000007', 'تصميم غلاف', '', '', '300', '150', '150', '', 'جاري العمل'],
    [2, 22, 'سعد فودة', 'مصري', '01000000008', 'إنشاء حساب - تجهيز نسخة (Ebook - Paperback) ونشرها وتصميم غلاف', '', '250', '5000', '0', '0', '', 'قيد التفكير'],
    [1, 2, 'عمر أشرف', 'مصري', '01000000006', '2 تصميم 3D للكتاب', '', '', '400', '400', '0', 'تم التسليم', 'تم الانتهاء'],
    [1, 9, 'محمود كمال', 'مصري', '01000000009', 'تجهيز ونشر وإنشاء حساب (كتابين عربي ومطلوب ترجمة إنجليزي)', '2', '', '2600', '1300', '1300', '', 'قيد العمل'],
    [1, 14, 'ناجي عوض', 'مصري', '01000000010', 'ترجمة وتنسيق وإنشاء حساب والنشر', '1', '160', '6700', '2000', '4700', '', 'قيد العمل'],
    [0, 2, 'د. أحمد لامي', 'مصري', '01000000011', 'تجهيز ونشر كتاب إنجليزي جزئين (إلكتروني + ورقي) وإنشاء حساب KDP', '2', '671', '4200', '2100', '2100', sheetDay(new Date(y, m, new Date().getDate() + 2)), 'قيد العمل - في انتظار ملفات Word', 'إنشاء حساب جديد'],
    [0, 5, 'محمد سعيد', 'مصري', '01000000012', 'تنسيق ونشر نسختين (إنجليزي إلكتروني وورقي + عربي إلكتروني) وإنشاء حساب KDP', '2', '384', '6200', '0', '6200', sheetDay(new Date(y, m, new Date().getDate() + 5)), 'في انتظار العربون 3100', 'إنشاء حساب جديد'],
    [0, 8, 'أكاديمية فِت', 'مصري', '01000000013', 'تجهيز مجموعة كتب برامج تدريب رياضية + إنشاء حساب KDP + نشر إلكتروني وورقي', '', '420', '7060', '3530', '3530', sheetDay(new Date(y, m, new Date().getDate() - 1)), 'قيد العمل', 'إنشاء حساب جديد'],
  ];
  const clients = rows.map((r, i) => ({
    _row: i + 3, date: d(r[0], r[1]), name: r[2], nationality: r[3], phone: r[4], project: r[5], books: r[6], pages: r[7],
    total: r[8], deposit: r[9], remaining: r[10], deadline: r[11] || '', status: r[12], amazon: r[13] || '',
  }));
  return {
    ok: true, demo: true, updated: new Date().toISOString(), clients,
    tasks: [
      { _row: 2, date: d(0, 1), title: 'متابعة ملفات Word مع د. أحمد', client: 'د. أحمد لامي', due: sheetDay(new Date()), priority: 'عاجلة', status: 'جارية', notes: '' },
      { _row: 3, date: d(0, 3), title: 'تصميم 3 Mockups 3D لإعلانات سعد', client: 'سعد فودة', due: sheetDay(new Date(Date.now() + 3 * 864e5)), priority: 'مهمة', status: 'لم تبدأ', notes: '' },
    ],
    expenses: [
      { _row: 2, date: d(1, 12), title: 'مترجم فريلانسر (فصلين)', category: 'مترجمين / فريلانسرز', amount: '1500', notes: '', kind: 'شغل' },
      { _row: 3, date: d(0, 3), title: 'باقة إنترنت البيت', category: 'إنترنت واتصالات', amount: '450', notes: '', kind: 'شغل' },
      { _row: 4, date: d(0, 5), title: 'مشتريات البيت', category: 'بيت وفواتير', amount: '2200', notes: '', kind: 'شخصي' },
      { _row: 5, date: d(0, 9), title: 'مواصلات الشهر', category: 'مواصلات وبنزين', amount: '800', notes: '', kind: 'شخصي' },
      { _row: 6, date: d(1, 7), title: 'مشتريات البيت', category: 'بيت وفواتير', amount: '2000', notes: '', kind: 'شخصي' },
    ],
    subscriptions: [
      { _row: 2, name: 'Canva', category: 'تصميم', price: '15', currency: 'دولار', cycle: 'شهري', start: sheetDay(new Date(y, m - 3, 20)), status: 'شغال', cancelDate: '', method: 'فيزا', notes: '' },
      { _row: 3, name: 'ChatGPT', category: 'ذكاء اصطناعي', price: '20', currency: 'دولار', cycle: 'شهري', start: sheetDay(new Date(y, m - 2, 5)), status: 'شغال', cancelDate: '', method: 'فيزا', notes: '' },
      { _row: 4, name: 'ElevenLabs', category: 'صوت وفيديو', price: '5', currency: 'دولار', cycle: 'شهري', start: sheetDay(new Date(y, m - 1, new Date().getDate() + 2)), status: 'شغال', cancelDate: '', method: 'فيزا', notes: '' },
    ],
    installments: [
      { _row: 2, name: 'قسط اللابتوب', total: '36000', monthly: '3000', months: '12', start: sheetDay(new Date(y, m - 4, 10)), paidCount: '4', lastPaid: '', currency: 'جنيه', status: '', notes: '' },
    ],
    otherIncome: [
      { _row: 2, date: d(1, 28), source: 'مرتب شغل KDP', amount: '6000', currency: 'جنيه', notes: '' },
      { _row: 3, date: d(0, 1), source: 'مرتب شغل KDP', amount: '6000', currency: 'جنيه', notes: '' },
    ],
    ads: [
      { _row: 2, date: d(1, 10), book: 'حسام فؤاد', campaign: 'Auto - Launch', type: 'Sponsored Products - Auto', spend: '42', sales: '96', orders: '12', clicks: '160', impressions: '38000', notes: '' },
      { _row: 3, date: d(0, 3), book: 'حسام فؤاد', campaign: 'Exact keywords', type: 'Sponsored Products - Keywords', spend: '30', sales: '118', orders: '15', clicks: '95', impressions: '14000', notes: '' },
    ],
    notes: [],
    payments: [
      { _row: 2, date: d(0, 8), client: 'د. أحمد لامي', project: 'تجهيز ونشر كتاب إنجليزي جزئين', projectRow: '15', amount: '2100', currency: 'جنيه', method: 'فودافون كاش', receipt: '', status: 'مؤكد', applied: 'نعم', notes: '' },
      { _row: 3, date: sheetDay(new Date()), client: 'محمد سعيد', project: 'تنسيق ونشر نسختين', projectRow: '16', amount: '3100', currency: 'جنيه', method: 'إنستاباي', receipt: '', status: 'في انتظار التأكيد', applied: '', notes: 'بعت صورة التحويل على الواتساب' },
    ],
    campaigns: [
      { _row: 2, id: 'CDEMO1', date: d(2, 1), name: 'حملة خدمات النشر — أغسطس', platform: 'فيسبوك وإنستجرام', countries: 'مصر، السعودية', start: d(2, 1), end: d(2, 15), budget: '1000', currency: 'جنيه', spent: '1000', status: '', notes: 'فيديو قبل وبعد التنسيق' },
      { _row: 3, id: 'CDEMO2', date: d(1, 1), name: 'حملة الترجمة والنشر', platform: 'فيسبوك وإنستجرام', countries: 'مصر، الإمارات، الكويت', start: d(1, 1), end: d(1, 28), budget: '1500', currency: 'جنيه', spent: '1450', status: '', notes: '' },
      { _row: 4, id: 'CDEMO3', date: d(0, 1), name: 'حملة الخليج — سبتمبر', platform: 'فيسبوك وإنستجرام', countries: 'السعودية، الإمارات، الكويت، قطر', start: sheetDay(new Date(y, m, new Date().getDate() - 6)), end: sheetDay(new Date(y, m, new Date().getDate() + 8)), budget: '60', currency: 'دولار', spent: '', status: '', notes: 'استهداف مؤلفين وكتّاب' },
    ],
    campaignIncome: [
      { _row: 2, date: d(2, 5), campaignId: 'CDEMO1', campaign: 'حملة خدمات النشر — أغسطس', client: 'عمر أشرف', country: 'مصر', amount: '800', currency: 'جنيه', notes: '' },
      { _row: 3, date: d(2, 9), campaignId: 'CDEMO1', campaign: 'حملة خدمات النشر — أغسطس', client: 'سعد فودة', country: 'مصر', amount: '2500', currency: 'جنيه', notes: 'مقدم' },
      { _row: 4, date: d(1, 6), campaignId: 'CDEMO2', campaign: 'حملة الترجمة والنشر', client: 'ناجي عوض', country: 'مصر', amount: '6700', currency: 'جنيه', notes: '' },
      { _row: 5, date: d(0, 2), campaignId: 'CDEMO3', campaign: 'حملة الخليج — سبتمبر', client: 'م. خالد العتيبي', country: 'السعودية', amount: '200', currency: 'ريال', notes: '' },
    ],
  };
}
