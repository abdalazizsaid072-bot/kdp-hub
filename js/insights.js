// التحليلات والأفكار الذكية والتذكيرات — كلها بتتحسب من بيانات الشيت

import { SERVICES, STATUS, monthKey, startOfDay, daysBetween, parseDate, parseMoney, toLatin, whatsappNumber, isoDay, toEGP, PERSONAL_CATS } from './data.js';

export const fmt = n => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n || 0));
export const money = n => `${fmt(n)} ج.م`;
export const pct = n => `${n > 0 ? '+' : ''}${Math.round(n)}%`;
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const monthLabel = key => { const [y, m] = key.split('-').map(Number); return `${AR_MONTHS[m - 1]} ${String(y).slice(2)}`; };
export const monthName = d => AR_MONTHS[d.getMonth()];

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const billable = ps => ps.filter(p => !p.isLead);

export function lastMonths(n, ref = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(ref.getFullYear(), ref.getMonth() - i, 1)));
  return out;
}

/* ─────────── الأرقام الأساسية ─────────── */

export function kpis(projects, expenses = []) {
  const now = new Date();
  const thisKey = monthKey(now), prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const bill = billable(projects);
  const inMonth = k => bill.filter(p => p.date && monthKey(p.date) === k);
  const cur = inMonth(thisKey), prev = inMonth(prevKey);
  const revCur = sum(cur, p => p.totalEGP), revPrev = sum(prev, p => p.totalEGP);

  // وتيرة الشهر الحالي: لو فاضل أيام في الشهر نتوقع الإجمالي بنفس المعدل
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projected = now.getDate() >= 5 ? revCur / now.getDate() * dim : null;

  const expCur = sum(expenses.filter(e => e.kindKey !== 'personal' && e.dateObj && monthKey(e.dateObj) === thisKey), e => e.amountEGP);
  const clientsCount = new Set(bill.map(p => p.clientId)).size;
  const repeat = Object.values(groupBy(bill, p => p.clientId)).filter(g => g.length > 1).length;
  const totalAll = sum(bill, p => p.totalEGP), paidAll = sum(bill, p => p.paidEGP);

  return {
    revCur, revPrev, growth: revPrev ? (revCur - revPrev) / revPrev * 100 : null, projected,
    collectedCur: sum(cur, p => p.paidEGP), countCur: cur.length, countPrev: prev.length,
    receivables: sum(bill, p => p.remainingEGP),
    active: bill.filter(p => !p.isDone).length,
    waiting: bill.filter(p => p.statusKey === 'waiting'),
    leads: projects.filter(p => p.isLead),
    pipelineValue: sum(projects.filter(p => p.isLead || p.statusKey === 'waiting'), p => p.totalEGP),
    avgDeal: bill.length ? totalAll / bill.filter(p => p.totalEGP).length : 0,
    collectionRate: totalAll ? paidAll / totalAll * 100 : 0,
    clientsCount, repeat, repeatRate: clientsCount ? repeat / clientsCount * 100 : 0,
    pages: sum(bill, p => p.pagesN), totalAll, paidAll,
    expCur, netCur: revCur - expCur,
  };
}

export function groupBy(arr, f) {
  return arr.reduce((acc, x) => { const k = f(x); (acc[k] = acc[k] || []).push(x); return acc; }, {});
}

export function monthly(projects, months, expenses = []) {
  const bill = billable(projects).filter(p => p.date);
  return months.map(k => {
    const ps = bill.filter(p => monthKey(p.date) === k);
    return {
      key: k, label: monthLabel(k), count: ps.length,
      revenue: sum(ps, p => p.totalEGP), collected: sum(ps, p => p.paidEGP), remaining: sum(ps, p => p.remainingEGP),
      pages: sum(ps, p => p.pagesN),
      expenses: sum(expenses.filter(e => e.kindKey !== 'personal' && e.dateObj && monthKey(e.dateObj) === k), e => e.amountEGP),
    };
  });
}

export function serviceMix(projects) {
  const out = {};
  billable(projects).forEach(p => {
    const share = p.totalEGP / p.services.length; // الإيراد بيتقسم بالتساوي على الخدمات اللي في المشروع
    p.services.forEach(s => { out[s] = out[s] || { key: s, label: SERVICES[s].label, icon: SERVICES[s].icon, count: 0, revenue: 0 }; out[s].count++; out[s].revenue += share; });
  });
  return Object.values(out).sort((a, b) => b.revenue - a.revenue);
}

export function statusMix(projects) {
  const g = groupBy(projects, p => p.statusKey);
  return Object.keys(STATUS).filter(k => g[k]).map(k => ({ key: k, ...STATUS[k], count: g[k].length, value: sum(g[k], p => p.totalEGP) }));
}

export function topClients(projects, n = 7) {
  return Object.values(groupBy(billable(projects), p => p.clientId))
    .map(g => ({ name: g[0].displayName, count: g.length, revenue: sum(g, p => p.totalEGP), remaining: sum(g, p => p.remainingEGP), sample: g[0] }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, n);
}

export function upcoming(projects) {
  const today = startOfDay();
  return projects.filter(p => p.deadlineDate && !p.isDone && !p.isLead)
    .map(p => ({ p, days: daysBetween(today, p.deadlineDate) }))
    .sort((a, b) => a.days - b.days);
}

/* ─────────── البيانات الإضافية ─────────── */

export function enrichExpense(e, settings) {
  const m = parseMoney(e.amount);
  const rate = m.currency === 'SAR' ? settings.sarRate : m.currency === 'USD' ? settings.usdRate : 1;
  const personal = /شخص/.test(e.kind || '') || (!e.kind && PERSONAL_CATS.includes(e.category));
  return { ...e, sheet: 'expenses', id: 'e' + e._row, dateObj: parseDate(e.date), amountEGP: m.amount * rate, kindKey: personal ? 'personal' : 'work' };
}

/* ─────────── الاشتراكات والأقساط والدخل الإضافي ─────────── */

const dim = (y, m) => new Date(y, m + 1, 0).getDate();
const dayIn = (y, m, day) => new Date(y, m, Math.min(day, dim(y, m)));
const mIndex = d => d.getFullYear() * 12 + d.getMonth();
const keyToDate = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1); };

