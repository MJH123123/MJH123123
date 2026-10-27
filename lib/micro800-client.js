'use strict';
/**
 * Minimal EtherNet/IP + CIP client for Allen-Bradley Micro800 (Micro820/830/850/870).
 * Zero dependencies: uses only Node's built-in `net` module.
 *
 * Key difference from ControlLogix libraries: NO backplane / slot route path.
 * Requests go straight to the Message Router (class 0x02, instance 1) using
 * unconnected explicit messaging (SendRRData), which Micro800 accepts.
 */
const net = require('net');
const { EventEmitter } = require('events');

const CMD = { REGISTER: 0x0065, UNREGISTER: 0x0066, SEND_RR_DATA: 0x006f };
const SVC = { READ: 0x4c, WRITE: 0x4d };

const TYPE_CODES = {
  BOOL: 0xc1, SINT: 0xc2, INT: 0xc3, DINT: 0xc4, LINT: 0xc5,
  USINT: 0xc6, UINT: 0xc7, UDINT: 0xc8, ULINT: 0xc9,
  REAL: 0xca, LREAL: 0xcb,
  STRING: 0xd0,   // CIP STRING: u16 length + chars
  SSTRING: 0xda   // CIP SHORT_STRING: u8 length + chars (typical Micro800 STRING)
};
const TYPE_NAMES = {};
Object.keys(TYPE_CODES).forEach((k) => { TYPE_NAMES[TYPE_CODES[k]] = k; });

const CIP_ERRORS = {
  0x01: 'Connection failure',
  0x04: 'Path segment error (tag does not exist or is not exposed - check Global Variable external access in CCW)',
  0x05: 'Path destination unknown (tag not found)',
  0x08: 'Service not supported',
  0x0f: 'Permission denied (tag is read-only / not writable)',
  0x10: 'Device state conflict',
  0x13: 'Not enough data (value size mismatch)',
  0x14: 'Attribute not supported',
  0x15: 'Too much data (value size mismatch)',
  0x16: 'Object does not exist',
  0x1e: 'Embedded service error',
  0x26: 'Path size invalid',
  0xff: 'General error'
};

class CipError extends Error {
  constructor(status, ext) {
    const text = CIP_ERRORS[status] || 'Unknown CIP error';
    super(`CIP error 0x${status.toString(16)}: ${text}` + (ext && ext.length ? ` (ext: ${ext.join(',')})` : ''));
    this.name = 'CipError';
    this.status = status;
  }
}

/* ------------------------------ helpers ------------------------------ */

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }

/** Encode a symbolic tag path, e.g. "MyTag", "Struct.Member", "Arr[3]", "Arr[1,2]" */
function encodePath(tag) {
  if (typeof tag !== 'string' || !tag.length) throw new Error('Tag name is empty');
  const segs = [];
  for (const part of tag.split('.')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[\d+(?:,\d+)*\])*)$/.exec(part);
    if (!m) throw new Error(`Invalid tag syntax: "${tag}"`);
    const name = Buffer.from(m[1], 'ascii');
    segs.push(Buffer.from([0x91, name.length]), name);
    if (name.length % 2) segs.push(Buffer.from([0]));
    if (m[2]) {
      for (const s of m[2].match(/\d+/g)) {
        const n = parseInt(s, 10);
        if (n < 0x100) segs.push(Buffer.from([0x28, n]));
        else if (n < 0x10000) segs.push(Buffer.from([0x29, 0]), u16(n));
        else { const b = Buffer.alloc(6); b[0] = 0x2a; b.writeUInt32LE(n, 2); segs.push(b); }
      }
    }
  }
  const path = Buffer.concat(segs);
  return Buffer.concat([Buffer.from([path.length / 2]), path]);
}

function big(v) { const n = Number(v); return Number.isSafeInteger(n) ? n : v.toString(); }

function decodeOne(code, b, o) {
  switch (code) {
    case 0xc1: return { v: b[o] !== 0, n: 1 };
    case 0xc2: return { v: b.readInt8(o), n: 1 };
    case 0xc3: return { v: b.readInt16LE(o), n: 2 };
    case 0xc4: return { v: b.readInt32LE(o), n: 4 };
    case 0xc5: return { v: big(b.readBigInt64LE(o)), n: 8 };
    case 0xc6: return { v: b.readUInt8(o), n: 1 };
    case 0xc7: return { v: b.readUInt16LE(o), n: 2 };
    case 0xc8: return { v: b.readUInt32LE(o), n: 4 };
    case 0xc9: return { v: big(b.readBigUInt64LE(o)), n: 8 };
    case 0xca: return { v: b.readFloatLE(o), n: 4 };
    case 0xcb: return { v: b.readDoubleLE(o), n: 8 };
    case 0xda: { const l = b[o]; return { v: b.toString('latin1', o + 1, o + 1 + l), n: 1 + l }; }
    case 0xd0: { const l = b.readUInt16LE(o); return { v: b.toString('latin1', o + 2, o + 2 + l), n: 2 + l }; }
    default: throw new Error(`Unsupported data type 0x${code.toString(16)}`);
  }
}

