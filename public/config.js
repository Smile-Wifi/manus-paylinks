async function loadPublicConfig() {
  try {
    const response = await fetch('/api/config/public', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result.ok) return;
    const s = result.settings;
    document.title = `${s.brandName} | Payment`;
    document.documentElement.style.setProperty('--green', s.primaryColor);
    document.documentElement.style.setProperty('--mint', s.accentColor);
    document.documentElement.style.setProperty('--paper', s.backgroundColor);
    document.querySelector('#brand-name').textContent = s.brandName;
    document.querySelector('#brand-tagline').textContent = s.brandTagline;
    document.querySelector('#headline').textContent = s.headline;
    document.querySelector('#description').textContent = s.description;
    document.querySelector('#pay-button .button-label').textContent = s.buttonText;
    document.querySelector('#description-field').hidden = !s.showDescription;
    const select = document.querySelector('#currency');
    select.innerHTML = s.supportedCurrencies.map(currency => `<option value="${currency}">${currency}</option>`).join('');
    select.value = s.defaultCurrency;
    if (s.logoUrl) { const logo = document.querySelector('#brand-logo'); logo.src = s.logoUrl; logo.hidden = false; }
    if (s.supportEmail) document.querySelector('#support-note').textContent = `Questions? Contact ${s.supportEmail}. Payment details are completed on the secure payment checkout.`;
  } catch (_) {}
}
loadPublicConfig();
