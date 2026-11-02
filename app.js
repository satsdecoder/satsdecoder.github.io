(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var inp = $('inp'), out = $('out'), timer = null, current = null, price = null;
  var EXAMPLE = 'lnbc9678785340p1pwmna7lpp5gc3xfm08u9qy06djf8dfflhugl6p7lgza6dsjxq454gxhj9t7a0sd8dgfkx7cmtwd68yetpd5s9xar0wfjn5gpc8qhrsdfq24f5ggrxdaezqsnvda3kkum5wfjkzmfqf3jkgem9wgsyuctwdus9xgrcyqcjcgpzgfskx6eqf9hzqnteypzxz7fzypfhg6trddjhygrcyqezcgpzfysywmm5ypxxjemgw3hxjmn8yptk7untd9hxwg3q2d6xjcmtv4ezq7pqxgsxzmnyyqcjqmt0wfjjq6t5v4khxsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsxqyjw5qcqp2rzjq0gxwkzc8w6323m55m4jyxcjwmy7stt9hwkwe2qxmy8zpsgg7jcuwz87fcqqeuqqqyqqqqlgqqqqn3qq9q9qrsgqrvgkpnmps664wgkp43l22qsgdw4ve24aca4nymnxddlnp8vh9v2sdxlu5ywdxefsfvm0fq3sesf08uf6q9a2ke0hc9j6z6wlxg5z5kqpu2v9wz';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function copy(text, btn) {
    var done = function () { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1200); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} ta.remove(); }
  }
  function cpBtn(text) { var b = el('button', 'cp', 'Copy'); b.type = 'button'; b.addEventListener('click', function () { copy(text, b); }); return b; }
  function qrSvg(text, upper) {
    var q = qrcode(0, 'M');
    if (upper) q.addData(text.toUpperCase(), 'Alphanumeric'); else q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
  }
  function fmtDate(sec) { return new Date(sec * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }); }
  function fmtDur(s) {
    s = Math.max(0, Math.floor(s));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + (d || h || m ? m + 'm ' : '') + x + 's';
  }

  function render() {
    clearInterval(timer); out.textContent = ''; current = null;
    var s = inp.value.trim();
    if (!s) return;
    var inv;
    try { inv = Bolt11.decode(s); } catch (e) {
      var c = el('div', 'card'); c.appendChild(el('span', 'badge b-bad', 'Cannot decode')); c.appendChild(el('p', 'err', e.message)); out.appendChild(c); return;
    }
    current = inv;
    var card = el('div', 'card');
    var head = el('div');
    head.appendChild(el('span', 'badge ' + (inv.valid ? 'b-ok' : 'b-bad'), inv.valid ? 'Valid signature & format' : 'Invalid per BOLT11'));
    var expB = el('span', 'badge'); head.appendChild(expB);
    head.appendChild(el('span', 'badge b-mut', inv.network));
    card.appendChild(head);

    var amt = el('div', 'amount');
    if (inv.amountMsat === null) { amt.textContent = 'Any amount'; amt.appendChild(el('small', '', '  (payer chooses)')); }
    else { amt.textContent = Bolt11.formatSats(inv.amountMsat) + ' sats'; amt.appendChild(el('small', '', '  = ' + Bolt11.formatBtc(inv.amountMsat) + ' BTC')); }
    card.appendChild(amt);
    var fiat = el('div', 'small mut'); card.appendChild(fiat);
    if (inv.amountMsat !== null) {
      if (price) showFiat(fiat, inv); else {
        var fb = el('button', 'cp', 'Show USD/EUR value'); fb.style.marginLeft = '0'; fb.title = 'Fetches the current BTC price from mempool.space';
        fb.addEventListener('click', function () { loadPrice(function () { showFiat(fiat, inv); }, fiat); });
        fiat.appendChild(fb); fiat.appendChild(el('span', '', ' (fetches price from mempool.space)'));
      }
    }
    var cd = el('div', 'cd'); card.appendChild(cd);
    function tick() {
      var left = inv.expiresAt - Date.now() / 1000;
      cd.textContent = '';
      if (left > 0) { cd.appendChild(document.createTextNode('Expires in ')); cd.appendChild(el('b', '', fmtDur(left))); expB.className = 'badge b-ok'; expB.textContent = 'Not expired'; }
      else { cd.appendChild(document.createTextNode('Expired ')); cd.appendChild(el('b', '', fmtDur(-left) + ' ago')); expB.className = 'badge b-warn'; expB.textContent = 'Expired'; }
    }
    tick(); timer = setInterval(tick, 1000);

    if (inv.errors.length || inv.warnings.length) {
      var ul = el('ul', 'msg');
      inv.errors.forEach(function (m) { ul.appendChild(el('li', 'e', m)); });
      inv.warnings.forEach(function (m) { ul.appendChild(el('li', 'w', m)); });
      card.appendChild(ul);
    }

    var t = el('table');
    function row(k, v, opts) {
      opts = opts || {};
      var tr = el('tr'), td = el('td', 'v' + (opts.txt ? ' txt' : ''));
      tr.appendChild(el('td', 'k', k));
      if (v instanceof Node) td.appendChild(v); else td.appendChild(document.createTextNode(v));
      if (opts.copy) td.appendChild(cpBtn(opts.copy));
      tr.appendChild(td); t.appendChild(tr);
    }
    if (inv.description !== null) row('Description', inv.description || '(empty)', { txt: true });
    if (inv.descriptionHash) row('Description hash', inv.descriptionHash, { copy: inv.descriptionHash });
    row('Payee node', inv.payeeNodeKey, { copy: inv.payeeNodeKey });
    row('Payee key source', inv.payeeFromField ? '"n" field (checked against signature)' : 'Recovered from signature', { txt: true });
    if (inv.amountMsat !== null) row('Amount (msat)', inv.amountMsat.toString());
    row('Created', fmtDate(inv.timestamp) + '  (unix ' + inv.timestamp + ')', { txt: true });
    row('Expires', fmtDate(inv.expiresAt) + '  (after ' + fmtDur(inv.expiry) + ')', { txt: true });
    row('Payment hash', inv.paymentHash || '—', inv.paymentHash ? { copy: inv.paymentHash } : {});
    if (inv.paymentSecret) row('Payment secret', inv.paymentSecret);
    row('Min final CLTV delta', inv.minFinalCltvExpiry + ' blocks', { txt: true });
    if (inv.metadata) row('Payment metadata', inv.metadata);
    if (inv.features.length) row('Features', inv.features.map(function (f) { return f.bit + (f.name ? ' ' + f.name : ' unknown') + (f.required ? ' (required)' : ''); }).join(', '), { txt: true });
    inv.fallbacks.forEach(function (f) { row('On-chain fallback', f.type + ': ' + f.address, { copy: f.address }); });
    inv.routeHints.forEach(function (hops, i) {
      var box = el('div');
      hops.forEach(function (h, j) {
        box.appendChild(el('div', '', (j + 1) + '. ' + h.pubkey));
        box.appendChild(el('div', 'mut', '   channel ' + h.shortChannelId + ', fee ' + h.feeBaseMsat + ' msat + ' + h.feeProportionalMillionths + ' ppm, cltv Δ ' + h.cltvExpiryDelta));
      });
      row('Route hint ' + (i + 1), box);
    });
    if (inv.unknownTags.length) row('Unknown fields', inv.unknownTags.map(function (u) { return u.type + ' (' + u.length + ')'; }).join(', '));
    row('Signature', inv.signature + ' / recovery flag ' + inv.recoveryFlag);
    card.appendChild(t);

    var det = el('details'); det.style.marginTop = '12px';
    det.appendChild(el('summary', '', 'Show invoice QR (to scan with a phone wallet)'));
    var qd = el('div', 'qr'); qd.style.marginTop = '10px'; qd.style.width = '340px'; det.appendChild(qd);
    det.addEventListener('toggle', function () { if (det.open && !qd.firstChild) { try { qd.innerHTML = qrSvg('lightning:' + inv.invoice, true); } catch (e) { qd.textContent = 'Invoice too long for a QR code.'; } } });
    card.appendChild(det);
    var raw = el('details'); raw.style.marginTop = '8px';
    raw.appendChild(el('summary', '', 'Raw JSON'));
    var pre = el('pre', 'small'); pre.style.whiteSpace = 'pre-wrap'; pre.style.wordBreak = 'break-all';
    pre.textContent = JSON.stringify(inv, function (k, v) { return typeof v === 'bigint' ? v.toString() : v; }, 2);
    raw.appendChild(pre); card.appendChild(raw);
    out.appendChild(card);
  }

  function loadPrice(cb, where) {
    where.textContent = 'Loading price…';
    fetch('https://mempool.space/api/v1/prices', { referrerPolicy: 'no-referrer', credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { price = j; cb(); })
      .catch(function () { where.textContent = 'Could not load the price (offline?).'; });
  }
  function showFiat(where, inv) {
    var btc = Number(inv.amountMsat) / 1e11;
    var f = function (cur) { return price[cur] ? (btc * price[cur]).toLocaleString(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }) : null; };
    where.textContent = '≈ ' + [f('USD'), f('EUR')].filter(Boolean).join(' / ') + ' at current price' + (price.time ? ' (' + new Date(price.time * 1000).toLocaleTimeString() + ')' : '');
  }

  var deb;
  inp.addEventListener('input', function () { clearTimeout(deb); deb = setTimeout(render, 150); });
  $('btnDecode').addEventListener('click', render);
  $('btnExample').addEventListener('click', function () { inp.value = EXAMPLE; render(); });
  $('btnClear').addEventListener('click', function () { inp.value = ''; render(); inp.focus(); });
  $('btnPaste').addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (t) { inp.value = t; render(); }, function () { inp.focus(); });
    else inp.focus();
  });
  document.querySelectorAll('[data-copy]').forEach(function (b) { b.addEventListener('click', function () { copy(b.getAttribute('data-copy'), b); }); });
  try { $('tipQr').innerHTML = qrSvg('lightning:pluckymotor700@walletofsatoshi.com', false); } catch (e) {}
  // Prefill from #lnbc... in the URL fragment (fragments are never sent to a server)
  if (location.hash.length > 5) { inp.value = decodeURIComponent(location.hash.slice(1)); render(); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
