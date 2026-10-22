#!/usr/bin/env node
/**
 * 设计令牌同步：tokens.figma.json → Figma variables
 *
 * 前置：Figma 打开 Dataset Factory，figwright 插件已连接本机 3055 端口。
 * 唯一源是 tokens.json；本脚本只把生成物写进 Figma，不改任何 token 取值。
 * 用法：node scripts/sync-figma-variables.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'tokens.figma.json');
const RPC = 'http://127.0.0.1:3055/rpc';
const COLLECTION_NAME = 'Dataset Factory / Tokens';
const DRY = process.argv.includes('--dry-run');
const INSPECT = process.argv.includes('--inspect');
const PRINT_IDS = process.argv.includes('--ids');

// ---------------------------------------------------------------------------
// msgpack：figwright 的 /rpc 只收发 application/msgpack
// ---------------------------------------------------------------------------

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
    else if (n >= -32768) push([0xd1, (n >> 8) & 0xff, n & 0xff]);
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
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4: {
        const len = buffer[pos++];
        const value = buffer.subarray(pos, pos + len);
        pos += len;
        return value;
      }
      case 0xc5: {
        const len = buffer.readUInt16BE(pos);
        pos += 2;
        const value = buffer.subarray(pos, pos + len);
        pos += len;
        return value;
      }
      case 0xc6: {
        const len = buffer.readUInt32BE(pos);
        pos += 4;
        const value = buffer.subarray(pos, pos + len);
        pos += len;
        return value;
      }
      case 0xca: {
        const value = buffer.readFloatBE(pos);
        pos += 4;
        return value;
      }
      case 0xcb: {
        const value = buffer.readDoubleBE(pos);
        pos += 8;
        return value;
      }
      case 0xcc:
        return buffer[pos++];
      case 0xcd: {
        const value = buffer.readUInt16BE(pos);
        pos += 2;
        return value;
      }
      case 0xce: {
        const value = buffer.readUInt32BE(pos);
        pos += 4;
        return value;
      }
      case 0xcf: {
        const value = Number(buffer.readBigUInt64BE(pos));
        pos += 8;
        return value;
      }
      case 0xd0:
        return buffer.readInt8(pos++);
      case 0xd1: {
        const value = buffer.readInt16BE(pos);
        pos += 2;
        return value;
      }
      case 0xd2: {
        const value = buffer.readInt32BE(pos);
        pos += 4;
        return value;
      }
      case 0xd3: {
        const value = Number(buffer.readBigInt64BE(pos));
        pos += 8;
        return value;
      }
      case 0xd9:
        return readString(buffer[pos++]);
      case 0xda: {
        const len = buffer.readUInt16BE(pos);
        pos += 2;
        return readString(len);
      }
      case 0xdb: {
        const len = buffer.readUInt32BE(pos);
        pos += 4;
        return readString(len);
      }
      case 0xdc: {
        const len = buffer.readUInt16BE(pos);
        pos += 2;
        return readArray(len);
      }
      case 0xdd: {
        const len = buffer.readUInt32BE(pos);
        pos += 4;
        return readArray(len);
      }
      case 0xde: {
        const len = buffer.readUInt16BE(pos);
        pos += 2;
        return readMap(len);
      }
      case 0xdf: {
        const len = buffer.readUInt32BE(pos);
        pos += 4;
        return readMap(len);
      }
      default:
        throw new Error(`无法解码的 msgpack 字节：0x${byte.toString(16)}`);
    }
  };
  const value = read();
  if (pos !== buffer.length) throw new Error(`msgpack 尾部有 ${buffer.length - pos} 字节未解码`);
  return value;
}

// ---------------------------------------------------------------------------
// figwright RPC
// ---------------------------------------------------------------------------

let requestSeq = 0;

async function rpc(toolName, args) {
  const body = encode({ requestId: `df-token-sync-${++requestSeq}`, toolName, args });
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

// ---------------------------------------------------------------------------
// token → Figma 映射
// ---------------------------------------------------------------------------

const RESOLVED_TYPE = {
  color: 'COLOR',
  dimension: 'FLOAT',
  number: 'FLOAT',
  fontFamily: 'STRING',
  duration: 'TIMING',
  cubicBezier: 'EASING'
};

function scopesFor(name) {
  if (name.startsWith('color/')) return ['ALL_FILLS', 'STROKE_COLOR'];
  if (name.startsWith('radius/')) return ['CORNER_RADIUS'];
  if (name.startsWith('space/')) return ['GAP'];
  if (name.startsWith('height/') || name.startsWith('width/') || name.startsWith('icon/')) return ['WIDTH_HEIGHT'];
  if (name.startsWith('font/size/')) return ['FONT_SIZE'];
  if (name.startsWith('font/weight/')) return ['FONT_WEIGHT'];
  if (name.startsWith('font/family/')) return ['FONT_FAMILY'];
  return undefined;
}

function aliasValue(alias, ids) {
  const id = ids.get(alias);
  if (!id) throw new Error(`别名目标不存在：${alias}`);
  return { type: 'VARIABLE_ALIAS', id };
}

function convertValue(value, type, ids) {
  if (!value) return null;
  if (type === 'COLOR') {
    if (value.alias) {
      const alias = aliasValue(value.alias, ids);
      return value.opacity == null ? alias : { color: alias, opacity: value.opacity };
    }
    if (value.color) return value.color;
  }
  if (type === 'FLOAT') {
    if (value.alias) return aliasValue(value.alias, ids);
    return Number(value);
  }
  if (type === 'STRING') return String(value);
  if (type === 'TIMING') return Number(value) / 1000;
  if (type === 'EASING') {
    if (!Array.isArray(value) || value.length !== 4) throw new Error(`无效的缓动值：${JSON.stringify(value)}`);
    return {
      type: 'CUSTOM_CUBIC_BEZIER',
      easingFunctionCubicBezier: { x1: value[0], y1: value[1], x2: value[2], y2: value[3] }
    };
  }
  throw new Error(`无法转换的令牌类型：${type}`);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const spec = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const desired = spec.variables
  .map((v) => ({
    ...v,
    resolvedType: RESOLVED_TYPE[v.type],
    scopes: scopesFor(v.name)
  }))
  .filter((v) => {
    if (!v.resolvedType) {
      console.warn(`跳过无法映射到 Figma 的令牌：${v.name}（${v.type}）`);
      return false;
    }
    return true;
  });

console.log(`令牌源：${SRC}`);
console.log(`待同步变量：${desired.length} 个（亮色${desired.filter((v) => v.dark).length ? `，暗色覆盖 ${desired.filter((v) => v.dark).length} 个` : ''}）`);

const defs = await rpc('get_variable_defs', {});
const collectionForPrint = defs.collections.find((c) => c.name === COLLECTION_NAME);
if (PRINT_IDS) {
  for (const v of defs.variables.filter((x) => x.collectionId === collectionForPrint?.id)) {
    console.log(`${v.name}\t${v.id}`);
  }
  process.exit(0);
}
if (INSPECT) {
  const names = [
    'color/accent',
    'color/border',
    'radius/default',
    'motion/duration/1',
    'motion/duration/2',
    'motion/easing/default'
  ];
  for (const name of names) {
    const item = defs.variables.find((v) => v.name === name);
    console.log(`${name} => ${JSON.stringify(item)}`);
  }
  process.exit(0);
}
let collection = defs.collections.find((c) => c.name === COLLECTION_NAME);

if (!collection) {
  if (DRY) {
    console.log(`集合不存在：${COLLECTION_NAME}（dry-run 不创建）`);
    process.exit(0);
  }
  const created = await rpc('create_variable_collection', { name: COLLECTION_NAME });
  collection = {
    id: created.collectionId,
    name: COLLECTION_NAME,
    defaultModeId: created.defaultModeId,
    modes: [{ modeId: created.defaultModeId, name: 'Mode 1' }],
    variableIds: []
  };
  console.log(`已创建集合：${COLLECTION_NAME}`);
}

let lightMode = collection.modes.find((m) => m.name === 'Light') ?? collection.modes[0];
if (lightMode.name !== 'Light') {
  if (!DRY) {
    await rpc('update_variable_collection', {
      collectionId: collection.id,
      modes: [{ modeId: lightMode.modeId, name: 'Light' }]
    });
  }
  console.log(`默认模式改名：${lightMode.name} → Light`);
  lightMode = { ...lightMode, name: 'Light' };
}

let darkMode = collection.modes.find((m) => m.name === 'Dark');
if (!darkMode && !DRY) {
  try {
    const added = await rpc('add_variable_mode', { collectionId: collection.id, name: 'Dark' });
    darkMode = { modeId: added.modeId, name: 'Dark' };
    console.log('已添加暗色模式：Dark');
  } catch (error) {
    console.log(`暗色模式未建立（可能受 Figma 套餐限制）：${error.message}`);
  }
}

const current = new Map(
  defs.variables.filter((v) => v.collectionId === collection.id).map((v) => [v.name, v])
);
const missing = desired.filter((v) => !current.has(v.name));
const extras = [...current.keys()].filter((name) => !desired.some((v) => v.name === name));

console.log(`集合现有变量：${current.size} 个；本次新增：${missing.length} 个`);
if (extras.length) console.log(`迁移期保留的旧变量（不在令牌源内）：${extras.join('、')}`);
console.log(`新增清单：${missing.map((v) => v.name).join('、') || '（无）'}`);

if (DRY) {
  console.log('dry-run 结束：未写入 Figma。');
  process.exit(0);
}

for (let i = 0; i < missing.length; i++) {
  const item = missing[i];
  const created = await rpc('create_variable', {
    name: item.name,
    collectionId: collection.id,
    resolvedType: item.resolvedType,
    ...(item.scopes ? { scopes: item.scopes } : {})
  });
  if (!created?.variableId) throw new Error(`创建变量失败：${item.name}`);
  if ((i + 1) % 20 === 0 || i === missing.length - 1) {
    console.log(`已创建 ${i + 1}/${missing.length}`);
  }
}

const after = await rpc('get_variable_defs', {});
const ids = new Map(
  after.variables.filter((v) => v.collectionId === collection.id).map((v) => [v.name, v.id])
);
const unresolved = desired.filter((v) => !ids.has(v.name));
if (unresolved.length) throw new Error(`以下变量在 Figma 中不存在：${unresolved.map((v) => v.name).join('、')}`);

for (let i = 0; i < desired.length; i++) {
  const item = desired[i];
  const id = ids.get(item.name);
  const light = convertValue(item.light, item.resolvedType, ids);
  await rpc('set_variable_value', { variableId: id, modeId: lightMode.modeId, value: light });
  if (darkMode && item.dark) {
    const dark = convertValue(item.dark, item.resolvedType, ids);
    await rpc('set_variable_value', { variableId: id, modeId: darkMode.modeId, value: dark });
  }
  if (item.cssVar) {
    await rpc('set_variable_code_syntax', { variableId: id, codeSyntax: { WEB: item.cssVar } });
  }
  if ((i + 1) % 20 === 0 || i === desired.length - 1) {
    console.log(`已写入取值 ${i + 1}/${desired.length}`);
  }
}

const verified = await rpc('get_variable_defs', {});
const finalVars = verified.variables.filter((v) => v.collectionId === collection.id);
const byName = new Map(finalVars.map((v) => [v.name, v]));
const missingAfter = desired.filter((v) => !byName.has(v.name));
const lightCheck = (name) => byName.get(name)?.valuesByMode?.[lightMode.modeId];

const accent = lightCheck('color/accent');
const checks = [
  ['color/border 亮色应为 n-200 别名', () => lightCheck('color/border')?.type === 'VARIABLE_ALIAS'],
  [
    'color/accent 亮色应为 n-900 的 6% 透明',
    () =>
      (accent?.color?.type === 'VARIABLE_ALIAS' && Math.abs(accent.opacity - 0.06) < 1e-6) ||
      (Math.abs(accent?.a - 0.0588) < 0.001 &&
        Math.abs(accent?.r - 0.0667) < 0.0001 &&
        Math.abs(accent?.g - 0.0941) < 0.0001 &&
        Math.abs(accent?.b - 0.1529) < 0.0001)
  ],
  ['radius/default 亮色应为 radius/md 别名', () => lightCheck('radius/default')?.type === 'VARIABLE_ALIAS'],
  ['motion/duration/1 应为 0.12 秒', () => Math.abs(lightCheck('motion/duration/1') - 0.12) < 1e-6],
  ['motion/easing/default 应为自定义贝塞尔', () => lightCheck('motion/easing/default')?.type === 'CUSTOM_CUBIC_BEZIER']
];

console.log(`\n同步完成：${finalVars.length} 个变量（目标 ${desired.length} 个）`);
if (missingAfter.length) console.log(`仍缺失：${missingAfter.map((v) => v.name).join('、')}`);
for (const [label, fn] of checks) {
  let ok = false;
  try {
    ok = fn();
  } catch {
    ok = false;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}
