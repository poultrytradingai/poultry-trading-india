(function () {
  var CLIENT_ID = '595244834215-bud05h4b657l8mqdcmpehkun7335u4td.apps.googleusercontent.com';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(path, body) {
    return fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .catch(function () { return { ok: false, error: 'network' }; });
  }

  var gsiLoading = null;
  function loadGsi() {
    if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
    if (gsiLoading) return gsiLoading;
    gsiLoading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    return gsiLoading;
  }

  var overlay = null;
  function closeModal() { if (overlay) { overlay.remove(); overlay = null; } }
  function modal(html) {
    closeModal();
    overlay = document.createElement('div');
    overlay.className = 'ptm';
    overlay.innerHTML = '<div class="ptm-box" role="dialog" aria-modal="true"><button class="ptm-x" aria-label="Close">&times;</button>' + html + '</div>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.classList.contains('ptm-x')) closeModal();
    });
    document.body.appendChild(overlay);
    return overlay.querySelector('.ptm-box');
  }

  function askWhatsapp(done) {
    var box = modal('<h3>Add your WhatsApp number</h3><p>Optional. Verified WhatsApp raises your daily unlocks from 1 to 5 (WhatsApp verification is coming soon).</p>' +
      '<input id="ptWa" type="tel" placeholder="+91 98765 43210" autocomplete="tel"><p class="ptm-e" id="ptErr"></p>' +
      '<div class="ptm-row"><button class="ptm-b" id="ptSave">Save</button><button class="ptm-b ghost" id="ptSkip">Skip</button></div>');
    box.querySelector('#ptSkip').onclick = function () { closeModal(); done(); };
    box.querySelector('#ptSave').onclick = function () {
      var v = box.querySelector('#ptWa').value;
      api('/api/profile', { whatsapp: v }).then(function (r) {
        if (r.ok) { closeModal(); done(); }
        else box.querySelector('#ptErr').textContent = 'Enter a valid number with country code.';
      });
    };
  }

  function signIn(done) {
    modal('<h3>Sign in to view contact</h3><p>Free for verified members. Sign in with Google so contacts stay protected from misuse.</p>' +
      '<div id="ptG" style="min-height:44px"></div>' +
      '<p class="ptm-s">By continuing you agree to our <a href="/terms/" target="_blank">Terms</a> and <a href="/privacy/" target="_blank">Privacy Policy</a>. Your name and email are stored for verification.</p>' +
      '<p class="ptm-e" id="ptErr"></p>');
    loadGsi().then(function () {
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: function (resp) {
          api('/api/auth/google', { credential: resp.credential }).then(function (res) {
            var err = document.getElementById('ptErr');
            if (!res.ok) {
              if (err) err.textContent = res.error === 'disposable_email' ? 'Temporary email addresses are not allowed.' : 'Sign-in failed. Please try again.';
              return;
            }
            if (!res.member.whatsapp) askWhatsapp(done); else { closeModal(); done(); }
          });
        }
      });
      google.accounts.id.renderButton(document.getElementById('ptG'), { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill' });
    }).catch(function () {
      var err = document.getElementById('ptErr'); if (err) err.textContent = 'Could not load Google sign-in.';
    });
  }

  function row(k, v) { return v ? '<div class="crow"><span>' + k + '</span><b>' + v + '</b></div>' : ''; }
  function contactHtml(c, remaining) {
    var phone = String(c.phone || '').trim();
    var digits = phone.replace(/[^\d]/g, '');
    var phoneHtml = digits ? '<a href="tel:' + (phone.charAt(0) === '+' ? '+' : '') + digits + '">' + esc(phone) + '</a> &middot; <a href="https://wa.me/' + digits + '" target="_blank" rel="noopener">WhatsApp</a>' : '';
    var email = String(c.email || '').trim();
    var emailHtml = email ? '<a href="mailto:' + esc(email) + '">' + esc(email) + '</a>' : '';
    var site = String(c.website || '').trim();
    var siteHtml = /^https?:\/\//i.test(site) ? '<a href="' + esc(site) + '" target="_blank" rel="nofollow ugc noopener">' + esc(site) + '</a>' : esc(site);
    return '<h2>Contact details</h2>' +
      row('Name', esc(c.name)) + row('Contact person', esc(c.person)) + row('Company', esc(c.company)) +
      row('Phone', phoneHtml) + row('Email', emailHtml) + row('Website', siteHtml) + row('Address', esc(c.address)) +
      '<p class="note">Unlocks left today: ' + remaining + '</p>';
  }

  function run(btn) {
    var box = btn.closest('[data-unlock-box]') || btn.parentNode;
    btn.disabled = true;
    api('/api/unlock', { type: btn.getAttribute('data-unlock'), id: btn.getAttribute('data-id') }).then(function (res) {
      btn.disabled = false;
      if (res.ok) {
        box.innerHTML = contactHtml(res.contact, res.remaining);
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'contact_unlock', unlock_type: btn.getAttribute('data-unlock') });
        return;
      }
      if (res.error === 'auth') return signIn(function () { run(btn); });
      if (res.error === 'limit') {
        return modal('<h3>Daily limit reached</h3><p>You have used your ' + esc(res.limit) + ' free unlock' + (res.limit === 1 ? '' : 's') + ' for today. Come back tomorrow.</p>' +
          '<p>Verified WhatsApp raises the limit to 5 per day. Verified WhatsApp plus a free directory listing raises it to 10.</p>' +
          '<div class="ptm-row"><a class="ptm-b" href="/list-your-business/">List your business free</a></div>');
      }
      if (res.error === 'banned') return modal('<h3>Account restricted</h3><p>Please contact us if you think this is a mistake.</p>');
      modal('<h3>Not available</h3><p>We could not load this contact. Please try again later.</p>');
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-unlock]');
    if (!b || b.disabled) return;
    e.preventDefault();
    run(b);
  });
})();
