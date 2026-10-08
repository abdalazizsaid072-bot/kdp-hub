/**
 * KDP Hub — الجسر بين الأبلكيشن وشيت "ادارة العمل" على جوجل درايف.   (نسخة الكود: 5)
 *
 * النسخة دي "عامة": أي قسم جديد في الأبلكيشن بيعمل التاب بتاعه في الشيت لوحده،
 * فمش هتحتاج تحدّث الكود ده تاني مع أي إضافة جديدة.
 *
 * طريقة التركيب أو التحديث:
 *  1) افتح شيت "ادارة العمل" ← الإضافات (Extensions) ← Apps Script
 *  2) امسح الكود الموجود والصق الملف ده كله، واكتب كلمة السر بتاعتك في السطر اللي تحت
 *  3) أول مرة: نشر ← عملية نشر جديدة ← تطبيق ويب | التنفيذ بصفتك: أنا | الوصول: أي شخص
 *     تحديث: نشر ← إدارة عمليات النشر ← ✏️ ← الإصدار: إصدار جديد ← نشر
 *  4) (اختياري) شغّل الدالة setupDailyDigest مرة واحدة عشان يوصلك إيميل ملخص كل صباح
 *
 * بعد أول تشغيل، كلمة السر بتتحفظ جوه المشروع، فلو لصقت الكود تاني بعدين
 * ونسيت تكتبها هيفضل شغال بالكلمة المحفوظة.
 */

// ⚠️ اكتب هنا كلمة السر بتاعتك (حروف وأرقام إنجليزي) — نفس الكلمة اللي في الأبلكيشن
const API_KEY = 'CHANGE-ME-2026';

const CODE_VERSION = 5;
const DIGEST_HOUR = 9; // ساعة إرسال الملخص اليومي على الإيميل
const RECEIPTS_FOLDER = 'KDP Hub - صور التحويلات'; // فولدر صور التحويلات على درايف (بيتعمل جنب الشيت)
const PLACEHOLDER = 'CHANGE-ME-2026';

/* ─────────── الشيت الأساسي (العملاء) ─────────── */

// بنتعرف على الأعمدة من أسماء العناوين، فترتيب الأعمدة عندك مش مهم
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
  { key: 'images',      match: h => h.indexOf('صور') > -1 }, // عمود "الصور": بيتحط فيه لينك صورة كل تحويل
];

/* ─────────── نقاط الاتصال ─────────── */

function doGet(e) {
  return handle_(function () {
    checkKey_(e.parameter.key);
    if (e.parameter.action === 'file') return readReceipt_(e.parameter.id);
    const clients = clientsTarget_();
    return { ok: true, version: CODE_VERSION, updated: new Date().toISOString(), clients: readRows_(clients), tabs: readAllTabs_(clients.sheet.getSheetId()) };
  });
}

function doPost(e) {
  return handle_(function () {
    const body = JSON.parse(e.postData.contents || '{}');
    checkKey_(body.key);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const target = body.sheet === 'clients' ? clientsTarget_() : tabTarget_(body.def, true);
      body.values = body.values || {};
      // صورة التحويل بتتحفظ على درايف، ولينكها بيتكتب في التاب وفي عمود "الصور" بتاع العميل
      if (body.file && body.file.b64) {
        const saved = saveReceipt_(body.file);
        body.values.receipt = saved.url;
        if (body.link && body.link.row) linkReceiptToClient_(body.link.row, body.link.check, saved.url);
      }
      const receipt = body.values.receipt;
      if (body.action === 'add')    return { ok: true, version: CODE_VERSION, row: addRow_(target, body.values), receipt: receipt };
      if (body.action === 'update') { verifyRow_(target, body.row, body.check); updateRow_(target, body.row, body.values); return { ok: true, version: CODE_VERSION, receipt: receipt }; }
      if (body.action === 'delete') { verifyRow_(target, body.row, body.check); target.sheet.deleteRow(body.row); return { ok: true, version: CODE_VERSION }; }
      throw new Error('عملية غير معروفة: ' + body.action);
    } finally {
      lock.releaseLock();
    }
  });
}

function handle_(fn) {
  let result;
  try { result = fn(); } catch (err) { result = { ok: false, version: CODE_VERSION, error: String(err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// كلمة السر بتتحفظ في خصائص المشروع أول مرة، عشان أي لصق للكود بعد كده ميحتاجش تكتبها تاني
function apiKey_() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('API_KEY');
  if (API_KEY && API_KEY !== PLACEHOLDER && API_KEY !== saved) { props.setProperty('API_KEY', API_KEY); return API_KEY; }
  return saved || API_KEY;
}

function checkKey_(key) {
  const k = apiKey_();
  if (!k || k === PLACEHOLDER) throw new Error('لسه مكتبتش كلمة السر في كود الشيت (السطر بتاع API_KEY)');
  if (key !== k) throw new Error('كلمة السر غلط — لازم تكون نفس الكلمة اللي في كود الشيت');
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
          const f = CLIENT_FIELDS.find(function (x) { return !(x.key in colMap) && x.match(n); });
          if (f) colMap[f.key] = i + 1;
        });
        return { sheet: sh, headerRow: r + 1, colMap: colMap, width: lastCol };
      }
    }
  }
  throw new Error('مش لاقي عمود "اسم العميل" في الشيت');
}

