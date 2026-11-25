const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || 'dev_gateway_key_change_me';
const GATEWAY_WEBHOOK_SECRET = process.env.GATEWAY_WEBHOOK_SECRET || 'dev_webhook_secret_change_me';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ===== MANUAL ONLY - PERSISTENCE (Option A) =====
const DATA_DIR = path.join(__dirname, 'data');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const PROOFS_DIR = path.join(__dirname, 'uploads', 'proofs');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PROOFS_DIR)) fs.mkdirSync(PROOFS_DIR, { recursive: true });

const payments = new Map();

function loadPayments() {
  try {
    if (!fs.existsSync(PAYMENTS_FILE)) return;
    const raw = fs.readFileSync(PAYMENTS_FILE, 'utf8');
    const arr = JSON.parse(raw || '[]');
    arr.forEach(p => payments.set(p.reference, p));
    console.log(`Loaded ${payments.size} payments from payments.json`);
  } catch (e) {
    console.log('Could not load payments.json, starting empty:', e.message);
  }
}
function savePayments() {
  try {
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify([...payments.values()], null, 2));
  } catch (e) {
    console.error('Failed to save payments.json:', e.message);
  }
}
loadPayments();

let settingsCache;

const DEFAULT_SETTINGS = {
  brandName: 'Gateway',
  brandTagline: 'Secure payment gateway',
  headline: 'Accept payments from any page.',
  description: 'A simple hosted checkout powered by your payment gateway.',
  buttonText: 'Continue to payment',
  successMessage: 'Payment received',
  primaryColor: '#0d3b35',
  accentColor: '#d7f0df',
  backgroundColor: '#f7f5f0',
  logoUrl: '',
  supportEmail: '',
  supportedCurrencies: ['SGD', 'MYR', 'PHP', 'USD', 'HKD'],
  defaultCurrency: 'PHP',
  showDescription: true,
  defaultRedirectUrl: '',
  defaultWebhookUrl: '',
  gcashName: 'Juan Dela Cruz',
  gcashNumber: '0917 123 4567',
  mayaNumber: '',
  gotymeNumber: '',
  qrUrl: '',
  qr99Url: '',
  qr149Url: '',
  qrLabel: 'Scan to Pay',
  pkg99Name: 'Basic Photo',
  pkg99Price: 99,
  pkg149Name: 'Magic With Music',
  pkg149Price: 149,
  pkg99Enabled: true,
  pkg149Enabled: true,
};