export function enrichSub(s, settings) {
  const priceN = numOf(s.price), start = parseDate(s.start);
  const cancelled = /ملغ|اتلغى|لغيت|وقف/.test(s.status || ''), cancelDate = parseDate(s.cancelDate);
  const yearly = /سنو/.test(s.cycle || '');
  const priceEGP = toEGP(priceN, s.currency, settings);
  // تاريخ الخصم في شهر معين (أو null لو مفيش خصم فيه)
  const chargeDate = key => {
    if (!start) return null;
    const md = keyToDate(key);
    if (yearly && md.getMonth() !== start.getMonth()) return null;
    const d = dayIn(md.getFullYear(), md.getMonth(), start.getDate());
    if (d < startOfDay(start)) return null;
    if (cancelled && d > (cancelDate || startOfDay())) return null;
    return d;
  };
  let next = null;
  if (start && !cancelled) {
    const t = startOfDay();
    for (let i = 0; i <= 13 && !next; i++) { const k = monthKey(new Date(t.getFullYear(), t.getMonth() + i, 1)); const d = chargeDate(k); if (d && d >= t) next = d; }
  }
  return {
    ...s, sheet: 'subscriptions', id: 's' + s._row, priceN, priceEGP, startDate: start, cancelled, yearly,
    monthlyEGP: cancelled ? 0 : priceEGP / (yearly ? 12 : 1), next, daysToNext: next ? daysBetween(startOfDay(), next) : null,
    chargeIn: key => chargeDate(key) ? priceEGP : 0, chargeDate,
  };
}

export function enrichInstallment(i, settings) {
  const monthlyN = numOf(i.monthly), months = Math.round(numOf(i.months)), start = parseDate(i.start);
  const paidCount = Math.min(Math.round(numOf(i.paidCount)), months || Infinity);
  const monthlyEGP = toEGP(monthlyN, i.currency, settings);
  const total = numOf(i.total) || monthlyN * months;
  const today = startOfDay(), thisKey = monthKey(today);
  const done = /خلص|منته|اتقفل/.test(i.status || '') || (months > 0 && paidCount >= months);
  const inRange = key => start && months > 0 && (() => { const idx = mIndex(keyToDate(key)) - mIndex(start); return idx >= 0 && idx < months; })();
  const paidThisMonth = i.lastPaid === thisKey;
  let nextDue = null;
  if (start && !done) {
    for (let k = 0; k <= 12 && !nextDue; k++) {
      const md = new Date(today.getFullYear(), today.getMonth() + k, 1), key = monthKey(md);
      if (!inRange(key) || (k === 0 && paidThisMonth)) continue;
      nextDue = dayIn(md.getFullYear(), md.getMonth(), start.getDate());
    }
  }
  const end = start && months ? dayIn(start.getFullYear(), start.getMonth() + months - 1, start.getDate()) : null;
  return {
    ...i, sheet: 'installments', id: 'q' + i._row, monthlyN, monthlyEGP, months, paidCount, startDate: start, endDate: end, total,
    remainingN: Math.max(total - paidCount * monthlyN, 0), remainingEGP: toEGP(Math.max(total - paidCount * monthlyN, 0), i.currency, settings),
    done, paidThisMonth, nextDue, daysToDue: nextDue ? daysBetween(today, nextDue) : null,
    dueIn: key => !done || mIndex(keyToDate(key)) <= mIndex(today) ? (inRange(key) ? monthlyEGP : 0) : 0,
  };
}

export function enrichOtherIncome(x, settings) {
  const amountN = numOf(x.amount);
  return { ...x, sheet: 'otherIncome', id: 'o' + x._row, dateObj: parseDate(x.date), amountN, amountEGP: toEGP(amountN, x.currency, settings) };
}

/* ─────────── تقفيل الشهر: دخلت كام وراحت فين ─────────── */

