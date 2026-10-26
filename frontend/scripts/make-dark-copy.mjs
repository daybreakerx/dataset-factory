#!/usr/bin/env node
/**
 * 暗色稿就位：克隆亮色页面稿 → 改名加「·暗」→ 排到亮色稿右侧（x=1560，同 y）。
 * 只做克隆与就位，不做重绑——重绑跑 rebind-figma-dark.mjs。
 *
 * 用法：node scripts/make-dark-copy.mjs <lightNodeId>
 * 输出：stdout 仅打印新副本节点 id（供脚本串联）；过程日志走 stderr。
 */
import fs from 'node:fs';
import path from 'node:path';

const RPC = 'http://127.0.0.1:3055/rpc';
const DARK_X_OFFSET = 1560; // 亮色稿宽 1440 ＋ 120 间距
const lightId = process.argv[2];
if (!lightId) {
  console.error('用法：node scripts/make-dark-copy.mjs <lightNodeId>');
  process.exit(1);
}

// msgpack 编解码与 sync-figma-variables.mjs 同一套（见该文件注释）
function encode(value) {
  const chunks = [];
  const push = (bytes) => chunks.push(Buffer.from(bytes));
  const writeString = (s) => {
    const b = Buffer.from(s, 'utf8');
    if (b.length < 32) push([0xa0 | b.length]);
    else if (b.length < 256) push([0xd9, b.length]);
    else if (b.length < 65536) push([0xda, (b.length >> 8) & 0xff, b.length & 0xff]);
    else push([0xdb, (b.length >>> 24) & 0xff, (b.length >>> 16) & 0xff, (b.length >>> 8) & 0xff, b.length & 0xff]);
    chunks.push(b);
  };
  const writeNumber = (n) => {
    if (!Number.isInteger(n)) {
      const b = Buffer.alloc(9);
      b[0] = 0xcb;
      b.writeDoubleBE(n, 1);
      chunks.push(b);
    } else if (n >= 0 && n <= 0x7f) push([n]);
    else if (n < 0 && n >= -32) push([0xe0 | (n + 32)]);
    else if (n >= 0 && n <= 0xff) push([0xcc, n]);
    else if (n >= 0 && n <= 0xffff) push([0xcd, (n >> 8) & 0xff, n & 0xff]);
    else if (n >= 0 && n <= 0xffffffff) push([0xce, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
    else if (n >= 0) {
      const b = Buffer.alloc(9);
      b[0] = 0xcf;
      b.writeBigUInt64BE(BigInt(n), 1);
      chunks.push(b);
    } else if (n >= -128) push([0xd0, n & 0xff]);
    else if (n >= -32768) push([0xd1, n & 0xffff]);
    else if (n >= -2147483648) {
      const b = Buffer.alloc(5);
      b[0] = 0xd2;
      b.writeInt32BE(n, 1);
      chunks.push(b);
    } else {
      const b = Buffer.alloc(9);
      b[0] = 0xd3;
      b.writeBigInt64BE(BigInt(n), 1);
      chunks.push(b);
    }
  };
  const write = (v) => {
    if (v === null || v === undefined) push([0xc0]);
    else if (typeof v === 'boolean') push([v ? 0xc3 : 0xc2]);
    else if (typeof v === 'number') writeNumber(v);
    else if (typeof v === 'string') writeString(v);
    else if (Array.isArray(v)) {
      if (v.length < 16) push([0x90 | v.length]);
      else if (v.length < 65536) push([0xdc, (v.length >> 8) & 0xff, v.length & 0xff]);
      else push([0xdd, (v.length >>> 24) & 0xff, (v.length >>> 16) & 0xff, (v.length >>> 8) & 0xff, v.length & 0xff]);
      for (const item of v) write(item);
    } else if (typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length < 16) push([0x80 | keys.length]);
      else if (keys.length < 65536) push([0xde, (keys.length >> 8) & 0xff, keys.length & 0xff]);
      else push([0xdf, (keys.length >>> 24) & 0xff, (keys.length >>> 16) & 0xff, (keys.length >>> 8) & 0xff, keys.length & 0xff]);
      for (const key of keys) {
        writeString(key);
        write(v[key]);
      }
    } else throw new Error(`无法编码的类型：${typeof v}`);
  };
  write(value);
  return Buffer.concat(chunks);
}

function decode(buffer) {
  let pos = 0;
  const readString = (len) => {
    const s = buffer.toString('utf8', pos, pos + len);
    pos += len;
    return s;
  };
  const readArray = (len) => {
    const out = [];
    for (let i = 0; i < len; i++) out.push(read());
    return out;
  };
  const readMap = (len) => {
    const out = {};
    for (let i = 0; i < len; i++) {
      const key = read();
      out[String(key)] = read();
    }
    return out;
  };
  const read = () => {
    const byte = buffer[pos++];
    if (byte <= 0x7f) return byte;
    if (byte >= 0xe0) return byte - 0x100;
    if ((byte & 0xf0) === 0x80) return readMap(byte & 0x0f);
    if ((byte & 0xf0) === 0x90) return readArray(byte & 0x0f);
    if ((byte & 0xe0) === 0xa0) return readString(byte & 0x1f);
    switch (byte) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: { const len = buffer[pos++]; const value = buffer.subarray(pos, pos + len); pos += len; return value; }
      case 0xc5: { const len = buffer.readUInt16BE(pos); pos += 2; const value = buffer.subarray(pos, pos + len); pos += len; return value; }
      case 0xc6: { const len = buffer.readUInt32BE(pos); pos += 4; const value = buffer.subarray(pos, pos + len); pos += len; return value; }
      case 0xca: { const value = buffer.readFloatBE(pos); pos += 4; return value; }
      case 0xcb: { const value = buffer.readDoubleBE(pos); pos += 8; return value; }
      case 0xcc: return buffer[pos++];
      case 0xcd: { const value = buffer.readUInt16BE(pos); pos += 2; return value; }
      case 0xce: { const value = buffer.readUInt32BE(pos); pos += 4; return value; }
      case 0xcf: { const value = Number(buffer.readBigUInt64BE(pos)); pos += 8; return value; }
      case 0xd0: return buffer.readInt8(pos++);
      case 0xd1: { const value = buffer.readInt16BE(pos); pos += 2; return value; }
      case 0xd2: { const value = buffer.readInt32BE(pos); pos += 4; return value; }
      case 0xd3: { const value = Number(buffer.readBigInt64BE(pos)); pos += 8; return value; }
      case 0xd9: return readString(buffer[pos++]);
      case 0xda: { const len = buffer.readUInt16BE(pos); pos += 2; return readString(len); }
      case 0xdb: { const len = buffer.readUInt32BE(pos); pos += 4; return readString(len); }
      case 0xdc: { const len = buffer.readUInt16BE(pos); pos += 2; return readArray(len); }
      case 0xdd: { const len = buffer.readUInt32BE(pos); pos += 4; return readArray(len); }
      case 0xde: { const len = buffer.readUInt16BE(pos); pos += 2; return readMap(len); }
      case 0xdf: { const len = buffer.readUInt32BE(pos); pos += 4; return readMap(len); }
      default: throw new Error(`无法解码的 msgpack 字节：0x${byte.toString(16)}`);
    }
  };
  const value = read();
  if (pos !== buffer.length) throw new Error(`msgpack 尾部有 ${buffer.length - pos} 字节未解码`);
  return value;
}