// أي تاب تاني: العناوين في الصف الأول، والأبلكيشن هو اللي بيعرف أنهي عنوان يعني إيه
function tabTarget_(def, create) {
  if (!def || !def.title || !def.headers || !def.keys) throw new Error('بيانات التاب ناقصة — اقفل الأبلكيشن وافتحه تاني');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.title);
  if (!sh) {
    if (!create) return null;
    sh = ss.insertSheet(def.title);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold').setBackground('#ede9fe');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  while (have.length && !have[have.length - 1]) have.pop();
  const colMap = {};
  def.keys.forEach(function (k, i) {
    const title = String(def.headers[i]).trim();
    let idx = have.indexOf(title);
    if (idx === -1) {
      // عنوان جديد مش موجود في التاب: بنضيفه في آخر الأعمدة من غير ما نلمس البيانات
      idx = have.length;
      have.push(title);
      sh.getRange(1, idx + 1).setValue(title).setFontWeight('bold').setBackground('#ede9fe');
    }
    colMap[k] = idx + 1;
  });
  return { sheet: sh, headerRow: 1, colMap: colMap, width: have.length };
}

function cellValue_(v, shown, tz) {
  return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : shown;
}

// العملاء: بيرجعوا بأسماء الخانات (name, total, ...)
function readRows_(t) {
  const sh = t.sheet;
  const last = sh.getLastRow();
  if (last <= t.headerRow) return [];
  const range = sh.getRange(t.headerRow + 1, 1, last - t.headerRow, t.width);
  const raw = range.getValues(), shown = range.getDisplayValues();
  const tz = Session.getScriptTimeZone();
  const rows = [];
  for (let r = 0; r < raw.length; r++) {
    const obj = { _row: t.headerRow + 1 + r };
    let empty = true;
    Object.keys(t.colMap).forEach(function (k) {
      const c = t.colMap[k] - 1;
      obj[k] = cellValue_(raw[r][c], shown[r][c], tz);
      if (String(obj[k]).trim()) empty = false;
    });
    if (!empty) rows.push(obj);
  }
  return rows;
}

// باقي التابات: بترجع العناوين والصفوف زي ما هي، والأبلكيشن بيفهمها
function readAllTabs_(skipId) {
  const out = {};
  const tz = Session.getScriptTimeZone();
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sh) {
    if (sh.getSheetId() === skipId) return;
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return;
    const range = sh.getRange(1, 1, lastRow, lastCol);
    const raw = range.getValues(), shown = range.getDisplayValues();
    const headers = shown[0].map(function (h) { return String(h).trim(); });
    const rows = [];
    for (let r = 1; r < raw.length; r++) {
      const cells = raw[r].map(function (v, c) { return cellValue_(v, shown[r][c], tz); });
      if (cells.some(function (c) { return String(c).trim(); })) rows.push({ _row: r + 1, cells: cells });
    }
    out[sh.getName()] = { headers: headers, rows: rows };
  });
  return out;
}

/* ─────────── الكتابة ─────────── */

function lastDataRow_(t) {
  const sh = t.sheet;
  const last = sh.getLastRow();
  if (last <= t.headerRow) return t.headerRow;
  const vals = sh.getRange(t.headerRow + 1, 1, last - t.headerRow, Math.max(t.width, 1)).getDisplayValues();
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

// لينك الصورة بيتضاف لعمود "الصور" في صف العميل (لو العمود موجود)
function linkReceiptToClient_(row, check, url) {
  try {
    const t = clientsTarget_();
    if (!t.colMap.images) return;
    verifyRow_(t, row, check);
    const cell = t.sheet.getRange(row, t.colMap.images);
    const cur = String(cell.getValue() || '').trim();
    cell.setValue(cur ? cur + '\n' + url : url);
  } catch (err) { /* لو الصف اتغير مش هنوقف حفظ التحويل */ }
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

// صفوف تاب كـ { "العنوان": "القيمة" }
function tabObjects_(title) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(title);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const h = vals[0].map(function (x) { return String(x).trim(); });
  return vals.slice(1).map(function (r) { const o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; });
}

function dailyDigest() {
  const rows = readRows_(clientsTarget_());
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
  const pendingPays = tabObjects_('المدفوعات').filter(function (p) { return /انتظار/.test(p['الحالة']); });
  const lines = [
    'صباح الخير 👋 ده ملخص شغلك النهارده من KDP Hub:', '',
    '🧾 تحويلات مستنية تأكيدك: ' + (pendingPays.length ? pendingPays.map(function (p) { return p['العميل'] + ' (' + p['المبلغ'] + ' ' + p['العملة'] + ')'; }).join('، ') : 'مفيش'),
    '⏰ تسليمات قريبة: ' + (soon.length ? '\n  • ' + soon.join('\n  • ') : 'مفيش'),
    '🚨 متأخرات: ' + (late.length ? '\n  • ' + late.join('\n  • ') : 'مفيش'),
    '💰 في انتظار العربون: ' + (waiting.length ? waiting.map(function (r) { return r.name; }).join('، ') : 'مفيش'),
    '📊 إجمالي المستحقات عند العملاء: ' + receivable.toLocaleString('en') + ' ج.م تقريباً', '',
    'افتح الأبلكيشن للتفاصيل والتحليلات.',
  ];
  if (!soon.length && !late.length && !waiting.length && !pendingPays.length) return; // مفيش جديد — مش هنزعجك
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'KDP Hub — ملخص اليوم', lines.join('\n'));
}
