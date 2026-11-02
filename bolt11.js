/* BOLT11 Lightning invoice decoder. Pure JS, no dependencies, runs in browser and Node.
 * Implements bech32, SHA-256, secp256k1 public-key recovery, and the BOLT11 reader rules. MIT license. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Bolt11 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- bech32 ----------
  var CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  var BECH32_CONST = 1, BECH32M_CONST = 0x2bc830a3;
  function polymod(values) {
    var GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    var chk = 1;
    for (var i = 0; i < values.length; i++) {
      var top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ values[i];
      for (var j = 0; j < 5; j++) if ((top >>> j) & 1) chk ^= GEN[j];
    }
    return chk >>> 0;
  }
  function hrpExpand(hrp) {
    var r = [], i;
    for (i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) >> 5);
    r.push(0);
    for (i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) & 31);
    return r;
  }
  function bech32Decode(str) {
    var lower = str.toLowerCase(), upper = str.toUpperCase();
    if (str !== lower && str !== upper) throw new Error('Mixed upper and lower case is not allowed');
    str = lower;
    var pos = str.lastIndexOf('1');
    if (pos < 1) throw new Error('Not a bech32 string: missing "1" separator');
    if (pos + 7 > str.length) throw new Error('Data part too short');
    var hrp = str.slice(0, pos), words = [];
    for (var i = 0; i < hrp.length; i++) {
      var c = hrp.charCodeAt(i);
      if (c < 33 || c > 126) throw new Error('Invalid character in prefix');
    }
    for (i = pos + 1; i < str.length; i++) {
      var v = CHARSET.indexOf(str[i]);
      if (v === -1) throw new Error('Invalid bech32 character "' + str[i] + '"');
      words.push(v);
    }
    if (polymod(hrpExpand(hrp).concat(words)) !== BECH32_CONST) throw new Error('Bech32 checksum is invalid (typo or truncated invoice?)');
    return { hrp: hrp, words: words.slice(0, -6) };
  }
  function bech32Encode(hrp, words, constant) {
    var values = hrpExpand(hrp).concat(words).concat([0, 0, 0, 0, 0, 0]);
    var mod = polymod(values) ^ constant, out = hrp + '1', i;
    for (i = 0; i < words.length; i++) out += CHARSET[words[i]];
    for (i = 0; i < 6; i++) out += CHARSET[(mod >>> (5 * (5 - i))) & 31];
    return out;
  }
  function convertBits(data, from, to, pad) {
    var acc = 0, bits = 0, out = [], maxv = (1 << to) - 1;
    for (var i = 0; i < data.length; i++) {
      acc = (acc << from) | data[i]; bits += from;
      while (bits >= to) { bits -= to; out.push((acc >>> bits) & maxv); }
      acc &= (1 << bits) - 1;
    }
    if (pad && bits > 0) out.push((acc << (to - bits)) & maxv);
    return out;
  }
  // words -> bytes, dropping incomplete trailing bits (BOLT11 field data)
  function wordsToBytes(words) { return Uint8Array.from(convertBits(words, 5, 8, false)); }
  function wordsToInt(words) { var n = 0; for (var i = 0; i < words.length; i++) n = n * 32 + words[i]; return n; }

  // ---------- hex / utf8 ----------
  function toHex(b) { var s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
  function bytesToBig(b) { return b.length ? BigInt('0x' + toHex(b)) : 0n; }
  function utf8(s) { return new TextEncoder().encode(s); }

  // ---------- SHA-256 ----------
  var K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  function sha256(msg) {
    var len = msg.length, bitLen = len * 8;
    var total = ((len + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(total); buf.set(msg); buf[len] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000)); dv.setUint32(total - 4, bitLen >>> 0);
    var H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    var W = new Uint32Array(64);
    for (var off = 0; off < total; off += 64) {
      for (var t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4);
      for (t = 16; t < 64; t++) {
        var x = W[t - 15], y = W[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    var out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (var k = 0; k < 8; k++) odv.setUint32(k * 4, H[k]);
    return out;
  }

  // ---------- secp256k1 (Jacobian coordinates, BigInt) ----------
  var P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
  var N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  var GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
  var GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
  function mod(a, m) { var r = a % m; return r < 0n ? r + m : r; }
  function powmod(b, e, m) { var r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
  function inv(a, m) { // extended Euclid
    var lm = 1n, hm = 0n, low = mod(a, m), high = m;
    while (low > 1n) { var q = high / low; var nm = hm - lm * q, nw = high - low * q; hm = lm; high = low; lm = nm; low = nw; }
    return mod(lm, m);
  }
  function jDouble(p) {
    if (p[1] === 0n || p[2] === 0n) return [0n, 1n, 0n];
    var X = p[0], Y = p[1], Z = p[2];
    var YY = Y * Y % P, S = 4n * X * YY % P, M = 3n * X * X % P;
    var nx = mod(M * M - 2n * S, P);
    var ny = mod(M * (S - nx) - 8n * YY * YY, P);
    var nz = 2n * Y * Z % P;
    return [nx, ny, nz];
  }
  function jAdd(p, q) {
    if (p[2] === 0n) return q; if (q[2] === 0n) return p;
    var Z1Z1 = p[2] * p[2] % P, Z2Z2 = q[2] * q[2] % P;
    var U1 = p[0] * Z2Z2 % P, U2 = q[0] * Z1Z1 % P;
    var S1 = p[1] * q[2] % P * Z2Z2 % P, S2 = q[1] * p[2] % P * Z1Z1 % P;
    if (U1 === U2) return S1 === S2 ? jDouble(p) : [0n, 1n, 0n];
    var H = mod(U2 - U1, P), R = mod(S2 - S1, P), HH = H * H % P, HHH = H * HH % P, V = U1 * HH % P;
    var nx = mod(R * R - HHH - 2n * V, P);
    var ny = mod(R * (V - nx) - S1 * HHH, P);
    var nz = H * p[2] % P * q[2] % P;
    return [nx, ny, nz];
  }
  function jMul(p, k) { var r = [0n, 1n, 0n]; while (k > 0n) { if (k & 1n) r = jAdd(r, p); p = jDouble(p); k >>= 1n; } return r; }
  function toAffine(p) { if (p[2] === 0n) return null; var zi = inv(p[2], P), zi2 = zi * zi % P; return [p[0] * zi2 % P, p[1] * zi2 % P * zi % P]; }
  function compress(pt) { return (pt[1] & 1n ? '03' : '02') + pt[0].toString(16).padStart(64, '0'); }
  // Recover compressed public key (hex) from 32-byte hash, 64-byte compact sig, recovery id
  function recoverPubkey(hash, sig64, recid) {
    var r = bytesToBig(sig64.slice(0, 32)), s = bytesToBig(sig64.slice(32, 64));
    if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error('Signature values out of range');
    if (recid < 0 || recid > 3) throw new Error('Invalid recovery flag ' + recid);
    var highS = s > N / 2n;
    // BOLT11 accepts high-S signatures for recovery: normalise to low-S and keep the recovery flag (spec test vector)
    if (highS) s = N - s;
    var x = r + (recid & 2 ? N : 0n);
    if (x >= P) throw new Error('Signature is not recoverable');
    var alpha = (x * x % P * x + 7n) % P;
    var y = powmod(alpha, (P + 1n) / 4n, P);
    if (y * y % P !== alpha) throw new Error('Signature is not recoverable');
    if ((y & 1n) !== BigInt(recid & 1)) y = P - y;
    var e = mod(bytesToBig(hash), N), ri = inv(r, N);
    var u1 = mod(-e * ri, N), u2 = s * ri % N;
    var Q = toAffine(jAdd(jMul([GX, GY, 1n], u1), jMul([x, y, 1n], u2)));
    if (!Q) throw new Error('Signature is not recoverable');
    return { pubkey: compress(Q), highS: highS };
  }

  // ---------- base58check (for legacy fallback addresses) ----------
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function base58check(version, payload) {
    var data = new Uint8Array(1 + payload.length); data[0] = version; data.set(payload, 1);
    var chk = sha256(sha256(data)).slice(0, 4);
    var full = new Uint8Array(data.length + 4); full.set(data); full.set(chk, data.length);
    var n = bytesToBig(full), s = '';
    while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (var i = 0; i < full.length && full[i] === 0; i++) s = '1' + s;
    return s;
  }

  // ---------- BOLT11 ----------
  var NETWORKS = {
    bc: { name: 'Bitcoin mainnet', segwit: 'bc', p2pkh: 0x00, p2sh: 0x05 },
    tb: { name: 'Bitcoin testnet', segwit: 'tb', p2pkh: 0x6f, p2sh: 0xc4 },
    tbs: { name: 'Bitcoin signet', segwit: 'tb', p2pkh: 0x6f, p2sh: 0xc4 },
    bcrt: { name: 'Bitcoin regtest', segwit: 'bcrt', p2pkh: 0x6f, p2sh: 0xc4 },
    sb: { name: 'Bitcoin simnet', segwit: 'sb', p2pkh: 0x3f, p2sh: 0x7b }
  };
  // msat per unit of each multiplier, as [numerator, divisor]
  var MULT = { '': [100000000000n, 1n], m: [100000000n, 1n], u: [100000n, 1n], n: [100n, 1n], p: [1n, 10n] };
  var FEATURES = {
    8: 'var_onion_optin', 14: 'payment_secret', 16: 'basic_mpp', 24: 'option_route_blinding',
    48: 'option_payment_metadata', 148: 'option_trampoline'
  };
  var TAGS = { 1: 'p', 16: 's', 13: 'd', 27: 'm', 19: 'n', 23: 'h', 6: 'x', 24: 'c', 9: 'f', 3: 'r', 5: '9' };

  function parseHrp(hrp) {
    var m = /^ln([a-z]+?)(?:(\d+)([a-z]?))?$/.exec(hrp);
    if (!m) throw new Error('Not a Lightning invoice (prefix must start with "ln")');
    var cur = m[1], digits = m[2], mult = m[3] || '';
    if (!NETWORKS[cur]) throw new Error('Unknown network prefix "ln' + cur + '"');
    var res = { prefix: 'ln' + cur, network: NETWORKS[cur].name, currency: cur, amountMsat: null };
    if (digits !== undefined) {
      if (!(mult in MULT)) throw new Error('Invalid amount multiplier "' + mult + '"');
      if (digits.length > 1 && digits[0] === '0') throw new Error('Amount has leading zeros');
      var v = BigInt(digits), f = MULT[mult];
      if ((v * f[0]) % f[1] !== 0n) throw new Error('Amount has sub-millisatoshi precision');
      res.amountMsat = v * f[0] / f[1];
      if (res.amountMsat === 0n) throw new Error('Amount is zero');
    }
    return res;
  }

  function decodeFeatures(words) {
    var bits = [], n = words.length * 5;
    for (var i = 0; i < words.length; i++)
      for (var b = 0; b < 5; b++)
        if ((words[i] >> (4 - b)) & 1) bits.push(n - 1 - (i * 5 + b));
    bits.sort(function (a, c) { return a - c; });
    return bits.map(function (bit) {
      var base = bit & ~1, name = FEATURES[base] || null;
      return { bit: bit, name: name, required: bit % 2 === 0, known: !!name };
    });
  }

  function cleanInput(s) {
    s = String(s || '').trim().replace(/\s+/g, '');
    if (/^lightning:/i.test(s)) s = s.slice(10);
    return s;
  }

  function decode(input, opts) {
    var str = cleanInput(input);
    if (!str) throw new Error('Empty input');
    if (/^lnurl/i.test(str)) throw new Error('This is an LNURL, not a BOLT11 invoice');
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(str)) throw new Error('This is a Lightning address, not a BOLT11 invoice');
    if (/^ln[oir]1/i.test(str)) throw new Error('This looks like a BOLT12 offer/invoice, not BOLT11');
    var dec = bech32Decode(str);
    var hdr = parseHrp(dec.hrp);
    var words = dec.words;
    if (words.length < 7 + 104) throw new Error('Invoice is too short');
    var errors = [], warnings = [];
    var sigWords = words.slice(-104), dataWords = words.slice(0, -104);
    var timestamp = wordsToInt(dataWords.slice(0, 7));
    var out = {
      invoice: str.toLowerCase(), prefix: hdr.prefix, network: hdr.network, currency: hdr.currency,
      amountMsat: hdr.amountMsat, timestamp: timestamp, expiry: 3600, minFinalCltvExpiry: 18,
      paymentHash: null, paymentSecret: null, description: null, descriptionHash: null, metadata: null,
      payeeNodeKey: null, payeeFromField: false, fallbacks: [], routeHints: [], features: [], unknownTags: [],
      signature: null, recoveryFlag: null, errors: errors, warnings: warnings
    };
    var seen = {}, nField = null, pos = 7;
    while (pos < dataWords.length) {
      if (pos + 3 > dataWords.length) throw new Error('Truncated tagged field');
      var type = dataWords[pos], len = dataWords[pos + 1] * 32 + dataWords[pos + 2];
      var fw = dataWords.slice(pos + 3, pos + 3 + len);
      if (fw.length !== len) throw new Error('Tagged field length exceeds data');
      pos += 3 + len;
      var tag = TAGS[type];
      if (!tag) { out.unknownTags.push({ type: CHARSET[type], length: len }); continue; }
      seen[tag] = (seen[tag] || 0) + 1;
      var fixed = { p: 52, h: 52, s: 52, n: 53 };
      if (fixed[tag] && len !== fixed[tag]) { errors.push('"' + tag + '" field has length ' + len + ' (expected ' + fixed[tag] + ')'); continue; }
      if ((tag === 'x' || tag === 'c' || tag === '9') && len > 0 && fw[0] === 0) warnings.push('"' + tag + '" field uses a non-minimal length');
      switch (tag) {
        case 'p':
          var ph = toHex(wordsToBytes(fw));
          if (out.paymentHash && out.paymentHash !== ph) errors.push('Multiple different payment hashes');
          else if (out.paymentHash) errors.push('Payment hash field repeated');
          if (!out.paymentHash) out.paymentHash = ph; break;
        case 's':
          var ps = toHex(wordsToBytes(fw));
          if (out.paymentSecret) errors.push(out.paymentSecret !== ps ? 'Multiple different payment secrets' : 'Payment secret field repeated');
          else out.paymentSecret = ps; break;
        case 'd':
          try { out.description = new TextDecoder('utf-8', { fatal: true }).decode(wordsToBytes(fw)); }
          catch (e) { errors.push('Description is not valid UTF-8'); } break;
        case 'h': out.descriptionHash = toHex(wordsToBytes(fw)); break;
        case 'm': out.metadata = toHex(wordsToBytes(fw)); break;
        case 'n': nField = toHex(wordsToBytes(fw)); break;
        case 'x': out.expiry = wordsToInt(fw); break;
        case 'c': out.minFinalCltvExpiry = wordsToInt(fw); break;
        case '9': out.features = decodeFeatures(fw); break;
        case 'f':
          if (!fw.length) break;
          var ver = fw[0], prog = wordsToBytes(fw.slice(1)), net = NETWORKS[hdr.currency], addr = null, kind = null;
          if (ver <= 16) { addr = bech32Encode(net.segwit, [ver].concat(fw.slice(1)), ver === 0 ? BECH32_CONST : BECH32M_CONST); kind = ver === 0 ? (prog.length === 20 ? 'P2WPKH' : 'P2WSH') : (ver === 1 ? 'P2TR' : 'Segwit v' + ver); }
          else if (ver === 17) { addr = base58check(net.p2pkh, prog); kind = 'P2PKH'; }
          else if (ver === 18) { addr = base58check(net.p2sh, prog); kind = 'P2SH'; }
          if (addr) out.fallbacks.push({ type: kind, address: addr });
          break;
        case 'r':
          var rb = wordsToBytes(fw), hops = [];
          if (rb.length % 51 !== 0) { warnings.push('Route hint has unexpected length'); break; }
          for (var i = 0; i < rb.length; i += 51) {
            var dv = new DataView(rb.buffer, rb.byteOffset + i, 51);
            hops.push({
              pubkey: toHex(rb.slice(i, i + 33)),
              shortChannelId: ((rb[i + 33] << 16) | (rb[i + 34] << 8) | rb[i + 35]) + 'x' + ((rb[i + 36] << 16) | (rb[i + 37] << 8) | rb[i + 38]) + 'x' + dv.getUint16(39),
              feeBaseMsat: dv.getUint32(41), feeProportionalMillionths: dv.getUint32(45), cltvExpiryDelta: dv.getUint16(49)
            });
          }
          out.routeHints.push(hops); break;
      }
    }
    // Signature
    var sigBytes = wordsToBytes(sigWords);
    out.signature = toHex(sigBytes.slice(0, 64)); out.recoveryFlag = sigBytes[64];
    var hrpBytes = utf8(dec.hrp), dataBytes = convertBits(dataWords, 5, 8, true);
    var pre = new Uint8Array(hrpBytes.length + dataBytes.length); pre.set(hrpBytes); pre.set(dataBytes, hrpBytes.length);
    var hash = sha256(pre);
    var rec = recoverPubkey(hash, sigBytes.slice(0, 64), sigBytes[64]); // throws if unrecoverable
    if (nField) {
      out.payeeNodeKey = nField; out.payeeFromField = true;
      if (rec.pubkey !== nField) errors.push('Signature does not match the payee key in the "n" field');
      if (rec.highS) errors.push('Signature is not low-S, required when an "n" field is present');
    } else out.payeeNodeKey = rec.pubkey;
    out.signatureValid = !nField || rec.pubkey === nField;

    // Reader requirements
    if (!seen.p) errors.push('Missing payment hash ("p" field)');
    if (!seen.s) errors.push('Missing payment secret ("s" field)');
    var hasD = out.description !== null || seen.d, hasH = !!out.descriptionHash;
    if (!hasD && !hasH) errors.push('Missing description ("d" or "h" field)');
    if (hasD && hasH) errors.push('Has both a description and a description hash');
    out.features.forEach(function (f) { if (f.required && !f.known) errors.push('Unknown required feature bit ' + f.bit); });
    out.expiresAt = timestamp + out.expiry;
    out.valid = errors.length === 0;
    return out;
  }

  function isExpired(inv, nowSec) { return (nowSec === undefined ? Date.now() / 1000 : nowSec) >= inv.expiresAt; }
  function formatSats(msat) {
    if (msat === null || msat === undefined) return null;
    var sats = msat / 1000n, rem = msat % 1000n;
    var s = sats.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return rem ? s + '.' + rem.toString().padStart(3, '0').replace(/0+$/, '') : s;
  }
  function formatBtc(msat) {
    if (msat === null || msat === undefined) return null;
    var whole = msat / 100000000000n, frac = (msat % 100000000000n).toString().padStart(11, '0').replace(/0+$/, '');
    return whole.toString() + (frac ? '.' + frac : '');
  }

  return { decode: decode, isExpired: isExpired, formatSats: formatSats, formatBtc: formatBtc,
    _internal: { sha256: sha256, toHex: toHex, bech32Decode: bech32Decode, recoverPubkey: recoverPubkey, parseHrp: parseHrp } };
});