function headers() { return { 'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' }; }
function json(res, status, value) { const body = JSON.stringify(value); res.writeHead(status, { ...headers(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) }); res.end(body); }
function text(res, status, body, type = 'text/plain; charset=utf-8') { res.writeHead(status, { ...headers(), 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) }); res.end(body); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.setEncoding('utf8'); req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) { reject(new Error('Request body too large')); req.destroy(); } }); req.on('end', () => resolve(body)); req.on('error', reject); }); }
function parseJson(raw) { try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON'); } }
function clean(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
function validAmount(value) { const amount = Number(value); return Number.isFinite(amount) && amount > 0 && amount <= 100000000 ? amount.toFixed(2) : null; }
function origin(req) { const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim(); return `${proto}://${req.headers.host || 'localhost'}`; }
function constantTimeMatch(supplied, expected) { const a = Buffer.from(String(supplied || '')); const b = Buffer.from(String(expected || '')); return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b); }
function authorized(req, key) { const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || String(req.headers['x-api-key'] || '').trim(); return constantTimeMatch(supplied, key); }
function requireAuth(req, res) { if (!authorized(req, GATEWAY_API_KEY)) { json(res, 401, { ok: false, error: 'Unauthorized. Use Authorization: Bearer YOUR_GATEWAY_API_KEY.' }); return false; } return true; }
function requireAdmin(req, res) { if (!ADMIN_API_KEY) { json(res, 503, { ok: false, error: 'ADMIN_API_KEY is not configured' }); return false; } if (!authorized(req, ADMIN_API_KEY)) { json(res, 401, { ok: false, error: 'Admin authorization required' }); return false; } return true; }
function serve(res, name, type) { fs.readFile(path.join(PUBLIC_DIR, name), (err, data) => err ? text(res, 404, 'Not found') : (res.writeHead(200, { ...headers(), 'Content-Type': type, 'Content-Length': data.length }), res.end(data))); }
function color(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback; }
function urlValue(value, allowEmpty = true) { const valueString = clean(value, 1000); if (!valueString && allowEmpty) return ''; return /^https:\/\//i.test(valueString) ? valueString : ''; }
function sanitizeSettings(input = {}) {
  const currencies = Array.isArray(input.supportedCurrencies) ? [...new Set(input.supportedCurrencies.map(value => clean(value, 3).toUpperCase()).filter(value => /^[A-Z]{3}$/.test(value)))].slice(0, 10) : DEFAULT_SETTINGS.supportedCurrencies;
  const supportedCurrencies = currencies.length ? currencies : DEFAULT_SETTINGS.supportedCurrencies;
  return {
    brandName: clean(input.brandName, 80) || DEFAULT_SETTINGS.brandName,
    brandTagline: clean(input.brandTagline, 120) || DEFAULT_SETTINGS.brandTagline,
    headline: clean(input.headline, 160) || DEFAULT_SETTINGS.headline,
    description: clean(input.description, 300) || DEFAULT_SETTINGS.description,
    buttonText: clean(input.buttonText, 60) || DEFAULT_SETTINGS.buttonText,
    successMessage: clean(input.successMessage, 120) || DEFAULT_SETTINGS.successMessage,
    primaryColor: color(input.primaryColor, DEFAULT_SETTINGS.primaryColor),
    accentColor: color(input.accentColor, DEFAULT_SETTINGS.accentColor),
    backgroundColor: color(input.backgroundColor, DEFAULT_SETTINGS.backgroundColor),
    logoUrl: urlValue(input.logoUrl),
    supportEmail: clean(input.supportEmail, 200),
    supportedCurrencies,
    defaultCurrency: supportedCurrencies.includes(clean(input.defaultCurrency, 3).toUpperCase()) ? clean(input.defaultCurrency, 3).toUpperCase() : supportedCurrencies[0],
    showDescription: input.showDescription !== false,
    defaultRedirectUrl: urlValue(input.defaultRedirectUrl),
    defaultWebhookUrl: urlValue(input.defaultWebhookUrl),
    gcashName: clean(input.gcashName, 80) || DEFAULT_SETTINGS.gcashName,
    gcashNumber: clean(input.gcashNumber, 30),
    mayaNumber: clean(input.mayaNumber, 30),
    gotymeNumber: clean(input.gotymeNumber, 30),
    qrUrl: clean(input.qrUrl, 500),
    qr99Url: clean(input.qr99Url, 500),
    qr149Url: clean(input.qr149Url, 500),
    qrLabel: clean(input.qrLabel, 80) || 'Scan to Pay',
    pkg99Name: clean(input.pkg99Name, 80) || 'Basic Photo',
    pkg99Price: Number(input.pkg99Price) > 0 ? Number(input.pkg99Price) : 99,
    pkg149Name: clean(input.pkg149Name, 80) || 'Magic With Music',
    pkg149Price: Number(input.pkg149Price) > 0 ? Number(input.pkg149Price) : 149,
    pkg99Enabled: input.pkg99Enabled !== false,
    pkg149Enabled: input.pkg149Enabled !== false,
  };
}

// Settings saved to file too (so branding survives restart)
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
async function getSettings() {
  if (settingsCache) return settingsCache;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return (settingsCache = sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored }));
    }
  } catch {}
  return (settingsCache = { ...DEFAULT_SETTINGS });
}
async function saveSettings(input) {
  const next = sanitizeSettings({ ...(await getSettings()), ...input });
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2)); } catch {}
  settingsCache = next;
  return next;
}
function publicSettings(settings) { const { defaultWebhookUrl, ...safe } = settings; return safe; }

async function notifyMerchant(payment) {
  if (!payment.webhook_url) return;
  const event = { id: `evt_${crypto.randomBytes(10).toString('hex')}`, type: 'payment.succeeded', created_at: new Date().toISOString(), data: { payment } };
  const body = JSON.stringify(event);
  const signature = crypto.createHmac('sha256', GATEWAY_WEBHOOK_SECRET).update(body).digest('hex');
  try {
    const response = await fetch(payment.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'PaymentGateway/1.0', 'X-Gateway-Signature': signature, 'X-Gateway-Event': event.type }, body, signal: AbortSignal.timeout(8000) });
    payment.webhook_delivery = { delivered: response.ok, status_code: response.status, delivered_at: new Date().toISOString() };
  } catch (error) {
    payment.webhook_delivery = { delivered: false, error: error.message, attempted_at: new Date().toISOString() };
  }
}

