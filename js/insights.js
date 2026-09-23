// التحليلات والأفكار الذكية والتذكيرات — كلها بتتحسب من بيانات الشيت

import { SERVICES, STATUS, monthKey, startOfDay, daysBetween, parseDate, parseMoney, toLatin, whatsappNumber, isoDay } from './data.js';

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

  const expCur = sum(expenses.filter(e => e.dateObj && monthKey(e.dateObj) === thisKey), e => e.amountEGP);
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
      expenses: sum(expenses.filter(e => e.dateObj && monthKey(e.dateObj) === k), e => e.amountEGP),
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
  return { ...e, sheet: 'expenses', id: 'e' + e._row, dateObj: parseDate(e.date), amountEGP: m.amount * rate };
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
export function reminders(projects, tasks, settings, horizon = 7) {
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
