// admin.js - Branding CMS + Manual Verify
let ADMIN_KEY = sessionStorage.getItem('adminKey') || '';

function headers(extra = {}) {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ADMIN_KEY, 'X-Admin-Key': ADMIN_KEY, ...extra };
}
function badge(status) {
  const cls = status === 'completed' ? 'badge-completed' : status === 'pending_review' ? 'badge-review' : status === 'rejected' ? 'badge-rejected' : 'badge-pending';
  return `<span class="badge ${cls}">${status}</span>`;
}
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// --- LOGIN ---
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  ADMIN_KEY = document.getElementById('admin-key').value.trim();
  sessionStorage.setItem('adminKey', ADMIN_KEY);
  const res = await fetch('/api/admin/settings', { headers: headers() });
  if (!res.ok) {
    const err = document.getElementById('login-error');
    err.hidden = false; err.textContent = 'Invalid admin key';
    return;
  }
  document.getElementById('login-card').hidden = true;
  document.getElementById('settings-card').hidden = false;
  document.getElementById('payments-card').hidden = false;
  const j = await res.json();
  loadSettings(j);
  loadAdminPayments('pending_review');
});

document.getElementById('logout')?.addEventListener('click', () => {
  sessionStorage.removeItem('adminKey');
  location.reload();
});

// Auto-login if key already in session
if (ADMIN_KEY) {
  document.getElementById('admin-key').value = ADMIN_KEY;
  document.getElementById('login-form')?.dispatchEvent(new Event('submit'));
}

// --- SETTINGS (existing CMS) ---
function loadSettings(j) {
  const s = j.settings || j || {};
  const form = document.getElementById('settings-form');
  if (!form) return;
  for (const [k, v] of Object.entries(s)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
  }
  if (form.elements['supportedCurrenciesText'] && s.supportedCurrencies) {
    form.elements['supportedCurrenciesText'].value = s.supportedCurrencies.join(', ');
  }
  if (form.elements['defaultCurrency'] && s.supportedCurrencies) {
    form.elements['defaultCurrency'].innerHTML = s.supportedCurrencies.map(c => `<option>${c}</option>`).join('');
    form.elements['defaultCurrency'].value = s.defaultCurrency;
  }
}

document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  data.showDescription = !!e.target.elements['showDescription']?.checked;
  if (data.supportedCurrenciesText) data.supportedCurrencies = data.supportedCurrenciesText.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const res = await fetch('/api/admin/settings', { method: 'PUT', headers: headers(), body: JSON.stringify(data) });
  const j = await res.json();
  const m = document.getElementById('save-message');
  m.hidden = false; m.textContent = j.ok ? 'Saved!' : 'Error: ' + j.error;
});

// --- MANUAL VERIFY ---
async function loadAdminPayments(filter = 'pending_review') {
  const tbody = document.querySelector('#paymentsTable tbody');
  const errEl = document.getElementById('payments-error');
  try {
    const res = await fetch(`/api/admin/payments?status=${encodeURIComponent(filter)}`, { headers: headers() });
    const j = await res.json();
    if (errEl) errEl.hidden = true;
    if (!j.ok) { if (tbody) tbody.innerHTML = `<tr><td colspan="6">Error: ${esc(j.error)}</td></tr>`; return; }
    if (!j.payments.length) { if (tbody) tbody.innerHTML = `<tr><td colspan="6">No payments in this filter.</td></tr>`; return; }
    tbody.innerHTML = '';
    j.payments.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${esc(p.reference)}</b><br><small>${esc(p.createdAt || '')}</small></td>
        <td>${esc(p.name)}<br><small>${esc(p.email)}</small></td>
        <td>${esc(p.currency)} ${Number(p.amount).toFixed(2)}</td>
        <td>${esc(p.payment_method || '-')}<br>${badge(p.status)}</td>
        <td>${p.proof_url ? `<a href="${esc(p.proof_url)}" target="_blank" rel="noopener">View Proof</a><br><small>${esc(p.proof_note || '')}</small>` : 'No proof'}</td>
        <td>
          <button class="approve-btn" onclick="decide('${esc(p.reference)}','approve')">Approve</button>
          <button class="reject-btn" onclick="decide('${esc(p.reference)}','reject')">Reject</button>
        </td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    if (errEl) { errEl.hidden = false; errEl.textContent = 'Failed to load payments. Did you add the Manual routes to server.js and restart? ' + e.message; }
  }
}

async function decide(ref, action) {
  const note = prompt('Admin note (optional):') || '';
  const res = await fetch(`/api/admin/payments/${encodeURIComponent(ref)}/${action}`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ note })
  });
  const j = await res.json();
  if (!j.ok) return alert(j.error);
  alert(`Payment ${ref} → ${j.payment.status}`);
  loadAdminPayments(document.getElementById('paymentFilter')?.value || 'pending_review');
}