export function monthClose(key, d, mode = 'auto') {
  const md = keyToDate(key), mStart = md, mEnd = new Date(md.getFullYear(), md.getMonth() + 1, 0);
  const inM = dt => dt && monthKey(dt) === key;
  const transfers = d.payments.filter(p => p.statusKey === 'confirmed' && inM(p.dateObj));
  const projects = d.projects.filter(p => !p.isLead && inM(p.date));
  const transfersEGP = transfers.reduce((a, p) => a + p.amountEGP, 0), projectsEGP = projects.reduce((a, p) => a + p.paidEGP, 0);
  const useTransfers = mode === 'transfers' || (mode === 'auto' && transfers.length > 0);
  const clients = useTransfers ? transfersEGP : projectsEGP;
  const fromAds = d.incomes.filter(i => inM(i.dateObj)).reduce((a, i) => a + i.amountEGP, 0);
  const otherItems = d.otherIncome.filter(x => inM(x.dateObj)).map(x => ({ label: x.source || 'دخل', sub: x.notes, amount: x.amountEGP }));
  const other = otherItems.reduce((a, x) => a + x.amount, 0);

  // الإعلانات: صرف كل حملة بيتقسم على الأيام، والشهر ده بياخد نصيبه من الأيام اللي فيه
  const adsItems = d.campaigns.filter(c => c.state !== 'scheduled' && c.spentEGP).map(c => {
    const from = c.startDate > mStart ? c.startDate : mStart, to = c.endDate < mEnd ? c.endDate : mEnd;
    const days = to >= from ? daysBetween(from, to) + 1 : 0;
    return { label: c.name, sub: `${days} من ${c.totalDays} يوم`, amount: c.spentEGP * days / c.totalDays };
  }).filter(x => x.amount > 0);
  const subsItems = d.subs.map(s => {
    const cd = s.chargeDate(key);
    return { label: s.name, sub: cd ? `${cd > startOfDay() ? 'هيتخصم' : 'اتخصم'} ${cd.getDate()}/${cd.getMonth() + 1}` : '', amount: s.chargeIn(key) };
  }).filter(x => x.amount > 0);
  const instItems = d.installments.map(i => ({ label: i.name, sub: i.lastPaid === key ? 'اتدفع' : 'لسه', amount: i.dueIn(key) })).filter(x => x.amount > 0);
  const exps = d.expenses.filter(e => inM(e.dateObj));
  const workItems = exps.filter(e => e.kindKey === 'work').map(e => ({ label: e.title, sub: e.category, amount: e.amountEGP }));
  const personalItems = exps.filter(e => e.kindKey === 'personal').map(e => ({ label: e.title, sub: e.category, amount: e.amountEGP }));
  const tot = arr => arr.reduce((a, x) => a + x.amount, 0);
  const ads = tot(adsItems), subs = tot(subsItems), work = tot(workItems), inst = tot(instItems), personal = tot(personalItems);
  const income = clients + other, spend = ads + subs + work + inst + personal;
  return {
    key, useTransfers, hasTransfers: transfers.length > 0, transfersEGP, projectsEGP, clients, fromAds, other, otherItems, income,
    groups: [
      { key: 'ads', label: 'الإعلانات', icon: 'megaphone', color: '--s2', total: ads, items: adsItems },
      { key: 'subs', label: 'الاشتراكات', icon: 'repeat', color: '--s7', total: subs, items: subsItems },
      { key: 'work', label: 'مصاريف الشغل', icon: 'briefcase', color: '--s1', total: work, items: workItems },
      { key: 'inst', label: 'الأقساط', icon: 'calendar-range', color: '--s4', total: inst, items: instItems },
      { key: 'personal', label: 'مصاريف شخصية', icon: 'user', color: '--s5', total: personal, items: personalItems },
    ],
    spend, left: income - spend, businessProfit: clients + other - ads - subs - work,
    adsReturn: ads ? fromAds / ads : null,
  };
}
export function enrichTask(t) {
  const dueDate = parseDate(t.due);
  const done = /تمت|تم|منته/.test(t.status || '');
  return { ...t, sheet: 'tasks', id: 't' + t._row, dueDate, done, days: dueDate ? daysBetween(startOfDay(), dueDate) : null };
}
export function enrichAd(a) {
  const n = k => Number(toLatin(a[k]).replace(/[^\d.]/g, '')) || 0;
  const spend = n('spend'), sales = n('sales'), clicks = n('clicks'), orders = n('orders'), impressions = n('impressions');
  return {
    ...a, sheet: 'ads', id: 'a' + a._row, dateObj: parseDate(a.date), spend, sales, clicks, orders, impressions,
    acos: sales ? spend / sales * 100 : null, roas: spend ? sales / spend : null,
    cpc: clicks ? spend / clicks : null, ctr: impressions ? clicks / impressions * 100 : null, cvr: clicks ? orders / clicks * 100 : null,
  };
}

/* ─────────── المدفوعات (صور التحويلات) ─────────── */

const numOf = v => Number(toLatin(v).replace(/,/g, '').match(/\d+(\.\d+)?/)?.[0] || 0);

export function enrichPayment(p, settings) {
  const amountN = numOf(p.amount);
  const s = String(p.status || '');
  const statusKey = /مش واصل|مرفوض|رفض/.test(s) ? 'rejected' : /مؤكد|وصلت|تم التأكيد/.test(s) ? 'confirmed' : 'pending';
  return {
    ...p, sheet: 'payments', id: 'p' + p._row, dateObj: parseDate(p.date), amountN,
    amountEGP: toEGP(amountN, p.currency, settings), statusKey, applied: /نعم|تم/.test(p.applied || ''),
    projectRowN: Number(toLatin(p.projectRow)) || null,
  };
}

/* ─────────── حملاتي الإعلانية ─────────── */

export function enrichIncome(x, settings) {
  const amountN = numOf(x.amount);
  return { ...x, sheet: 'campaignIncome', id: 'i' + x._row, dateObj: parseDate(x.date), amountN, amountEGP: toEGP(amountN, x.currency, settings) };
}

export function enrichCampaign(c, incomes, settings) {
  const today = startOfDay();
  const start = parseDate(c.start) || parseDate(c.date) || today;
  const end = parseDate(c.end) || start;
  const total = Math.max(daysBetween(start, end) + 1, 1);
  const elapsed = Math.min(Math.max(daysBetween(start, today) + 1, 0), total);
  const stopped = /موقوف|وقف|اتوقف|ملغ/.test(c.status || '');
  const state = stopped ? 'stopped' : today < start ? 'scheduled' : today > end ? 'ended' : 'active';
  const budgetN = numOf(c.budget), budgetEGP = toEGP(budgetN, c.currency, settings);
  const hasSpent = String(c.spent ?? '').trim() !== '';
  // لو المصروف الفعلي مش متسجل: بنعتبر الميزانية كلها اتصرفت (أحوط، عشان العائد ميطلعش أكبر من الحقيقة)
  const spentN = hasSpent ? numOf(c.spent) : state === 'scheduled' ? 0 : budgetN;
  const spentEGP = toEGP(spentN, c.currency, settings);
  const inc = incomes.filter(i => (c.id && i.campaignId === c.id) || (!i.campaignId && i.campaign === c.name));
  const revenueEGP = inc.reduce((a, i) => a + i.amountEGP, 0);
  const clients = new Set(inc.map(i => i.client).filter(Boolean)).size;
  const byCountry = {};
  inc.forEach(i => { const k = i.country || 'غير محدد'; byCountry[k] = (byCountry[k] || 0) + i.amountEGP; });
  return {
    ...c, sheet: 'campaigns', id: c.id || 'c-row' + c._row, rowId: 'k' + c._row,
    startDate: start, endDate: end, totalDays: total, elapsed, daysLeft: Math.max(daysBetween(today, end), 0), state,
    countriesList: String(c.countries || '').split(/[،,]\s*/).map(s => s.trim()).filter(Boolean),
    budgetN, budgetEGP, spentN, spentEGP, spentEstimated: !hasSpent && state !== 'scheduled',
    incomes: inc.sort((a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0)),
    revenueEGP, profitEGP: revenueEGP - spentEGP, roi: spentEGP ? (revenueEGP - spentEGP) / spentEGP * 100 : null,
    roas: spentEGP ? revenueEGP / spentEGP : null, clients, cpa: clients ? spentEGP / clients : null, byCountry,
  };
}

