// Run: node --test test/bolt11.test.js   (Node 18+)
const test = require('node:test');
const assert = require('node:assert');
const B = require('../bolt11.js');
const vectors = require('./invoice-test.json');
const PEER = '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad';
const HASH = '0001020304050607080900010203040506070809000102030405060708090102';
const SECRET = '11'.repeat(32);

test('sha256 known vectors', () => {
  const h = (s) => B._internal.toHex(B._internal.sha256(new TextEncoder().encode(s)));
  assert.strictEqual(h(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.strictEqual(h('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.strictEqual(h('a'.repeat(1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
});

for (const v of vectors) {
  test(`${v.valid ? 'valid' : 'INVALID'}: ${v.description.slice(0, 70)}`, () => {
    let r, err;
    try { r = B.decode(v.invoice); } catch (e) { err = e; }
    if (v.valid) {
      assert.ok(!err, err && err.message);
      assert.deepStrictEqual(r.errors, [], 'unexpected errors: ' + r.errors.join('; '));
      assert.strictEqual(r.valid, true);
    } else {
      assert.ok(err || (r && r.valid === false && r.errors.length > 0), 'invalid invoice was accepted');
    }
  });
}

const V = (prefix) => vectors.find((v) => v.description.startsWith(prefix)).invoice;

test('donation: no amount, description, recovered payee, timestamp, defaults', () => {
  const r = B.decode(V('Please make a donation'));
  assert.strictEqual(r.amountMsat, null);
  assert.strictEqual(r.network, 'Bitcoin mainnet');
  assert.strictEqual(r.timestamp, 1496314658);
  assert.strictEqual(r.paymentHash, HASH);
  assert.strictEqual(r.paymentSecret, SECRET);
  assert.strictEqual(r.description, 'Please consider supporting this project');
  assert.strictEqual(r.payeeNodeKey, PEER);
  assert.strictEqual(r.payeeFromField, false);
  assert.strictEqual(r.expiry, 3600);
  assert.strictEqual(r.minFinalCltvExpiry, 18);
  assert.strictEqual(r.recoveryFlag, 1);
  assert.deepStrictEqual(r.features.map((f) => f.bit), [8, 14]);
});

test('coffee: 2500u = 250,000 sat, 60s expiry, expiry math', () => {
  const r = B.decode(V('Please send $3'));
  assert.strictEqual(r.amountMsat, 250000000n);
  assert.strictEqual(B.formatSats(r.amountMsat), '250,000');
  assert.strictEqual(B.formatBtc(r.amountMsat), '0.0025');
  assert.strictEqual(r.description, '1 cup coffee');
  assert.strictEqual(r.expiry, 60);
  assert.strictEqual(r.expiresAt, 1496314718);
  assert.strictEqual(B.isExpired(r, 1496314700), false);
  assert.strictEqual(B.isExpired(r, 1496314718), true);
  assert.strictEqual(r.payeeNodeKey, PEER);
});

test('UTF-8 description', () => {
  assert.strictEqual(B.decode(V('Please send 0.0025 BTC')).description, 'ナンセンス 1杯');
});

test('description hash', () => {
  const r = B.decode(V('Now send $24'));
  assert.strictEqual(r.amountMsat, 2000000000n);
  assert.strictEqual(r.descriptionHash, '3925b6f67e2c340036ed12093dd44e0368df1b6ea26c53dbe4811f58fd5db8c1');
  assert.strictEqual(r.description, null);
});

test('fallback addresses (all types) and testnet', () => {
  const t = B.decode(V('The same, on testnet'));
  assert.strictEqual(t.network, 'Bitcoin testnet');
  assert.deepStrictEqual(t.fallbacks, [{ type: 'P2PKH', address: 'mk2QpYatsKicvFVuTAQLBryyccRXMUaGHP' }]);
  assert.strictEqual(B.decode(V('On mainnet, with fallback (P2SH)')).fallbacks[0].address, '3EktnHQD7RiAE6uzMj2ZifT9YgRrkSgzQX');
  assert.strictEqual(B.decode(V('On mainnet, with fallback (P2WPKH)')).fallbacks[0].address, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  assert.strictEqual(B.decode(V('On mainnet, with fallback (P2WSH)')).fallbacks[0].address, 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3');
  assert.strictEqual(B.decode(V('On mainnet, with fallback (P2TR)')).fallbacks[0].address, 'bc1pptdvg0d2nj99568qn6ssdy4cygnwuxgw2ukmnwgwz7jpqjz2kszse2s3lm');
});

test('route hints', () => {
  const r = B.decode(V('On mainnet, with fallback address 1Rusty'));
  assert.strictEqual(r.fallbacks[0].address, '1RustyRX2oai4EYYDpQGWvEL62BBGqN9T');
  assert.deepStrictEqual(r.routeHints, [[
    { pubkey: '029e03a901b85534ff1e92c43c74431f7ce72046060fcf7a95c37e148f78c77255', shortChannelId: '66051x263430x1800', feeBaseMsat: 1, feeProportionalMillionths: 20, cltvExpiryDelta: 3 },
    { pubkey: '039e03a901b85534ff1e92c43c74431f7ce72046060fcf7a95c37e148f78c77255', shortChannelId: '197637x395016x2314', feeBaseMsat: 2, feeProportionalMillionths: 30, cltvExpiryDelta: 4 }
  ]]);
});

test('pico-BTC amount, 1 week expiry, cltv 10', () => {
  const r = B.decode(V('Please send 0.00967878534'));
  assert.strictEqual(r.amountMsat, 967878534n);
  assert.strictEqual(B.formatSats(r.amountMsat), '967,878.534');
  assert.strictEqual(B.formatBtc(r.amountMsat), '0.00967878534');
  assert.strictEqual(r.timestamp, 1572468703);
  assert.strictEqual(r.expiry, 604800);
  assert.strictEqual(r.minFinalCltvExpiry, 10);
  assert.strictEqual(r.paymentHash, '462264ede7e14047e9b249da94fefc47f41f7d02ee9b091815a5506bc8abf75f');
  assert.deepStrictEqual(r.routeHints[0][0], { pubkey: '03d06758583bb5154774a6eb221b1276c9e82d65bbaceca806d90e20c108f4b1c7', shortChannelId: '589390x3312x1', feeBaseMsat: 1000, feeProportionalMillionths: 2500, cltvExpiryDelta: 40 });
});

test('features 8, 14, 99 and upper case, lightning: prefix, whitespace', () => {
  const inv = V('Please send $30');
  const r = B.decode(inv);
  assert.deepStrictEqual(r.features.map((f) => f.bit), [8, 14, 99]);
  assert.strictEqual(r.features.find((f) => f.bit === 99).known, false);
  const up = B.decode(V('Same, but all upper case'));
  assert.strictEqual(up.paymentHash, r.paymentHash);
  assert.strictEqual(up.payeeNodeKey, PEER);
  assert.strictEqual(B.decode('  lightning:' + inv.toUpperCase() + '\n').amountMsat, 2500000000n);
});

test('payment metadata', () => {
  assert.strictEqual(B.decode(V('Please send 0.01 BTC with payment metadata')).metadata, '01fafaf0');
});

test('high-S signature: recovery still yields payee', () => {
  assert.strictEqual(B.decode(V('Public-key recovery with high-S')).payeeNodeKey, PEER);
});

test('non-invoice inputs give helpful errors', () => {
  assert.throws(() => B.decode('pluckymotor700@walletofsatoshi.com'), /Lightning address/);
  assert.throws(() => B.decode('LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS'), /LNURL/);
  assert.throws(() => B.decode('lno1pqps7sjqpgtyzm3qv4uxzmtsd3jjqer9wd3hy6tsw35k7msjzfpy7nz5yqcnygrfdej82um5wf5k2uckyypwa3eyt44h6txtxquqh7lz5djge4afgfjn7k4rgrkuag0jsd5xvxg'), /BOLT12/);
  assert.throws(() => B.decode(''), /Empty/);
});
