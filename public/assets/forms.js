(function () {
  var form = document.getElementById('mainForm');
  if (!form) return;
  var msg = document.getElementById('msg');
  var btn = document.getElementById('submitBtn');

  // Dependent category -> sub-category (directory form only)
  var cat = document.getElementById('category');
  var sub = document.getElementById('subCategory');
  if (cat && sub && window.CATS) {
    sub.innerHTML = '<option value="">Select category first</option>';
    cat.addEventListener('change', function () {
      var list = window.CATS[cat.value] || [];
      sub.innerHTML = '<option value="">Select</option>' + list.map(function (s) {
        return '<option>' + s + '</option>';
      }).join('');
    });
  }

  function setMsg(text, isErr) {
    msg.textContent = text;
    msg.className = 'msg' + (isErr ? ' err' : '');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setMsg('', false);

    var bad = null;
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || !el.required) return;
      var ok = el.value && el.value.trim() && (el.type !== 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()));
      el.classList.toggle('bad', !ok);
      if (!ok && !bad) bad = el;
    });
    if (bad) { bad.focus(); setMsg('Please fill the highlighted fields.', true); return; }

    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v; });
    data.form = form.getAttribute('data-form');

    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = 'Sending...';

    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (res) {
        if (res.ok) {
          form.hidden = true;
          document.getElementById('success').hidden = false;
          window.scrollTo({ top: 0, behavior: 'smooth' });
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({ event: 'form_submit', form_name: data.form });
        } else {
          var m = {
            rate_limited: 'Too many submissions. Please try again later.',
            captcha_failed: 'Captcha failed. Please try again.',
            captcha_missing: 'Please complete the captcha.'
          }[res.error] || 'Something went wrong. Please try again.';
          setMsg(m, true);
          if (window.turnstile) try { window.turnstile.reset(); } catch (x) {}
          btn.disabled = false; btn.textContent = label;
        }
      })
      .catch(function () {
        setMsg('Network error. Please try again.', true);
        btn.disabled = false; btn.textContent = label;
      });
  });
})();