export const CAMPAIGN_STATE = {
  active:    { label: 'شغالة',   icon: 'radio',        tone: 'good' },
  scheduled: { label: 'مجدولة',  icon: 'calendar-clock', tone: 'info' },
  ended:     { label: 'خلصت',    icon: 'flag',         tone: 'muted' },
  stopped:   { label: 'موقوفة',  icon: 'circle-pause', tone: 'warning' },
};

/* ─────────── محرك الأفكار الذكية ─────────── */
// كل فكرة: { icon, tone: good|warning|critical|info, title, text, action?: {label, href} }

export function insights(projects, k, extras = {}) {
  const out = [];
  const bill = billable(projects);
  const now = new Date();

  if (k.growth != null) {
    if (k.growth >= 10) out.push({ icon: 'rocket', tone: 'good', title: `إيراد ${monthName(now)} زاد ${pct(k.growth)} عن الشهر اللي فات`, text: `وصلت ${money(k.revCur)} مقابل ${money(k.revPrev)}. الزخم ده وقت ممتاز ترفع أسعار الباقات الجديدة 10–15% وتشوف رد فعل السوق.` });
    else if (k.growth <= -10) out.push({ icon: 'trending-down', tone: 'warning', title: `الإيراد أقل ${pct(k.growth)} عن الشهر اللي فات`, text: `لسه فيه وقت تعوّض: كلّم العملاء اللي "قيد التفكير" واعرض عليهم خصم لفترة محدودة، ونزّل بوست بأعمالك الأخيرة (قبل/بعد التنسيق + 3D Mockup).` });
  }
  if (k.projected && k.revPrev && now.getDate() < 25) {
    const diff = (k.projected - k.revPrev) / k.revPrev * 100;
    out.push({ icon: 'gauge', tone: diff >= 0 ? 'good' : 'info', title: `لو كملت بنفس المعدل هتقفل الشهر على ≈ ${money(k.projected)}`, text: diff >= 0 ? `ده أعلى من الشهر اللي فات بحوالي ${pct(diff)}. استمر 👌` : `محتاج تقريباً ${money(k.revPrev - k.revCur)} كمان عشان تعادل الشهر اللي فات — مشروعين نشر كاملين يعملوها.` });
  }

  const late = upcoming(projects).filter(x => x.days < 0);
  if (late.length) out.push({ icon: 'siren', tone: 'critical', title: `${late.length} مشروع عدّى ميعاد تسليمه`, text: late.slice(0, 3).map(x => `${x.p.displayName} (${-x.days} يوم)`).join('، ') + '. ابعت لكل عميل تحديث قصير على الواتساب — التواصل بيحافظ على الثقة حتى لو في تأخير.', action: { label: 'افتح المشاريع', href: '#/projects?f=late' } });

  const owing = bill.filter(p => p.remainingEGP > 0 && p.isDone);
  if (owing.length) out.push({ icon: 'wallet', tone: 'warning', title: `${money(sum(owing, p => p.remainingEGP))} مستحقات على مشاريع اتسلّمت`, text: `${owing.length} عميل استلموا الشغل ولسه عليهم باقي. من الصفحة دي تقدر تبعت تذكير دفع جاهز على الواتساب بضغطة.`, action: { label: 'عرض المستحقات', href: '#/projects?f=owing' } });

  if (k.waiting.length) out.push({ icon: 'hand-coins', tone: 'warning', title: `${k.waiting.length} عميل في انتظار العربون بقيمة ${money(sum(k.waiting, p => p.totalEGP))}`, text: 'حوّلهم لعملاء فعليين: ابعت تذكير ودّي + حدد ميعاد بدء الشغل ("نقدر نبدأ من بكرة لو العربون وصل النهارده") — الميعاد المحدد بيسرّع القرار.', action: { label: 'عرضهم', href: '#/projects?f=waiting' } });

  if (k.leads.length) out.push({ icon: 'hourglass', tone: 'info', title: `${k.leads.length} عميل محتمل "قيد التفكير" — فرصة ${money(sum(k.leads, p => p.totalEGP))}`, text: 'ابعتلهم عينة مجانية: صفحتين منسقين من كتابهم أو Mockup 3D لغلافهم. العينة بتقفل الصفقة أسرع من أي خصم.', action: { label: 'عرضهم', href: '#/projects?f=lead' } });

  const mix = serviceMix(projects);
  if (mix.length) {
    const top = mix[0];
    out.push({ icon: SERVICES[top.key].icon, tone: 'info', title: `"${top.label}" هي أكتر خدمة بتجيب فلوس (${money(top.revenue)})`, text: 'اعمل منها باقة ثابتة باسم واضح وسعر معلن (مثلاً: "باقة النشر الكامل") — الباقات بتقلل وقت التفاوض وبترفع متوسط قيمة العميل.' });
  }

  const publishNoDesign = bill.filter(p => p.services.includes('publish') && !p.services.some(s => ['cover', 'design3d', 'marketing', 'video'].includes(s)));
  if (publishNoDesign.length >= 2) out.push({ icon: 'box', tone: 'good', title: `${publishNoDesign.length} عميل نشر معاك من غير ما ياخدوا تصميمات أو تسويق`, text: `اعرض عليهم إضافة "لانش الكتاب": 3 تصميمات 3D + ريل + إعداد حملة Amazon Ads أولى. لو نص بس وافقوا ≈ ${money(publishNoDesign.length / 2 * 1500)} دخل إضافي.`, action: { label: 'اعمل عرض سعر', href: '#/tools?t=quote' } });

  if (k.clientsCount >= 5) {
    if (k.repeatRate < 25) out.push({ icon: 'repeat', tone: 'info', title: `${Math.round(k.repeatRate)}% بس من عملاءك رجعوا تاني`, text: 'اعمل برنامج ولاء بسيط: خصم 10% على الكتاب التاني، أو خدمة تسويق مجانية لمدة أسبوع بعد النشر. العميل الراجع أرخص 5 مرات من العميل الجديد.' });
    else out.push({ icon: 'heart-handshake', tone: 'good', title: `${Math.round(k.repeatRate)}% من عملاءك رجعوا تاني 👏`, text: 'اطلب من العملاء الراضيين تقييم مكتوب أو فيديو قصير — واستخدمه في إعلاناتك. واطلب ترشيح لمؤلف تاني مقابل خصم.' });
  }

  const tops = topClients(projects, 1)[0];
  if (tops && k.totalAll && tops.revenue / k.totalAll > 0.3) out.push({ icon: 'scale', tone: 'warning', title: `${Math.round(tops.revenue / k.totalAll * 100)}% من دخلك من عميل واحد (${tops.name})`, text: 'ده تركيز عالي — لو العميل وقف هتتأثر جامد. وزّع مجهود التسويق على عملاء جداد الشهر ده.' });

  const gulf = bill.filter(p => p.currency === 'SAR' || /سعود|امارات|إمارات|كويت|قطر/.test(p.nationality));
  if (gulf.length) {
    const avgG = sum(gulf, p => p.totalEGP) / gulf.length;
    out.push({ icon: 'globe-2', tone: 'info', title: `عندك ${gulf.length} مشروع من الخليج (متوسط ${money(avgG)})`, text: 'السوق الخليجي بيدفع بالعملة الصعبة وعنده طلب كبير على النشر بالعربي على أمازون. جرّب إعلان ممول على السعودية والكويت بمحتوى "انشر كتابك على أمازون خلال 10 أيام".' });
  }

  const tr = bill.filter(p => p.services.includes('translate') && p.pagesN > 0 && p.totalEGP > 0);
  if (tr.length >= 2) out.push({ icon: 'languages', tone: 'info', title: `متوسط سعر الصفحة في مشاريع الترجمة ≈ ${fmt(sum(tr, p => p.totalEGP / p.pagesN) / tr.length)} ج.م`, text: 'قارنه بسعرك المعلن في حاسبة عروض الأسعار — لو أقل يبقى بتدي خصومات كتير من غير ما تاخد بالك.' });

  if (extras.ads?.length) {
    const spend = sum(extras.ads, a => a.spend), sales = sum(extras.ads, a => a.sales);
    if (sales) out.push({ icon: 'target', tone: spend / sales < 0.35 ? 'good' : 'warning', title: `ACoS الإجمالي لحملات Amazon Ads: ${Math.round(spend / sales * 100)}%`, text: spend / sales < 0.35 ? 'أداء كويس — زوّد الميزانية على الكلمات اللي بتجيب طلبات وانقلها لحملة Exact.' : 'أعلى من المستهدف: وقّف الكلمات اللي ليها نقرات كتير ومفيش طلبات، وقلّل الـ bid 10–20% على الـ Auto.', action: { label: 'حملات الإعلانات', href: '#/ads' } });
  }

  const camps = extras.campaigns || [];
  camps.filter(c => c.state === 'active' && c.elapsed / c.totalDays >= 0.5 && !c.revenueEGP).forEach(c => out.push({ icon: 'megaphone', tone: 'warning', title: `حملة "${c.name}" عدّت نص مدتها ومفيش إيراد متسجل منها`, text: 'لو جالك عملاء منها سجّلهم. لو مفيش فعلاً: غيّر الإعلان (فيديو قبل/بعد بيشتغل أحسن) أو الاستهداف قبل ما الميزانية تخلص.', action: { label: 'افتح الحملة', href: `#/campaign/${c.rowId}` } }));
  const finished = camps.filter(c => (c.state === 'ended' || c.state === 'stopped') && c.spentEGP).sort((a, b) => a.endDate - b.endDate);
  if (finished.length) {
    const best = [...finished].sort((a, b) => b.roas - a.roas)[0];
    out.push({ icon: 'trophy', tone: best.roas >= 1 ? 'good' : 'warning', title: `أحسن حملة إعلانية ليك: "${best.name}"`, text: `كل 1 جنيه صرفته فيها رجّعلك ${best.roas.toFixed(1)} جنيه (${best.countriesList.join('، ') || 'بدون دول محددة'} — ${best.platform || ''}). كرر نفس الإعلان والاستهداف في الحملة الجاية.`, action: { label: 'حملاتي الإعلانية', href: '#/campaigns' } });
    if (finished.length >= 2) {
      const [prev, last] = finished.slice(-2);
      const g = prev.roas ? (last.roas - prev.roas) / prev.roas * 100 : null;
      if (g != null) out.push({ icon: g >= 0 ? 'trending-up' : 'trending-down', tone: g >= 0 ? 'good' : 'warning', title: `آخر حملة ${g >= 0 ? 'أحسن' : 'أضعف'} من اللي قبلها بـ ${Math.abs(Math.round(g))}%`, text: `"${last.name}" رجّعت ${last.roas.toFixed(1)}x مقابل ${prev.roas.toFixed(1)}x في "${prev.name}". ${g >= 0 ? 'إعلاناتك بتتحسن.' : 'قارن الإعلانين: الدول، الفيديو، والميزانية — وارجع للي كان أحسن.'}` });
    }
  }

  const subs = (extras.subs || []).filter(s => !s.cancelled);
  if (subs.length) {
    const monthly = subs.reduce((a, s) => a + s.monthlyEGP, 0);
    const avgIncome = k.revPrev || k.revCur;
    out.push({ icon: 'repeat', tone: avgIncome && monthly / avgIncome > 0.15 ? 'warning' : 'info', title: `بتدفع ≈ ${money(monthly)} في الشهر على ${subs.length} اشتراك`, text: `يعني ≈ ${money(monthly * 12)} في السنة${avgIncome ? `، وده ${Math.round(monthly / avgIncome * 100)}% من إيراد الشهر` : ''}. راجع الاشتراكات اللي مابتستخدمهاش كل شهر، والاشتراك السنوي غالبًا أرخص للبرامج اللي عمرك ما هتوقفها.`, action: { label: 'الاشتراكات', href: '#/money?t=subs' } });
  }

  const flagged = projects.filter(p => p.flags.length);
  if (flagged.length) out.push({ icon: 'clipboard-check', tone: 'info', title: `${flagged.length} صف في الشيت محتاج مراجعة بيانات`, text: 'زي مشاريع من غير تاريخ أو رقم، أو العربون والباقي صفر. البيانات الدقيقة = تحليلات أدق.', action: { label: 'راجعهم', href: '#/projects?f=flags' } });

  const order = { critical: 0, warning: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

/* ─────────── مكتبة الأفكار ─────────── */

export const IDEA_LIBRARY = [
  { cat: 'تسويق خدماتك', icon: 'megaphone', items: [
    ['محتوى قبل/بعد', 'نزّل كل أسبوع بوست "قبل وبعد التنسيق" لصفحة من كتاب عميل (بعد إذنه). الصورة دي أقوى إعلان لخدمة التنسيق.'],
    ['دليل مجاني', 'اعمل PDF قصير "7 أخطاء بتخلي أمازون يرفض كتابك" واطلب الإيميل أو الواتساب مقابله — قائمة عملاء محتملين جاهزة.'],
    ['لايف أسبوعي', 'لايف 20 دقيقة كل أسبوع تجاوب فيه على أسئلة النشر على أمازون. الناس بتشتري من اللي بيعلمها.'],
    ['قصص نجاح', 'اعرض كتب عملاءك المنشورة فعلاً على أمازون بلينكاتها — الدليل الاجتماعي بيقفل الصفقات.'],
    ['جروبات المؤلفين', 'اتواجد في جروبات الكتّاب والمؤلفين العرب وقدّم نصايح حقيقية من غير بيع مباشر.'],
  ] },
  { cat: 'Amazon KDP', icon: 'book-open', items: [
    ['A+ Content', 'قدّم خدمة تصميم A+ Content لصفحة الكتاب على أمازون — بترفع التحويل وقليل اللي بيقدموها بالعربي.'],
    ['الكلمات المفتاحية', 'أضف خدمة بحث الـ 7 Keywords والتصنيفات (Categories) — بتفرق جداً في ظهور الكتاب.'],
    ['النسخة الورقية Hardcover', 'اعرض على كل عميل نسخة Hardcover بجانب Paperback — شغل إضافي بسيط ودخل إضافي.'],
    ['سلسلة كتب', 'لو العميل عنده أكتر من كتاب، اقترح عليه Series Page على أمازون — بترفع مبيعات كل الكتب.'],
    ['Kindle Unlimited', 'انصح العملاء بـ KDP Select لأول 90 يوم عشان يستفيدوا من صفحات KU والعروض المجانية.'],
  ] },
  { cat: 'Amazon Ads', icon: 'target', items: [
    ['هيكل الحملات', 'ابدأ لكل كتاب بـ 3 حملات: Auto + Keywords (Broad) + Product targeting، وبعد أسبوعين انقل الكلمات الناجحة لحملة Exact.'],
    ['Break-even ACoS', 'احسب ACoS التعادل = الربح لكل نسخة ÷ السعر. أي كلمة فوقه بتخسّر — استخدم حاسبة الإعلانات.'],
    ['الكلمات السلبية', 'كل أسبوع راجع Search Terms وضيف الكلمات اللي ليها نقرات من غير طلبات كـ Negative.'],
    ['باقة إدارة شهرية', 'حوّل إدارة الإعلانات لاشتراك شهري ثابت للعملاء — دخل متكرر بدل مشاريع متقطعة.'],
  ] },
  { cat: 'تصميم 3D وجرافيك', icon: 'box', items: [
    ['Mockups جاهزة', 'جهّز 10 قوالب Mockup 3D (موبايل، تابلت، كتاب ورقي على مكتب) وبيعها كباقة سريعة مع كل غلاف.'],
    ['فيديو إطلاق', 'ريل 15 ثانية لإطلاق الكتاب بـ Mockup 3D متحرك — خدمة سعرها عالي ووقتها قليل بالقوالب.'],
    ['Social Kit', 'باقة 8 تصميمات جرافيك (اقتباسات من الكتاب + كفر للسوشيال) — اعرضها على كل عميل بعد النشر مباشرة.'],
  ] },
  { cat: 'التسعير والباقات', icon: 'badge-dollar-sign', items: [
    ['3 باقات', 'اعرض دايماً 3 باقات (أساسية/احترافية/كاملة) — أغلب العملاء بيختاروا الوسطى، فخليها هي اللي انت عايزها.'],
    ['عربون 50%', 'ثبّت سياسة عربون 50% قبل البدء — الشيت عندك فيه مشاريع بدأت من غير عربون.'],
    ['تسعير الاستعجال', 'أضف +30% على التسليم السريع (أقل من 5 أيام).'],
    ['تسعير بالدولار للخليج', 'للعملاء برّه مصر حط أسعار بالدولار/الريال بدل التحويل من الجنيه.'],
  ] },
  { cat: 'تنظيم الشغل', icon: 'workflow', items: [
    ['Checklist النشر', 'اعمل Checklist ثابتة لكل مشروع نشر (ملفات، غلاف، بيانات الضرايب، الكلمات…) عشان مفيش حاجة تتنسي.'],
    ['قوالب رسائل', 'جهّز رسائل واتساب ثابتة: استلام الملفات، تحديث التقدم، التسليم، طلب التقييم. الأبلكيشن فيه جزء منها.'],
    ['فريلانسرز', 'لما الشغل يزيد، استعين بمترجم فريلانسر وخلي انت على التنسيق والنشر — سجّل تكلفته في المصروفات.'],
  ] },
];

export function ideaOfTheDay(date = new Date()) {
  const all = IDEA_LIBRARY.flatMap(c => c.items.map(i => ({ cat: c.cat, icon: c.icon, title: i[0], text: i[1] })));
  const n = Math.floor(startOfDay(date).getTime() / 864e5);
  return all[n % all.length];
}

/* ─────────── التذكيرات والإشعارات ─────────── */

// بيطلع قايمة تذكيرات لكل يوم من النهارده لحد HORIZON يوم قدام (fireOn = يوم الإشعار)
// الأبلكيشن بيبعت المستحق منها، والـ Service Worker بيقدر يبعتها حتى لو الأبلكيشن مقفول (على Chrome)
export function reminders(projects, tasks, settings, extra = {}, horizon = 7) {
  const out = [];
  const today = startOfDay(), todayIso = isoDay(today);
  const nd = settings.notify;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const within = d => daysBetween(today, d) <= horizon;

  upcoming(projects).forEach(({ p, days }) => {
    const base = { tone: 'warning', href: `#/project/${p.id}`, kind: 'deadline' };
    if (days < 0) {
      out.push({ ...base, id: `late-${p.id}-${p.deadline}-${Math.floor((-days - 1) / 3)}`, fireOn: todayIso, icon: 'siren', tone: 'critical', title: `متأخر: ${p.displayName}`, body: `ميعاد التسليم عدّى من ${-days} يوم — ${short(p.project)}` });
      return;
    }
    for (let k = Math.min(nd.deadlineDays, days); k >= 0; k--) {
      const on = addDays(p.deadlineDate, -k);
      if (on < today || !within(on)) continue;
      out.push({ ...base, id: `due-${p.id}-${p.deadline}-${k}`, fireOn: isoDay(on), icon: 'alarm-clock', title: k === 0 ? `تسليم النهارده: ${p.displayName}` : `تسليم بعد ${k} يوم: ${p.displayName}`, body: short(p.project) });
    }
    const lateOn = addDays(p.deadlineDate, 1);
    if (within(lateOn)) out.push({ ...base, id: `late-${p.id}-${p.deadline}-0`, fireOn: isoDay(lateOn), icon: 'siren', tone: 'critical', title: `متأخر: ${p.displayName}`, body: `ميعاد التسليم كان امبارح — ${short(p.project)}` });
  });

  projects.filter(p => p.statusKey === 'waiting' && p.date).forEach(p => {
    const d = daysBetween(p.date, today);
    const base = { icon: 'hand-coins', tone: 'warning', href: `#/project/${p.id}`, kind: 'deposit', title: `العربون لسه موصلش: ${p.displayName}` };
    if (d >= nd.depositDays) out.push({ ...base, id: `dep-${p.id}-${Math.floor(d / nd.depositDays)}`, fireOn: todayIso, body: `بقاله ${d} يوم — ابعت تذكير ودّي على الواتساب` });
    else { const on = addDays(p.date, nd.depositDays); if (within(on)) out.push({ ...base, id: `dep-${p.id}-1`, fireOn: isoDay(on), body: `بقاله ${nd.depositDays} أيام — ابعت تذكير ودّي على الواتساب` }); }
  });

  if (nd.tasks) tasks.filter(t => !t.done && t.dueDate).forEach(t => {
    const base = { icon: 'square-check', href: '#/tasks', kind: 'task', body: t.client || 'افتح المهام' };
    if (t.days < 0) out.push({ ...base, id: `task-late-${t.id}-${t.due}`, fireOn: todayIso, tone: 'critical', title: `مهمة متأخرة: ${t.title}` });
    else if (t.days <= horizon) out.push({ ...base, id: `task-${t.id}-${t.due}`, fireOn: isoDay(t.dueDate), tone: 'warning', title: `مهمة النهارده: ${t.title}` });
  });

  (extra.payments || []).filter(p => p.statusKey === 'pending').forEach(p => {
    out.push({ id: `pay-${p.id}-${p.amount}`, fireOn: todayIso, kind: 'payment', icon: 'receipt-text', tone: 'warning', href: '#/payments', title: `تحويل مستني تأكيدك: ${p.client || 'عميل'}`, body: `${p.amount} ${p.currency || ''} — ${p.method || ''}. اتأكد إن الفلوس وصلت ودوس تأكيد.` });
  });

  (extra.campaigns || []).filter(c => c.state !== 'stopped').forEach(c => {
    const href = `#/campaign/${c.rowId}`;
    const lastDay = c.endDate, dayAfter = addDays(c.endDate, 1), dayBefore = addDays(c.endDate, -1);
    if (dayBefore >= today && within(dayBefore) && c.totalDays > 1) out.push({ id: `camp-end1-${c.id}-${c.end}`, fireOn: isoDay(dayBefore), kind: 'campaign', icon: 'megaphone', tone: 'info', href, title: `حملة "${c.name}" بتخلص بكرة`, body: 'سجّل الإيرادات اللي جت منها عشان تعرف النتيجة الحقيقية.' });
    if (lastDay >= today && within(lastDay)) out.push({ id: `camp-end0-${c.id}-${c.end}`, fireOn: isoDay(lastDay), kind: 'campaign', icon: 'megaphone', tone: 'info', href, title: `النهارده آخر يوم في حملة "${c.name}"`, body: 'سجّل المصروف الفعلي من مدير الإعلانات والإيرادات اللي جت منها.' });
    if (dayAfter <= today && daysBetween(dayAfter, today) <= 2) out.push({ id: `camp-done-${c.id}-${c.end}`, fireOn: isoDay(dayAfter), kind: 'campaign', icon: 'flag', tone: c.profitEGP >= 0 ? 'good' : 'warning', href, title: `خلصت حملة "${c.name}"`, body: `صرفت ${fmt(c.spentEGP)} ج.م وجبت ${fmt(c.revenueEGP)} ج.م${c.roi != null ? ` (العائد ${pct(c.roi)})` : ''}.` });
  });

  (extra.subs || []).filter(s => s.next && s.daysToNext <= horizon).forEach(s => {
    const money = `${s.price} ${s.currency || ''}`.trim();
    const before = addDays(s.next, -1);
    if (before >= today) out.push({ id: `sub-1-${s.id}-${isoDay(s.next)}`, fireOn: isoDay(before), kind: 'money', icon: 'repeat', tone: 'info', href: '#/money?t=subs', title: `اشتراك ${s.name} هيتجدد بكرة`, body: `${money}. لو مش محتاجه الشهر ده الغيه النهارده.` });
    out.push({ id: `sub-0-${s.id}-${isoDay(s.next)}`, fireOn: isoDay(s.next), kind: 'money', icon: 'repeat', tone: 'info', href: '#/money?t=subs', title: `النهارده تجديد اشتراك ${s.name}`, body: `${money} — اتأكد إن الكارت فيه رصيد.` });
  });

  (extra.installments || []).filter(i => i.nextDue && !i.done).forEach(i => {
    const money = `${i.monthly} ${i.currency || 'جنيه'}`;
    if (i.daysToDue < 0) out.push({ id: `inst-late-${i.id}-${isoDay(i.nextDue)}-${Math.floor(-i.daysToDue / 3)}`, fireOn: todayIso, kind: 'money', icon: 'calendar-x', tone: 'critical', href: '#/money?t=inst', title: `قسط ${i.name} متأخر ${-i.daysToDue} يوم`, body: `${money}. لو دفعته دوس "دفعت" في صفحة الأقساط.` });
    else if (i.daysToDue <= horizon) {
      const before = addDays(i.nextDue, -2);
      if (before >= today) out.push({ id: `inst-2-${i.id}-${isoDay(i.nextDue)}`, fireOn: isoDay(before), kind: 'money', icon: 'calendar-range', tone: 'warning', href: '#/money?t=inst', title: `قسط ${i.name} بعد يومين`, body: money });
      out.push({ id: `inst-0-${i.id}-${isoDay(i.nextDue)}`, fireOn: isoDay(i.nextDue), kind: 'money', icon: 'calendar-range', tone: 'warning', href: '#/money?t=inst', title: `النهارده ميعاد قسط ${i.name}`, body: money });
    }
  });

  // آخر يوم في الشهر: تذكير بتقفيل الشهر
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  if (daysBetween(today, lastDay) <= horizon) out.push({ id: `close-${monthKey(lastDay)}`, fireOn: isoDay(lastDay), kind: 'money', icon: 'calculator', tone: 'info', href: '#/money?t=close', title: `قفّل شهر ${monthName(lastDay)}`, body: 'شوف دخلك كام، وصرفت كام على الإعلانات والاشتراكات والأقساط والمصاريف، وفضلك كام.' });

  if (nd.dailyIdea) for (let i = 0; i <= horizon; i++) {
    const day = addDays(today, i), idea = ideaOfTheDay(day);
    out.push({ id: `idea-${isoDay(day)}`, fireOn: isoDay(day), kind: 'idea', icon: 'lightbulb', tone: 'info', title: `💡 فكرة اليوم: ${idea.title}`, body: idea.text, href: '#/ideas' });
  }
  return out;
}

export const short = (s, n = 60) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

export function waLink(p, kind) {
  const num = whatsappNumber(p);
  const proj = short(p.project, 70);
  const cur = p.currency === 'SAR' ? 'ريال' : 'جنيه';
  const msgs = {
    reminder: `أهلًا بحضرتك،\nبفكّر حضرتك بالمبلغ المتبقي لمشروع (${proj}) وقيمته ${fmt(p.remainingEGP / p.rate)} ${cur}.\nشكرًا لثقتك.`,
    deposit: `أهلًا بحضرتك،\nجاهزين نبدأ في مشروع (${proj}) أول ما المقدم يوصل.\nلو اتحوّل النهارده نقدر نبدأ من بكرة إن شاء الله.`,
    update: `أهلًا بحضرتك،\nتحديث سريع على مشروعك (${proj}): الشغل ماشي كويس، وهبعت لحضرتك المرحلة الجاية قريب إن شاء الله.`,
    delivered: `أهلًا بحضرتك،\nالحمد لله خلصنا مشروعك (${proj}).\nيسعدني جدًا أعرف رأي حضرتك في الشغل، ولو فيه أي كتاب تاني أنا في الخدمة.`,
  };
  return num ? `https://wa.me/${num}?text=${encodeURIComponent(msgs[kind] || '')}` : '';
}
