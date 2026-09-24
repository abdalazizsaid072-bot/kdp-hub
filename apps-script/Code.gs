/**
 * KDP Hub — الجسر بين الأبلكيشن وشيت "ادارة العمل" على جوجل درايف.
 *
 * طريقة التركيب (مرة واحدة بس):
 *  1) افتح شيت "ادارة العمل" ← من القائمة: Extensions (الإضافات) ← Apps Script
 *  2) امسح أي كود موجود والصق الملف ده كله، وغيّر API_KEY تحت لكلمة سر من اختيارك
 *  3) Deploy ← New deployment ← النوع Web app
 *       Execute as: Me   |   Who has access: Anyone
 *  4) انسخ الرابط اللي بينتهي بـ /exec وحطه في الأبلكيشن (الإعدادات) مع نفس كلمة السر
 *  5) (اختياري) شغّل الدالة setupDailyDigest مرة واحدة عشان يوصلك إيميل ملخص كل صباح
 */

// ⚠️ غيّر دي لكلمة سر خاصة بيك (حروف وأرقام إنجليزي) — ولازم تكتب نفس الكلمة في الأبلكيشن
const API_KEY = 'CHANGE-ME-2026';

// ساعة إرسال الملخص اليومي على الإيميل (بتوقيت الشيت)
const DIGEST_HOUR = 9;

/* ─────────── تعريف الشيتات ─────────── */

// الشيت الأساسي (العملاء) موجود عندك بالفعل — بنتعرف على الأعمدة من أسماء العناوين
const CLIENT_FIELDS = [
  { key: 'amazon',      match: h => h.indexOf('amazon') > -1 || h.indexOf('النشر') > -1 },
  { key: 'status',      match: h => h.indexOf('الحال') === 0 },
  { key: 'date',        match: h => h.indexOf('التاريخ') > -1 },
  { key: 'name',        match: h => h.indexOf('اسم') > -1 },
  { key: 'nationality', match: h => h.indexOf('الجنسي') > -1 },
  { key: 'phone',       match: h => h.indexOf('رقم') > -1 },
  { key: 'project',     match: h => h.indexOf('المشروع') > -1 || h.indexOf('المطلوب') > -1 },
  { key: 'books',       match: h => h.indexOf('الكتب') > -1 },
  { key: 'pages',       match: h => h.indexOf('الصفح') > -1 },
  { key: 'total',       match: h => h.indexOf('الحساب') > -1 },
  { key: 'deposit',     match: h => h.indexOf('العربون') > -1 },
  { key: 'remaining',   match: h => h.indexOf('الباق') > -1 },
  { key: 'deadline',    match: h => h.indexOf('موعد') > -1 },
];