let requestSeq = 0;
async function rpc(toolName, args) {
  const body = encode({ requestId: `df-dark-pair-${++requestSeq}`, toolName, args });
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/msgpack' },
    body
  });
  if (!res.ok) throw new Error(`${toolName} 请求失败：HTTP ${res.status}`);
  const message = decode(Buffer.from(await res.arrayBuffer()));
  if (message.kind !== 'ok') {
    const detail = message.error ?? message.message ?? message;
    throw new Error(`${toolName} 执行失败：${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return message.result;
}

const { node: light } = await rpc('get_node', { nodeId: lightId });
if (!light) throw new Error(`亮色稿不存在：${lightId}`);
if (light.name.endsWith('·暗')) throw new Error(`${lightId} 已是暗色稿（${light.name}），请传亮色稿 id`);
console.error(`亮色稿：${light.name}(${lightId}) @ (${light.x}, ${light.y}) ${light.width}×${light.height}`);

const cloned = await rpc('clone_node', { nodeId: lightId });
const cloneId = cloned.nodeId;
console.error(`已克隆：${cloneId}`);

await rpc('rename_node', { nodeId: cloneId, name: `${light.name} ·暗` });
await rpc('set_position', { nodeId: cloneId, x: light.x + DARK_X_OFFSET, y: light.y });
console.error(`已就位：(${light.x + DARK_X_OFFSET}, ${light.y})，改名「${light.name} ·暗」`);

process.stdout.write(cloneId);
