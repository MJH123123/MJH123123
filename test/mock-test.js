'use strict';
// Spins up a tiny fake Micro800 EtherNet/IP server and exercises the client.
const net = require('net');
const assert = require('assert');
const { Micro800Client } = require('../lib/micro800-client');

const tags = {
  Counter: { code: 0xc4, buf: Buffer.from([42, 0, 0, 0]) },
  Running: { code: 0xc1, buf: Buffer.from([1]) },
  Temp: { code: 0xca, buf: (() => { const b = Buffer.alloc(4); b.writeFloatLE(21.5); return b; })() },
  Name: { code: 0xda, buf: Buffer.concat([Buffer.from([5]), Buffer.from('hello')]) },
  'Arr[0]': { code: 0xc3, buf: Buffer.from([7, 0]) }
};

function parsePath(b, off, words) {
  let s = '', i = off; const end = off + words * 2;
  while (i < end) {
    if (b[i] === 0x91) { const l = b[i + 1]; if (s) s += '.'; s += b.toString('ascii', i + 2, i + 2 + l); i += 2 + l + (l % 2); }
    else if (b[i] === 0x28) { s += `[${b[i + 1]}]`; i += 2; }
    else throw new Error('bad seg');
  }
  return { tag: s, next: end };
}

const server = net.createServer((sock) => {
  let rx = Buffer.alloc(0);
  sock.on('data', (d) => {
    rx = Buffer.concat([rx, d]);
    while (rx.length >= 24 && rx.length >= 24 + rx.readUInt16LE(2)) {
      const len = rx.readUInt16LE(2);
      const f = rx.slice(0, 24 + len); rx = rx.slice(24 + len);
      const cmd = f.readUInt16LE(0);
      if (cmd === 0x65) {
        const h = Buffer.alloc(28);
        h.writeUInt16LE(0x65, 0); h.writeUInt16LE(4, 2); h.writeUInt32LE(0xdeadbeef, 4); h.writeUInt16LE(1, 24);
        sock.write(h);
        continue;
      }
      if (cmd === 0x6f) {
        const cip = f.slice(40);
        const svc = cip[0];
        const { tag, next } = parsePath(cip, 2, cip[1]);
        let reply;
        const t = tags[tag];
        if (!t) reply = Buffer.from([svc | 0x80, 0, 0x04, 0]);
        else if (svc === 0x4c) { const tc = Buffer.alloc(2); tc.writeUInt16LE(t.code); reply = Buffer.concat([Buffer.from([0xcc, 0, 0, 0]), tc, t.buf]); }
        else { t.buf = cip.slice(next + 4); reply = Buffer.from([0xcd, 0, 0, 0]); }
        const data = Buffer.alloc(16 + reply.length);
        data.writeUInt16LE(2, 6); data.writeUInt16LE(0xb2, 12); data.writeUInt16LE(reply.length, 14); reply.copy(data, 16);
        const hh = Buffer.alloc(24); hh.writeUInt16LE(0x6f, 0); hh.writeUInt16LE(data.length, 2); hh.writeUInt32LE(0xdeadbeef, 4);
        sock.write(Buffer.concat([hh, data]));
      }
    }
  });
});

server.listen(0, '127.0.0.1', async () => {
  const c = new Micro800Client({ host: '127.0.0.1', port: server.address().port, timeout: 1500 });
  try {
    assert.deepStrictEqual(await c.readTag('Counter'), { value: 42, type: 'DINT' });
    assert.strictEqual((await c.readTag('Running')).value, true);
    assert.strictEqual((await c.readTag('Temp')).value, 21.5);
    assert.strictEqual((await c.readTag('Name')).value, 'hello');
    assert.strictEqual((await c.readTag('Arr[0]')).value, 7);
    await c.writeTag('Counter', 1234);              // auto type
    assert.strictEqual((await c.readTag('Counter')).value, 1234);
    await c.writeTag('Name', 'abc', 'SSTRING');
    assert.strictEqual((await c.readTag('Name')).value, 'abc');
    await assert.rejects(c.readTag('Missing'), /0x4/);
    await assert.rejects(c.writeTag('Counter', 'x', 'DINT'), /not valid/);
    console.log('ALL TESTS PASSED');
  } catch (e) { console.error('TEST FAILED:', e); process.exitCode = 1; }
  c.close(); server.close();
});