// شيتات إضافية بيعملها الكود تلقائياً أول ما تضيف فيها حاجة من الأبلكيشن
const EXTRA_SHEETS = {
  tasks:    { title: 'المهام',            headers: ['التاريخ', 'المهمة', 'العميل', 'الموعد', 'الأولوية', 'الحالة', 'ملاحظات'],
              keys:    ['date', 'title', 'client', 'due', 'priority', 'status', 'notes'] },
  expenses: { title: 'المصروفات',         headers: ['التاريخ', 'البند', 'الفئة', 'المبلغ', 'ملاحظات', 'النوع (شغل/شخصي)'],
              keys:    ['date', 'title', 'category', 'amount', 'notes', 'kind'] },
  subscriptions: { title: 'الاشتراكات',   headers: ['البرنامج', 'التصنيف', 'السعر', 'العملة', 'التجديد', 'تاريخ الدفع', 'الحالة', 'تاريخ الإلغاء', 'طريقة الدفع', 'ملاحظات'],
              keys:    ['name', 'category', 'price', 'currency', 'cycle', 'start', 'status', 'cancelDate', 'method', 'notes'] },
  installments: { title: 'الأقساط',       headers: ['القسط', 'المبلغ الكلي', 'القسط الشهري', 'عدد الشهور', 'تاريخ أول قسط', 'اتدفع كام قسط', 'آخر شهر اتدفع', 'العملة', 'الحالة', 'ملاحظات'],
              keys:    ['name', 'total', 'monthly', 'months', 'start', 'paidCount', 'lastPaid', 'currency', 'status', 'notes'] },
  otherIncome: { title: 'دخل إضافي',      headers: ['التاريخ', 'المصدر', 'المبلغ', 'العملة', 'ملاحظات'],
              keys:    ['date', 'source', 'amount', 'currency', 'notes'] },
  ads:      { title: 'حملات Amazon Ads',  headers: ['التاريخ', 'الكتاب / العميل', 'الحملة', 'النوع', 'الإنفاق $', 'المبيعات $', 'الطلبات', 'النقرات', 'مرات الظهور', 'ملاحظات'],
              keys:    ['date', 'book', 'campaign', 'type', 'spend', 'sales', 'orders', 'clicks', 'impressions', 'notes'] },
  notes:    { title: 'ملاحظات وأفكار',    headers: ['التاريخ', 'العنوان', 'التصنيف', 'التفاصيل'],
              keys:    ['date', 'title', 'category', 'body'] },
  payments: { title: 'المدفوعات',         headers: ['التاريخ', 'العميل', 'المشروع', 'رقم صف المشروع', 'المبلغ', 'العملة', 'طريقة الدفع', 'صورة التحويل', 'الحالة', 'اتسجل في حساب العميل', 'ملاحظات'],
              keys:    ['date', 'client', 'project', 'projectRow', 'amount', 'currency', 'method', 'receipt', 'status', 'applied', 'notes'] },
  campaigns: { title: 'حملاتي الإعلانية', headers: ['رقم الحملة', 'التاريخ', 'اسم الحملة', 'المنصة', 'الدول', 'تاريخ البداية', 'تاريخ النهاية', 'الميزانية', 'العملة', 'المصروف الفعلي', 'الحالة', 'ملاحظات'],
              keys:    ['id', 'date', 'name', 'platform', 'countries', 'start', 'end', 'budget', 'currency', 'spent', 'status', 'notes'] },
  campaignIncome: { title: 'إيرادات الحملات', headers: ['التاريخ', 'رقم الحملة', 'اسم الحملة', 'العميل', 'الدولة', 'المبلغ', 'العملة', 'ملاحظات'],
              keys:    ['date', 'campaignId', 'campaign', 'client', 'country', 'amount', 'currency', 'notes'] },
};

// اسم الفولدر اللي بتتحفظ فيه صور التحويلات على جوجل درايف (بيتعمل جنب الشيت)
const RECEIPTS_FOLDER = 'KDP Hub - صور التحويلات';

/* ─────────── نقاط الاتصال ─────────── */

function doGet(e) {
  return handle_(function () {
    checkKey_(e.parameter.key);
    if (e.parameter.action === 'file') return readReceipt_(e.parameter.id);
    const out = { ok: true, updated: new Date().toISOString(), clients: readClients_() };
    Object.keys(EXTRA_SHEETS).forEach(function (k) { out[k] = readExtra_(k); });
    return out;
  });
}

function doPost(e) {
  return handle_(function () {
    const body = JSON.parse(e.postData.contents || '{}');
    checkKey_(body.key);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const target = body.sheet === 'clients' ? clientsTarget_() : extraTarget_(body.sheet, true);
      // صورة التحويل بتتحفظ على درايف ولينكها بيتكتب في الشيت
      if (body.file && body.file.b64) {
        body.values = body.values || {};
        body.values.receipt = saveReceipt_(body.file).url;
      }
      const receipt = body.values && body.values.receipt;
      if (body.action === 'add')    return { ok: true, row: addRow_(target, body.values || {}), receipt: receipt };
      if (body.action === 'update') { verifyRow_(target, body.row, body.check); updateRow_(target, body.row, body.values || {}); return { ok: true, receipt: receipt }; }
      if (body.action === 'delete') { verifyRow_(target, body.row, body.check); target.sheet.deleteRow(body.row); return { ok: true }; }
      throw new Error('عملية غير معروفة: ' + body.action);
    } finally {
      lock.releaseLock();
    }
  });
}