// ===== MANUAL ONLY - CREATE PAYMENT =====
async function createPayment(req) {
  const input = parseJson(await readBody(req));
  const settings = await getSettings();
  const amount = validAmount(input.amount); const currency = clean(input.currency || settings.defaultCurrency, 3).toUpperCase(); const name = clean(input.name, 120); const email = clean(input.email, 200); const purpose = clean(input.purpose || input.description, 200) || 'Payment';
  if (!amount) throw new Error('amount must be a positive number');
  if (!settings.supportedCurrencies.includes(currency)) throw new Error('currency is not enabled');
  if (!name) throw new Error('name is required');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('email must be valid');
  const reference = clean(input.reference_number, 100) || `PAY-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const redirectUrl = clean(input.redirect_url, 1000) || settings.defaultRedirectUrl || `${origin(req)}/payment-result.html?reference=${encodeURIComponent(reference)}`;
  if (!/^https?:\/\//i.test(redirectUrl)) throw new Error('redirect_url must be an absolute http(s) URL');
  const webhookUrl = clean(input.webhook_url, 1000) || settings.defaultWebhookUrl;
  if (webhookUrl && !/^https:\/\//i.test(webhookUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(webhookUrl)) throw new Error('webhook_url must use HTTPS');
  const record = { reference, status: 'pending', amount, currency, name, email, purpose, gcash_number: clean(input.gcash_number,30), payment_method: clean(input.payment_method,30), package_name: clean(input.package_name,80), ...(webhookUrl ? { webhook_url: webhookUrl } : {}), createdAt: new Date().toISOString(), mode: 'manual' };
  // MANUAL ONLY: always use your own checkout, never HitPay
  record.checkout_url = `${origin(req)}/mock-checkout.html?reference=${encodeURIComponent(reference)}`;
  payments.set(reference, record);
  savePayments();
  return record;
}

// ===== MANUAL VERIFY - FUNCTIONS =====
function saveProofImage(reference, dataUrl) {
  const match = /^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('proof must be an image (png/jpg/webp)');
  const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
  const filename = `${reference}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(PROOFS_DIR, filename), Buffer.from(match[3], 'base64'));
  return `/uploads/proofs/${filename}`;
}

async function submitProof(req) {
  const input = parseJson(await readBody(req));
  const reference = clean(input.reference, 100);
  const payment = payments.get(reference);
  if (!payment) throw new Error('Payment not found');
  if (!input.proof_image) throw new Error('proof_image is required');
  payment.status = 'pending_review';
  payment.payment_method = clean(input.payment_method, 50) || 'manual';
  payment.proof_url = saveProofImage(reference, input.proof_image);
  payment.proof_note = clean(input.proof_note, 300) || '';
  payment.submittedAt = new Date().toISOString();
  payments.set(reference, payment);
  savePayments();
  return payment;
}

async function adminListPayments(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const status = clean(url.searchParams.get('status'), 30);
  const q = clean(url.searchParams.get('q'), 100).toLowerCase();
  let list = [...payments.values()];
  if (status) list = list.filter(p => p.status === status);
  if (q) list = list.filter(p => (p.reference + p.name + p.email).toLowerCase().includes(q));
  list.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}