function toBool(v) {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'off' || s === '') return false;
    throw new Error(`Cannot convert "${v}" to BOOL`);
  }
  return !!v;
}
function int(v, min, max, type) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Value "${v}" is not valid for ${type} (${min}..${max})`);
  return n;
}

function encodeOne(type, v) {
  let b;
  switch (type) {
    case 'BOOL': return Buffer.from([toBool(v) ? 1 : 0]);
    case 'SINT': b = Buffer.alloc(1); b.writeInt8(int(v, -128, 127, type)); return b;
    case 'USINT': b = Buffer.alloc(1); b.writeUInt8(int(v, 0, 255, type)); return b;
    case 'INT': b = Buffer.alloc(2); b.writeInt16LE(int(v, -32768, 32767, type)); return b;
    case 'UINT': b = Buffer.alloc(2); b.writeUInt16LE(int(v, 0, 65535, type)); return b;
    case 'DINT': b = Buffer.alloc(4); b.writeInt32LE(int(v, -2147483648, 2147483647, type)); return b;
    case 'UDINT': b = Buffer.alloc(4); b.writeUInt32LE(int(v, 0, 4294967295, type)); return b;
    case 'LINT': b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b;
    case 'ULINT': b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b;
    case 'REAL': b = Buffer.alloc(4); b.writeFloatLE(Number(v)); return b;
    case 'LREAL': b = Buffer.alloc(8); b.writeDoubleLE(Number(v)); return b;
    case 'SSTRING': {
      const s = Buffer.from(String(v), 'latin1');
      if (s.length > 255) throw new Error('String longer than 255 characters');
      return Buffer.concat([Buffer.from([s.length]), s]);
    }
    case 'STRING': {
      const s = Buffer.from(String(v), 'latin1');
      return Buffer.concat([u16(s.length), s]);
    }
    default: throw new Error(`Unsupported data type "${type}"`);
  }
}

/** Parse a CIP reply; returns the data after the status header, or throws CipError */
function parseCipReply(buf, svc) {
  if (buf.length < 4) throw new Error('CIP reply too short');
  if (buf[0] !== (svc | 0x80)) throw new Error(`Unexpected CIP reply service 0x${buf[0].toString(16)}`);
  const status = buf[2];
  const extWords = buf[3];
  if (status !== 0) {
    const ext = [];
    for (let i = 0; i < extWords && 4 + i * 2 + 2 <= buf.length; i++) ext.push('0x' + buf.readUInt16LE(4 + i * 2).toString(16));
    throw new CipError(status, ext);
  }
  return buf.slice(4 + extWords * 2);
}

/* ------------------------------ client ------------------------------ */

class Micro800Client extends EventEmitter {
  constructor(opts) {
    super();
    opts = opts || {};
    this.host = opts.host;
    this.port = opts.port || 44818;
    this.timeout = opts.timeout || 5000;
    this.sock = null;
    this.session = null;
    this.pending = null;
    this.rx = Buffer.alloc(0);
    this.types = new Map();       // tag -> type name cache
    this._connecting = null;
    this._chain = Promise.resolve();
    this.connected = false;
  }

  connect() { return this._ensure(); }

  close() {
    if (this.sock && this.session !== null) {
      try {
        const h = Buffer.alloc(24);
        h.writeUInt16LE(CMD.UNREGISTER, 0);
        h.writeUInt32LE(this.session, 4);
        this.sock.write(h);
      } catch (e) { /* ignore */ }
    }
    this._teardown(new Error('Client closed'));
  }

  /** Read a tag. count > 1 reads an array slice starting at the given element. */
  async readTag(tag, count) {
    count = count || 1;
    const req = Buffer.concat([Buffer.from([SVC.READ]), encodePath(tag), u16(count)]);
    const data = parseCipReply(await this.request(req), SVC.READ);
    if (data.length < 2) throw new Error('Empty read reply');
    const code = data.readUInt16LE(0);
    const type = TYPE_NAMES[code];
    if (!type) throw new Error(`Unsupported data type 0x${code.toString(16)} for tag "${tag}"`);
    this.types.set(tag, type);
    const vals = [];
    let off = 2;
    for (let i = 0; i < count && off < data.length; i++) {
      const r = decodeOne(code, data, off);
      vals.push(r.v);
      off += r.n;
    }
    return { value: count === 1 ? vals[0] : vals, type };
  }

  /** Write a tag. type: a type name or "auto" (looks it up with a read, then caches). */
  async writeTag(tag, value, type) {
    let name = type && String(type).toLowerCase() !== 'auto' ? String(type).toUpperCase() : this.types.get(tag);
    if (!name) { await this.readTag(tag); name = this.types.get(tag); }
    const code = TYPE_CODES[name];
    if (!code) throw new Error(`Unsupported data type "${name}"`);
    const arr = Array.isArray(value) ? value : [value];
    const data = Buffer.concat(arr.map((v) => encodeOne(name, v)));
    const req = Buffer.concat([Buffer.from([SVC.WRITE]), encodePath(tag), u16(code), u16(arr.length), data]);
    parseCipReply(await this.request(req), SVC.WRITE);
    return { type: name };
  }

  /** Send a raw CIP request to the Message Router. Requests are serialised. */
  request(cip) {
    const run = () => this._ensure().then(() => this._sendRR(cip));
    const p = this._chain.then(run);
    this._chain = p.catch(() => {});
    return p;
  }

  /* ---------------- internals ---------------- */

  _ensure() {
    if (this.sock && this.session !== null) return Promise.resolve();
    if (!this._connecting) {
      this._connecting = this._open().then(
        () => { this._connecting = null; },
        (e) => { this._connecting = null; throw e; }
      );
    }
    return this._connecting;
  }

  _open() {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      sock.setNoDelay(true);
      let settled = false;
      const fail = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        reject(e);
      };
      const timer = setTimeout(() => fail(new Error(`Connection to ${this.host}:${this.port} timed out`)), this.timeout);
      sock.once('error', fail);
      sock.connect(this.port, this.host, async () => {
        if (settled) return;
        sock.removeListener('error', fail);
        this.sock = sock;
        this.rx = Buffer.alloc(0);
        sock.on('data', (d) => this._onData(d));
        sock.on('error', (e) => this._teardown(e));
        sock.on('close', () => this._teardown(new Error('Connection closed by PLC')));
        try {
          const data = Buffer.alloc(4);
          data.writeUInt16LE(1, 0); // protocol version
          const frame = await this._exchange(CMD.REGISTER, data);
          const status = frame.readUInt32LE(8);
          if (status !== 0) throw new Error(`RegisterSession failed, status 0x${status.toString(16)}`);
          this.session = frame.readUInt32LE(4);
          settled = true;
          clearTimeout(timer);
          this.connected = true;
          this.emit('connected');
          resolve();
        } catch (e) {
          fail(e);
          this._teardown(e);
        }
      });
    });
  }

  _teardown(err) {
    const sock = this.sock;
    const wasConnected = this.connected;
    this.sock = null;
    this.session = null;
    this.connected = false;
    this.rx = Buffer.alloc(0);
    if (sock) {
      sock.removeAllListeners();
      sock.on('error', () => {});
      sock.destroy();
    }
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.reject(err);
    }
    if (wasConnected) this.emit('disconnected', err);
  }

  _onData(chunk) {
    this.rx = Buffer.concat([this.rx, chunk]);
    while (this.rx.length >= 24) {
      const len = this.rx.readUInt16LE(2);
      if (this.rx.length < 24 + len) break;
      const frame = this.rx.slice(0, 24 + len);
      this.rx = this.rx.slice(24 + len);
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        p.resolve(frame);
      }
    }
  }

  _exchange(cmd, data) {
    return new Promise((resolve, reject) => {
      const sock = this.sock;
      if (!sock) return reject(new Error('Not connected'));
      const h = Buffer.alloc(24);
      h.writeUInt16LE(cmd, 0);
      h.writeUInt16LE(data.length, 2);
      h.writeUInt32LE(this.session || 0, 4);
      const timer = setTimeout(() => {
        const e = new Error(`No response from PLC within ${this.timeout} ms`);
        this.pending = null;
        this._teardown(e);
        reject(e);
      }, this.timeout);
      this.pending = {
        resolve: (f) => { clearTimeout(timer); resolve(f); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      };
      sock.write(Buffer.concat([h, data]));
    });
  }

  async _sendRR(cip) {
    const data = Buffer.alloc(16 + cip.length);
    data.writeUInt32LE(0, 0);              // interface handle (CIP)
    data.writeUInt16LE(10, 4);             // timeout (s)
    data.writeUInt16LE(2, 6);              // item count
    data.writeUInt16LE(0x0000, 8);         // null address item
    data.writeUInt16LE(0, 10);
    data.writeUInt16LE(0x00b2, 12);        // unconnected data item
    data.writeUInt16LE(cip.length, 14);
    cip.copy(data, 16);
    const frame = await this._exchange(CMD.SEND_RR_DATA, data);
    const status = frame.readUInt32LE(8);
    if (status !== 0) throw new Error(`EtherNet/IP encapsulation error 0x${status.toString(16)}`);
    const count = frame.readUInt16LE(30);
    let off = 32;
    for (let i = 0; i < count; i++) {
      const type = frame.readUInt16LE(off);
      const len = frame.readUInt16LE(off + 2);
      if (type === 0x00b2) return frame.slice(off + 4, off + 4 + len);
      off += 4 + len;
    }
    throw new Error('No CIP data item in reply');
  }
}

module.exports = { Micro800Client, CipError, encodePath, TYPE_CODES, TYPE_NAMES };