function handle_(fn) {
  let result;
  try { result = fn(); } catch (err) { result = { ok: false, error: String(err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey_(key) {
  if (key !== API_KEY) throw new Error('كلمة السر غلط — راجع API_KEY في الكود والإعدادات في الأبلكيشن');
}

/* ─────────── القراءة ─────────── */

function norm_(h) { return String(h).replace(/\s+/g, '').replace(/[\\/]/g, '').toLowerCase(); }

// بيدور على الشيت اللي فيه عنوان "اسم العميل" في أول 10 صفوف
function clientsTarget_() {
  const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (let s = 0; s < sheets.length; s++) {
    const sh = sheets[s];
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const top = sh.getRange(1, 1, Math.min(10, Math.max(sh.getLastRow(), 1)), lastCol).getDisplayValues();
    for (let r = 0; r < top.length; r++) {
      if (top[r].some(function (c) { return norm_(c).indexOf('اسمالعميل') > -1; })) {
        const colMap = {};
        top[r].forEach(function (h, i) {
          const n = norm_(h);
          if (!n) return;
          const f = CLIENT_FIELDS.find(function (f) { return !(f.key in colMap) && f.match(n); });
          if (f) colMap[f.key] = i + 1;
        });
        return { sheet: sh, headerRow: r + 1, colMap: colMap, width: lastCol };
      }
    }
  }
  throw new Error('مش لاقي عمود "اسم العميل" في الشيت');
}

function extraTarget_(name, create) {
  const def = EXTRA_SHEETS[name];
  if (!def) throw new Error('شيت غير معروف: ' + name);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.title);
  if (!sh) {
    if (!create) return null;
    sh = ss.insertSheet(def.title);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold').setBackground('#ede9fe');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  } else if (create && sh.getLastColumn() < def.headers.length) {
    // تاب قديم ناقصه أعمدة جديدة: بنضيف العناوين الناقصة على الشمال بس من غير ما نلمس البيانات
    const have = Math.max(sh.getLastColumn(), 1);
    sh.getRange(1, have + 1, 1, def.headers.length - have).setValues([def.headers.slice(have)]).setFontWeight('bold').setBackground('#ede9fe');
  }
  const colMap = {};
  def.keys.forEach(function (k, i) { colMap[k] = i + 1; });
  return { sheet: sh, headerRow: 1, colMap: colMap, width: def.keys.length };
}

// بيرجع التواريخ بصيغة ISO والباقي زي ما هو ظاهر في الشيت بالظبط
function readRows_(t) {
  const sh = t.sheet;
  const last = sh.getLastRow();
  if (last <= t.headerRow) return [];
  const range = sh.getRange(t.headerRow + 1, 1, last - t.headerRow, t.width);
  const raw = range.getValues();
  const shown = range.getDisplayValues();
  const tz = Session.getScriptTimeZone();
  const rows = [];
  for (let r = 0; r < raw.length; r++) {
    const obj = { _row: t.headerRow + 1 + r };
    let empty = true;
    Object.keys(t.colMap).forEach(function (k) {
      const c = t.colMap[k] - 1;
      const v = raw[r][c];
      obj[k] = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : shown[r][c];
      if (String(obj[k]).trim()) empty = false;
    });
    if (!empty) rows.push(obj);
  }
  return rows;
}

function readClients_() { return readRows_(clientsTarget_()); }
function readExtra_(name) { const t = extraTarget_(name, false); return t ? readRows_(t) : []; }

/* ─────────── الكتابة ─────────── */

function lastDataRow_(t) {
  const sh = t.sheet;
  const last = sh.getLastRow();
  if (last <= t.headerRow) return t.headerRow;
  const vals = sh.getRange(t.headerRow + 1, 1, last - t.headerRow, t.width).getDisplayValues();
  for (let r = vals.length - 1; r >= 0; r--) {
    if (vals[r].some(function (c) { return String(c).trim(); })) return t.headerRow + 1 + r;
  }
  return t.headerRow;
}

function writeCells_(t, row, values) {
  Object.keys(values).forEach(function (k) {
    const col = t.colMap[k];
    if (!col) return;
    const cell = t.sheet.getRange(row, col);
    // التواريخ والأرقام بتتكتب كنص عشان تفضل بنفس شكل الشيت عندك
    cell.setNumberFormat('@');
    cell.setValue(values[k] == null ? '' : String(values[k]));
  });
}

function addRow_(t, values) {
  const row = lastDataRow_(t) + 1;
  if (row > t.sheet.getMaxRows()) t.sheet.insertRowAfter(t.sheet.getMaxRows());
  writeCells_(t, row, values);
  return row;
}

function updateRow_(t, row, values) {
  if (!row || row <= t.headerRow) throw new Error('رقم صف غير صالح');
  writeCells_(t, row, values);
}

// حماية: قبل التعديل أو الحذف بنتأكد إن الصف لسه هو نفس الصف (محدش غيّر ترتيب الشيت)
function verifyRow_(t, row, check) {
  if (!row || row <= t.headerRow) throw new Error('رقم صف غير صالح');
  if (!check) return;
  Object.keys(check).forEach(function (k) {
    const col = t.colMap[k];
    if (!col) return;
    const now = String(t.sheet.getRange(row, col).getDisplayValue()).trim();
    if (now !== String(check[k]).trim()) throw new Error('الشيت اتغير من آخر تحديث — اعمل تحديث وجرب تاني');
  });
}

/* ─────────── صور التحويلات على جوجل درايف ─────────── */

function receiptsFolder_() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('RECEIPTS_FOLDER_ID');
  if (saved) { try { return DriveApp.getFolderById(saved); } catch (err) { /* الفولدر اتمسح — هنعمل واحد جديد */ } }
  const parents = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folder = parent.createFolder(RECEIPTS_FOLDER);
  props.setProperty('RECEIPTS_FOLDER_ID', folder.getId());
  return folder;
}

function saveReceipt_(f) {
  const name = f.name || ('تحويل-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd-HHmmss') + '.jpg');
  const blob = Utilities.newBlob(Utilities.base64Decode(f.b64), f.mime || 'image/jpeg', name);
  const file = receiptsFolder_().createFile(blob);
  return { id: file.getId(), url: file.getUrl() };
}

// الأبلكيشن بيعرض الصورة من هنا — ومسموح بس بملفات فولدر التحويلات
function readReceipt_(id) {
  const file = DriveApp.getFileById(id);
  const folderId = receiptsFolder_().getId();
  const parents = file.getParents();
  let inFolder = false;
  while (parents.hasNext()) if (parents.next().getId() === folderId) inFolder = true;
  if (!inFolder) throw new Error('الملف ده مش من صور التحويلات');
  const blob = file.getBlob();
  return { ok: true, mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) };
}