async function adminDecision(req, action) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reference = clean(decodeURIComponent(url.pathname.split('/')[4]), 100);
  const input = parseJson(await readBody(req));
  const payment = payments.get(reference);
  if (!payment) throw new Error('Payment not found');
  if (!['pending','pending_review'].includes(payment.status)) throw new Error('Only pending payments can be decided');
  if (action === 'approve') {
    payment.status = 'completed';
    payment.verified_by = 'admin';
    payment.verified_at = new Date().toISOString();
    payment.paidAt = payment.paidAt || new Date().toISOString();
    payment.admin_note = clean(input.note, 300) || '';
    payments.set(reference, payment);
    savePayments();
    await notifyMerchant(payment);
  } else {
    payment.status = 'rejected';
    payment.verified_by = 'admin';
    payment.verified_at = new Date().toISOString();
    payment.admin_note = clean(input.note, 300) || 'Rejected by admin';
    payments.set(reference, payment);
    savePayments();
  }
  return payment;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, headers()); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && ['/health', '/_app/health'].includes(url.pathname)) return json(res, 200, { ok: true, service: 'payment-gateway-manual', mode: 'manual', payments: payments.size });
  if (req.method === 'GET' && url.pathname === '/') return serve(res, 'index.html', 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/docs') return serve(res, 'docs.html', 'text/html; charset=utf-8');
  if (req.method === 'GET' && (url.pathname === '/admin' -or url.pathname === '/admin.html')) return serve(res, 'admin.html', 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/payment-result.html') return serve(res, 'payment-result.html', 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/mock-checkout.html') return serve(res, 'mock-checkout.html', 'text/html; charset=utf-8');
  if (req.method === 'GET' && (url.pathname === '/checkout.html' -or url.pathname === '/checkout')) return serve(res, 'checkout.html', 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/styles.css') return serve(res, 'styles.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/app.js') return serve(res, 'app.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/config.js') return serve(res, 'config.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/admin.js') return serve(res, 'admin.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/mock.js') return serve(res, 'mock.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/result.js') return serve(res, 'result.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/manus-routes.json') return serve(res, 'manus-routes.json', 'application/json; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/api/config/public') return json(res, 200, { ok: true, settings: publicSettings(await getSettings()) });
  if (req.method === 'GET' && url.pathname === '/api/admin/settings') { if (!requireAdmin(req, res)) return; return json(res, 200, { ok: true, settings: await getSettings() }); }
  if (req.method === 'PUT' && url.pathname === '/api/admin/settings') { if (!requireAdmin(req, res)) return; return json(res, 200, { ok: true, settings: await saveSettings(parseJson(await readBody(req))) }); }
  if (req.method === 'POST' && url.pathname === '/api/mock/complete') { const reference = clean(url.searchParams.get('reference'), 100); const payment = payments.get(reference); if (!payment) return json(res, 404, { ok: false, error: 'Payment not found' }); payment.status = 'completed'; payment.paidAt = new Date().toISOString(); payments.set(reference, payment); savePayments(); await notifyMerchant(payment); return json(res, 200, { ok: true, payment }); }
  if (req.method === 'POST' && (url.pathname === '/api/v1/payment-requests' || url.pathname === '/api/create-payment')) { if (url.pathname === '/api/v1/payment-requests' && !requireAuth(req, res)) return; try { return json(res, 200, { ok: true, payment: await createPayment(req) }); } catch (error) { return json(res, 400, { ok: false, error: error.message }); } }
  if (req.method === 'GET' && url.pathname.startsWith('/api/v1/payment-requests/')) { if (!requireAuth(req, res)) return; const reference = clean(decodeURIComponent(url.pathname.split('/').pop()), 100); const payment = payments.get(reference); return payment ? json(res, 200, { ok: true, payment }) : json(res, 404, { ok: false, error: 'Payment not found' }); }
  if (req.method === 'GET' && url.pathname === '/api/payment-status') { const payment = payments.get(clean(url.searchParams.get('reference'), 100)); return payment ? json(res, 200, { ok: true, payment }) : json(res, 404, { ok: false, error: 'Payment not found' }); }

  // ===== MANUAL VERIFY ROUTES =====
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/proofs/')) {
    const file = path.join(__dirname, url.pathname);
    if (!file.startsWith(PROOFS_DIR)) return text(res, 403, 'Forbidden');
    fs.readFile(file, (err, data) => err ? text(res, 404, 'Not found') : (res.writeHead(200, { ...headers(), 'Content-Type': 'image/jpeg', 'Content-Length': data.length }), res.end(data)));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/payments/proof') {
    try { return json(res, 200, { ok: true, payment: await submitProof(req) }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/payments') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, { ok: true, payments: await adminListPayments(req) });
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/admin/payments/') && url.pathname.endsWith('/approve')) {
    if (!requireAdmin(req, res)) return;
    try { return json(res, 200, { ok: true, payment: await adminDecision(req, 'approve') }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/admin/payments/') && url.pathname.endsWith('/reject')) {
    if (!requireAdmin(req, res)) return;
    try { return json(res, 200, { ok: true, payment: await adminDecision(req, 'reject') }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }


  // ===== ADMIN CMS - QR UPLOAD =====
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/qr/')) {
    const file = path.join(__dirname, url.pathname);
    const QR_DIR = path.join(__dirname, 'uploads', 'qr');
    if (!file.startsWith(QR_DIR)) return text(res, 403, 'Forbidden');
    const ext = path.extname(file).toLowerCase();
    const ctype = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    fs.readFile(file, (err, data) => err ? text(res, 404, 'Not found') : (res.writeHead(200, { ...headers(), 'Content-Type': ctype, 'Content-Length': data.length }), res.end(data)));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/qr') {
    if (!requireAdmin(req, res)) return;
    try {
      const input = parseJson(await readBody(req));
      const m = /^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/.exec(input.qr_image || '');
      if (!m) return json(res, 400, { ok: false, error: 'qr_image must be png/jpg/webp data URL' });
      const QR_DIR = path.join(__dirname, 'uploads', 'qr');
      if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });
      const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
      const fn = `qr-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(QR_DIR, fn), Buffer.from(m[3], 'base64'));
      const slot = input.slot === '149' ? 'qr149Url' : input.slot === '99' ? 'qr99Url' : 'qrUrl';
      const settings = await saveSettings({ [slot]: `/uploads/qr/${fn}` });
      return json(res, 200, { ok: true, qrUrl: settings[slot], slot, settings });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  return text(res, 404, 'Not found');
}
http.createServer((req, res) => handler(req, res).catch(error => { console.error(error); json(res, 500, { ok: false, error: error.message }); })).listen(PORT, '0.0.0.0', () => console.log(`Payment gateway MANUAL listening on ${PORT} (payments=${payments.size})`));


