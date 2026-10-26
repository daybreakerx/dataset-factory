#!/usr/bin/env node
/**
 * 暗色稿重绑：把一棵 Figma 子树里绑定到亮色集合 COLOR 变量的填色/描边/效果
 * 改绑到配对暗色集合的同名变量；效果样式改指「·暗」阴影样式；字面「主题色 tint」
 * 按映射表换成暗色字面值（透明度比例依据 design.md 2.7 三·补）。
 *
 * 非颜色变量（间距/圆角/字号等 FLOAT）不重绑——它们不随主题变，单一来源留在亮色集合。
 *
 * 用法：node scripts/rebind-figma-dark.mjs <rootNodeId> [--dry-run]
 * 前置：sync-figma-variables.mjs 已建好配对暗色集合；figwright 插件在线（3055）。
 * 幂等：二跑应零写入。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOKENS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tokens.figma.json'), 'utf8'));
const RPC = 'http://127.0.0.1:3055/rpc';
const LIGHT_COLLECTION = 'Dataset Factory / Tokens';
const DARK_COLLECTION = 'Dataset Factory / Tokens / Dark';
const DRY = process.argv.includes('--dry-run');
const rootId = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));

if (!rootId) {
  console.error('用法：node scripts/rebind-figma-dark.mjs <rootNodeId> [--dry-run]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// msgpack（与 sync-figma-variables.mjs 同一套编解码）
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
  const body = encode({ requestId: `df-dark-rebind-${++requestSeq}`, toolName, args });
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
// 映射表
// ---------------------------------------------------------------------------

const eps = (a, b, e = 0.004) => Math.abs(a - b) < e;
const zipRgb = (arr) => ({ r: arr[0], g: arr[1], b: arr[2] });

// 主色 tint：亮色 #2463EB@α → 暗色 #3C83F6@α'（比例按 design.md 2.7 三·补：/8→/22、/10→/26、悬停再高一档 /34）
const PRIMARY_LIGHT = [0.1412, 0.3882, 0.9216];
const PRIMARY_DARK = [0.2353, 0.5137, 0.9647];
const PRIMARY_ALPHA_MAP = [[0.08, 0.22], [0.10, 0.26], [0.30, 0.34], [1, 1]];

// accent 半透明墨：亮色 #111827@6% → 暗色 #E3E5E8@6%
const ACCENT_INK_LIGHT = [0.0667, 0.0941, 0.1529];
const ACCENT_INK_DARK = [0.8902, 0.898, 0.9098];

// 阴影字面值：按几何（offsetX/offsetY/blur/spread）匹配 tokens.json 亮色阴影 → 暗色（纯黑、alpha 提高）
const SHADOW_BASE = [0.102, 0.129, 0.176];
const SHADOW_ALPHA_MAP = [
  [[0, 1, 2, 0], 0.30],
  [[0, 1, 3, 0], 0.26],
  [[0, 2, 4, 0], 0.32],
  [[0, 8, 20, 0], 0.38],
  [[0, 4, 10, 0], 0.30],
  [[0, 20, 44, -8], 0.55]
];

// 阴影样式名 → 暗色样式名（不存在时由本脚本创建）
const DARK_SHADOW_EFFECTS = {
  '阴影/1 卡片': [
    { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0, visible: true, blendMode: 'NORMAL' },
    { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.26 }, offset: { x: 0, y: 1 }, radius: 3, spread: 0, visible: true, blendMode: 'NORMAL' }
  ],
  '阴影/2 悬浮': [
    { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.32 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true, blendMode: 'NORMAL' },
    { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.38 }, offset: { x: 0, y: 8 }, radius: 20, spread: 0, visible: true, blendMode: 'NORMAL' }
  ],
  '阴影/3 浮层': [
    { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 4 }, radius: 10, spread: 0, visible: true, blendMode: 'NORMAL' },
    { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.55 }, offset: { x: 0, y: 20 }, radius: 44, spread: -8, visible: true, blendMode: 'NORMAL' }
  ]
};

const flags = [];
let scanned = 0;
let writes = { fills: 0, strokes: 0, effects: 0, styles: 0, nodeBinds: 0, labels: 0 };
const DIAG = process.argv.includes('--diag');
const LABELS = process.argv.includes('--labels');
const TO_DARK = process.argv.includes('--to-dark');
const diag = { nodeBound: 0, styleBound: 0, literalFills: new Map(), literalStrokes: new Map(), literalTextFills: new Map() };
const litKey = (paint) => {
  const c = paint.color ?? {};
  const hex = [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
  const a = paint.opacity ?? 1;
  return `#${hex}@${Math.round(a * 1000) / 1000}`;
};

// ---------------------------------------------------------------------------
// 标签改写（--labels）：色板标签「令牌名\n#HEX」按令牌解析值更新；
// --to-dark 用暗色解析值，否则用亮色解析值（修正亮色稿里的陈旧 hex）。
// 别名链在 tokens.figma.json 的变量表内递归解析，组合透明度输出 8 位 hex。
// ---------------------------------------------------------------------------

const varByFigmaName = new Map(TOKENS.variables.map((v) => [v.name, v]));
const colorLabelByName = new Map(
  TOKENS.variables.filter((v) => v.type === 'color').map((v) => [v.name.replace(/^color\//, ''), v])
);

function tokenHex(varItem, mode) {
  let v = mode === 'dark' ? (varItem.dark ?? varItem.light) : varItem.light;
  let opacity = null;
  const seen = new Set();
  while (v && typeof v === 'object') {
    if (v.alias) {
      if (seen.has(v.alias)) return null;
      seen.add(v.alias);
      if (v.opacity != null) opacity = v.opacity;
      const target = varByFigmaName.get(v.alias);
      if (!target) return null;
      v = mode === 'dark' ? (target.dark ?? target.light) : target.light;
      continue;
    }
    if (v.color) {
      const c = v.color;
      const alpha = opacity ?? c.a ?? 1;
      const base = [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
      return alpha < 1 ? `#${base}${Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase()}` : `#${base}`;
    }
    return null;
  }
  return null;
}

function collectTextOps(node) {
  const ops = [];
  if (node.type === 'TEXT' && typeof node.characters === 'string') {
    let chars = node.characters;
    let changed = false;
    const from = chars.split('\n').join(' | ');
    if (TO_DARK && chars.includes('Dataset Factory / Tokens（Light）')) {
      chars = chars.replace('Dataset Factory / Tokens（Light）', 'Dataset Factory / Tokens / Dark');
      changed = true;
    }
    const m = chars.match(/^([A-Za-z0-9-]+)\n#([0-9A-Fa-f]{6,8})$/);
    if (m && colorLabelByName.has(m[1])) {
      const hex = tokenHex(colorLabelByName.get(m[1]), TO_DARK ? 'dark' : 'light');
      if (hex && hex.toUpperCase() !== `#${m[2]}`.toUpperCase()) {
        chars = `${m[1]}\n${hex}`;
        changed = true;
      }
    }
    if (changed) ops.push({ tool: 'set_text', args: { nodeId: node.id, characters: chars }, from });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) ops.push(...collectTextOps(child));
  }
  return ops;
}

function mapBoundVariables(bv) {
  if (!bv || typeof bv !== 'object') return null;
  let changed = false;
  const out = {};
  for (const [key, val] of Object.entries(bv)) {
    if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS' && lightColorIds.has(val.id)) {
      const name = lightColorIds.get(val.id);
      const darkId = darkColorByName.get(name);
      if (!darkId) throw new Error(`暗色集合缺少同名颜色变量：${name}`);
      out[key] = { type: 'VARIABLE_ALIAS', id: darkId };
      changed = true;
    } else {
      out[key] = val;
    }
  }
  return changed ? out : null;
}

function mapLiteralTint(color, opacity, label) {
  const rgb = [color.r, color.g, color.b];
  const isPrimaryLight = rgb.every((c, i) => eps(c, PRIMARY_LIGHT[i]));
  const isPrimaryDark = rgb.every((c, i) => eps(c, PRIMARY_DARK[i]));
  if (isPrimaryLight || isPrimaryDark) {
    // 已是暗色色相的也参与透明度校正：映射表升级后重跑能把上一轮按旧规则写过的透明度修正过来
    const hit = PRIMARY_ALPHA_MAP.find(([a]) => eps(opacity, a, 0.006));
    if (!hit) {
      if (isPrimaryLight) flags.push(`primary tint 透明度 ${opacity} 无映射 @ ${label}（已换暗色色相、透明度原样——审计复核）`);
      return isPrimaryLight ? { color: zipRgb(PRIMARY_DARK), opacity } : null;
    }
    if (isPrimaryDark && eps(opacity, hit[1], 0.006)) return null;
    return { color: zipRgb(PRIMARY_DARK), opacity: hit[1] };
  }
  if (rgb.every((c, i) => eps(c, ACCENT_INK_LIGHT[i])) && eps(opacity, 0.06, 0.006)) {
    return { color: zipRgb(ACCENT_INK_DARK), opacity };
  }
  return null;
}

function mapPaints(paints, label) {
  if (!Array.isArray(paints)) return null;
  let changed = false;
  const out = paints.map((p) => {
    const np = { ...p };
    if (p.boundVariables) {
      const mb = mapBoundVariables(p.boundVariables);
      if (mb) { np.boundVariables = mb; changed = true; }
    }
    if (Array.isArray(p.gradientStops)) {
      let stopsChanged = false;
      np.gradientStops = p.gradientStops.map((s) => {
        const ns = { ...s };
        if (s.boundVariables) {
          const mb = mapBoundVariables(s.boundVariables);
          if (mb) { ns.boundVariables = mb; stopsChanged = true; }
        }
        return ns;
      });
      if (stopsChanged) changed = true;
    }
    if (p.type === 'SOLID' && !(p.boundVariables && p.boundVariables.color)) {
      const t = mapLiteralTint(p.color, p.opacity ?? 1, label);
      if (t) { np.color = t.color; np.opacity = t.opacity; changed = true; }
    }
    return np;
  });
  return changed ? out : null;
}

function mapEffects(effects, label) {
  if (!Array.isArray(effects) || !effects.length) return null;
  let changed = false;
  const out = effects.map((e) => {
    const ne = { ...e };
    if (e.boundVariables) {
      const mb = mapBoundVariables(e.boundVariables);
      if (mb) { ne.boundVariables = mb; changed = true; }
    }
    if ((e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.color) {
      const c = e.color;
      const geo = [e.offset?.x ?? 0, e.offset?.y ?? 0, e.radius ?? 0, e.spread ?? 0];
      const isShadowBase = [c.r, c.g, c.b].every((v, i) => eps(v, SHADOW_BASE[i]));
      if (isShadowBase) {
        const hit = SHADOW_ALPHA_MAP.find(([g]) => g.every((v, i) => eps(v, geo[i], 0.01)));
        if (hit) {
          ne.color = { r: 0, g: 0, b: 0, a: hit[1] };
          changed = true;
        } else {
          flags.push(`阴影几何 ${JSON.stringify(geo)} 无映射 @ ${label}（保持原样——审计复核）`);
        }
      }
    }
    return ne;
  });
  return changed ? out : null;
}

function boundIdsFromEntry(entry) {
  // 序列化形态兼容：字符串 id 数组或 {type:'VARIABLE_ALIAS', id} 对象数组
  if (!Array.isArray(entry)) return [];
  return entry.map((v) => (typeof v === 'string' ? v : v?.id)).filter(Boolean);
}

function collect(node) {
  scanned++;
  const label = `${node.name}(${node.id})`;
  const ops = [];
  const styleField = node.styles ?? node.styleIds;
  if (styleField && typeof styleField === 'object' && lightShadowStyleIds.has(styleField.effect)) {
    const lightName = effectStyleNameById.get(styleField.effect);
    const darkId = darkShadowStyleIdByName.get(`${lightName} ·暗`);
    if (darkId) {
      ops.push({ tool: 'apply_style_to_node', args: { nodeId: node.id, styleId: darkId, field: 'effect' } });
    } else {
      flags.push(`缺少暗色阴影样式：${lightName} ·暗 @ ${label}`);
    }
  }
  // 节点级绑定：fills/strokes 整列绑 COLOR 变量（bind_variable_to_paint 按列内序号写）
  if (node.boundVariables && typeof node.boundVariables === 'object') {
    for (const target of ['fills', 'strokes']) {
      boundIdsFromEntry(node.boundVariables[target]).forEach((id, index) => {
        if (!lightColorIds.has(id)) return;
        const darkId = darkColorByName.get(lightColorIds.get(id));
        if (!darkId) throw new Error(`暗色集合缺少同名颜色变量：${lightColorIds.get(id)}`);
        ops.push({ tool: 'bind_variable_to_paint', args: { nodeId: node.id, target, index, variableId: darkId } });
      });
    }
  }
  const nodeBoundTargets = new Set(['fills', 'strokes'].filter((t) => boundIdsFromEntry(node.boundVariables?.[t]).length));
  if (DIAG) {
    for (const p of node.fills ?? []) {
      if (p.type === 'SOLID' && !p.boundVariables?.color && !nodeBoundTargets.has('fills')) {
        const key = `${node.type === 'TEXT' ? 'TEXT ' : ''}${litKey(p)}`;
        diag.literalFills.set(key, (diag.literalFills.get(key) ?? 0) + 1);
      }
    }
    for (const p of node.strokes ?? []) {
      if (p.type === 'SOLID' && !p.boundVariables?.color && !nodeBoundTargets.has('strokes')) {
        diag.literalStrokes.set(litKey(p), (diag.literalStrokes.get(litKey(p)) ?? 0) + 1);
      }
    }
    if (styleField && typeof styleField === 'object' && Object.keys(styleField).length) diag.styleBound++;
    if (node.boundVariables) diag.nodeBound++;
  }
  const fills = mapPaints(node.fills, label);
  if (fills) ops.push({ tool: 'set_fills', args: { nodeId: node.id, fills } });
  const strokes = mapPaints(node.strokes, label);
  if (strokes) ops.push({ tool: 'set_strokes', args: { nodeId: node.id, strokes } });
  if (!(styleField && typeof styleField === 'object' && lightShadowStyleIds.has(styleField.effect))) {
    const effects = mapEffects(node.effects, label);
    if (effects) ops.push({ tool: 'set_effects', args: { nodeId: node.id, effects } });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) ops.push(...collect(child));
  }
  return ops;
}

function countRemainingLightBindings(node) {
  let count = 0;
  const hit = (bv) => {
    if (!bv) return;
    for (const val of Object.values(bv)) {
      if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS' && lightColorIds.has(val.id)) count++;
    }
  };
  hit(node.boundVariables?.fills);
  hit(node.boundVariables?.strokes);
  for (const p of node.fills ?? []) { hit(p.boundVariables); for (const s of p.gradientStops ?? []) hit(s.boundVariables); }
  for (const p of node.strokes ?? []) { hit(p.boundVariables); for (const s of p.gradientStops ?? []) hit(s.boundVariables); }
  for (const e of node.effects ?? []) hit(e.boundVariables);
  if (Array.isArray(node.children)) for (const child of node.children) count += countRemainingLightBindings(child);
  return count;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const defs = await rpc('get_variable_defs', {});
const lightCol = defs.collections.find((c) => c.name === LIGHT_COLLECTION);
const darkCol = defs.collections.find((c) => c.name === DARK_COLLECTION);
if (!lightCol || !darkCol) throw new Error(`集合不齐：亮色=${!!lightCol} 暗色=${!!darkCol}（先跑 sync-figma-variables.mjs）`);
const lightColorIds = new Map(
  defs.variables.filter((v) => v.collectionId === lightCol.id && v.resolvedType === 'COLOR').map((v) => [v.id, v.name])
);
const darkColorByName = new Map(
  defs.variables.filter((v) => v.collectionId === darkCol.id && v.resolvedType === 'COLOR').map((v) => [v.name, v.id])
);
console.log(`亮色 COLOR 变量 ${lightColorIds.size} 个；暗色 COLOR 变量 ${darkColorByName.size} 个`);

const styles = await rpc('get_styles', {});
const effectStyles = styles.effects ?? [];
const lightShadowStyleIds = new Set(
  effectStyles.filter((s) => s.name.startsWith('阴影/') && !s.name.endsWith('·暗')).map((s) => s.id)
);
const effectStyleNameById = new Map(effectStyles.map((s) => [s.id, s.name]));
const darkShadowStyleIdByName = new Map(
  effectStyles.filter((s) => s.name.endsWith('·暗')).map((s) => [s.name, s.id])
);
for (const name of Object.keys(DARK_SHADOW_EFFECTS)) {
  const darkName = `${name} ·暗`;
  if (!darkShadowStyleIdByName.has(darkName)) {
    if (DRY) continue;
    const created = await rpc('create_effect_style', { name: darkName, effects: DARK_SHADOW_EFFECTS[name] });
    darkShadowStyleIdByName.set(darkName, created.styleId);
    console.log(`已创建暗色阴影样式：${darkName}`);
  }
}

console.log(`读取根节点：${rootId}`);
const { node } = await rpc('get_node', { nodeId: rootId });
if (!node) throw new Error(`节点不存在：${rootId}`);

const labelOps = LABELS ? collectTextOps(node) : [];
const ops = LABELS ? [] : collect(node);
console.log(`扫描 ${scanned} 个节点；待写操作 ${ops.length} 个（fills ${ops.filter((o) => o.tool === 'set_fills').length} / strokes ${ops.filter((o) => o.tool === 'set_strokes').length} / effects ${ops.filter((o) => o.tool === 'set_effects').length} / 节点级重绑 ${ops.filter((o) => o.tool === 'bind_variable_to_paint').length} / 效果样式 ${ops.filter((o) => o.tool === 'apply_style_to_node').length}）${LABELS ? `；标签待改 ${labelOps.length} 条` : ''}`);
if (DIAG) {
  const top = (map, n = 20) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}×${v}`).join('  ');
  console.log(`[diag] 节点级绑定 ${diag.nodeBound} 个；样式绑定 ${diag.styleBound} 个`);
  console.log(`[diag] 字面填色 TOP：${top(diag.literalFills) || '（无）'}`);
  console.log(`[diag] 字面描边 TOP：${top(diag.literalStrokes) || '（无）'}`);
}
if (flags.length) console.log(`预警 ${flags.length} 条：\n  - ${flags.join('\n  - ')}`);
if (LABELS && DRY) {
  for (const op of labelOps) console.log(`  ${op.from} → ${op.args.characters.split('\n').join(' | ')}`);
}

if (DRY) {
  console.log('dry-run 结束：未写入。');
  process.exitCode = 0;
} else if (LABELS) {
  let lfail = 0;
  for (let i = 0; i < labelOps.length; i++) {
    try {
      await rpc('set_text', labelOps[i].args);
      writes.labels++;
    } catch (error) {
      lfail++;
      if (lfail <= 5) console.error(`标签写入失败：${labelOps[i].args.nodeId}：${error.message}`);
    }
    if ((i + 1) % 10 === 0 || i === labelOps.length - 1) {
      console.log(`标签已写 ${i + 1}/${labelOps.length}`);
    }
  }
  console.log(`\n标签更新完成：${writes.labels} 条；失败 ${lfail}`);
  if (lfail > 0) process.exitCode = 2;
} else {
  let failed = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      await rpc(op.tool, op.args);
      if (op.tool === 'apply_style_to_node') writes.styles++;
      else if (op.tool === 'bind_variable_to_paint') writes.nodeBinds++;
      else writes[op.tool.replace('set_', '')]++;
    } catch (error) {
      failed++;
      if (failed <= 5) console.error(`写入失败：${op.tool} ${op.args.nodeId}：${error.message}`);
    }
    if ((i + 1) % 20 === 0 || i === ops.length - 1) {
      console.log(`已写入 ${i + 1}/${ops.length}`);
    }
  }

  const { node: after } = await rpc('get_node', { nodeId: rootId });
  const remaining = countRemainingLightBindings(after);
  console.log(`\n重绑完成：fills ${writes.fills} / strokes ${writes.strokes} / effects ${writes.effects} / 节点级重绑 ${writes.nodeBinds} / 效果样式 ${writes.styles}；失败 ${failed}；残留亮色绑定 ${remaining}`);
  if (remaining > 0 || failed > 0) process.exitCode = 2;
}