/* ─────────── ملخص يومي على الإيميل ─────────── */

function setupDailyDigest() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'dailyDigest') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('dailyDigest').timeBased().everyDays(1).atHour(DIGEST_HOUR).create();
  dailyDigest();
}

function money_(s) {
  s = String(s || '').replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).replace(/,/g, '');
  const nums = s.match(/\d+(\.\d+)?/g);
  return nums ? nums.reduce(function (a, b) { return a + Number(b); }, 0) : 0;
}

function parseDay_(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

function dailyDigest() {
  const rows = readClients_();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const soon = [], late = [], waiting = [];
  let receivable = 0;
  rows.forEach(function (r) {
    const st = String(r.status || '') + ' ' + String(r.deadline || '');
    const done = /تم التسليم|منتهي|تم الانتهاء/.test(st);
    const lead = /التفكير/.test(st);
    const rem = /خالص/.test(r.remaining) ? 0 : money_(r.remaining);
    if (!lead && rem > 0) receivable += rem;
    if (/انتظار العربون/.test(st)) waiting.push(r);
    const d = parseDay_(r.deadline);
    if (d && !done) {
      const days = Math.round((d - today) / 86400000);
      if (days < 0) late.push(r.name + ' — متأخر ' + (-days) + ' يوم');
      else if (days <= 2) soon.push(r.name + ' — ' + (days === 0 ? 'النهارده' : 'بعد ' + days + ' يوم'));
    }
  });
  const pendingPays = readExtra_('payments').filter(function (p) { return /انتظار/.test(p.status); });
  const lines = [
    'صباح الخير 👋 ده ملخص شغلك النهارده من KDP Hub:', '',
    '🧾 تحويلات مستنية تأكيدك: ' + (pendingPays.length ? pendingPays.map(function (p) { return p.client + ' (' + p.amount + ' ' + p.currency + ')'; }).join('، ') : 'مفيش'),
    '⏰ تسليمات قريبة: ' + (soon.length ? '\n  • ' + soon.join('\n  • ') : 'مفيش'),
    '🚨 متأخرات: ' + (late.length ? '\n  • ' + late.join('\n  • ') : 'مفيش'),
    '💰 في انتظار العربون: ' + (waiting.length ? waiting.map(function (r) { return r.name; }).join('، ') : 'مفيش'),
    '📊 إجمالي المستحقات عند العملاء: ' + receivable.toLocaleString('en') + ' ج.م تقريباً', '',
    'افتح الأبلكيشن للتفاصيل والتحليلات.',
  ];
  if (!soon.length && !late.length && !waiting.length && !pendingPays.length) return; // مفيش جديد — مش هنزعجك
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'KDP Hub — ملخص اليوم', lines.join('\n'));
}
