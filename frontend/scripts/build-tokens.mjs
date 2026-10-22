#!/usr/bin/env node
/**
 * 设计令牌构建：tokens.json → tokens.css + tokens.figma.json
 *
 * tokens.json 是唯一源；tokens.css 是生成物，禁止手改。
 * 用法：node scripts/build-tokens.mjs [--check]
 *   --check 只比对、不写盘；生成物与源不一致时退出码 1（CI 用）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'tokens.json');
const CSS_OUT = path.join(ROOT, 'tokens.css');
const FIGMA_OUT = path.join(ROOT, 'tokens.figma.json');
const CHECK = process.argv.includes('--check');

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

function walk(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    const p = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && typeof value.$type === 'string') {
      out.push({ path: p, token: value });
    } else if (value && typeof value === 'object') {
      walk(value, p, out);
    }
  }
}

const tokens = [];
walk(raw, '', tokens);

function resolveAlias(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^\{([^}]+)\}$/);
  return m ? m[1] : null;
}

function valueToCss(value) {
  if (value && typeof value === 'object' && 'value' in value && 'unit' in value) {
    return `${value.value}${value.unit}`;
  }
  if (value && typeof value === 'object' && value.colorSpace && value.hex) {
    const alpha = value.alpha ?? 1;
    return alpha < 1
      ? `${value.hex}${Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase()}`
      : value.hex;
  }
  return value;
}

function cssValue(token, mode = 'light') {
  if (mode === 'dark') {
    const dark = token.$extensions?.modes?.dark;
    if (!dark) return null;
    return dark.cssValue ?? valueToCss(dark.value);
  }
  return token.$extensions?.cssValue ?? valueToCss(token.$value);
}

function fontFamilyValue(token) {
  if (Array.isArray(token.$value)) {
    return token.$value.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');
  }
  return String(token.$value);
}

function primitiveValue(token) {
  const v = token.$value;
  if (Array.isArray(v)) return v;
  return v;
}

function formatDimension(v) {
  if (typeof v === 'number') return `${v}px`;
  if (v && typeof v === 'object' && 'value' in v && 'unit' in v) return `${v.value}${v.unit}`;
  return String(v);
}

function cssLine(token) {
  const varName = token.$extensions?.cssVar;
  if (!varName) return null;
  let value;
  if (token.$type === 'fontFamily') value = cssValue(token) ?? fontFamilyValue(token);
  else if (token.$type === 'dimension') value = cssValue(token) ?? formatDimension(token.$value);
  else value = cssValue(token) ?? String(token.$value);
  if (value == null) return null;
  const desc = token.$description ? ` /* ${token.$description} */` : '';
  return `  ${varName}: ${value};${desc}`;
}

const GROUPS = [
  ['color', '颜色'],
  ['radius', '圆角'],
  ['space', '间距'],
  ['height', '控件高度'],
  ['icon', '图标尺寸'],
  ['width', '宽度'],
  ['fontSize', '字号'],
  ['lineHeight', '行高'],
  ['fontWeight', '字重'],
  ['fontFamily', '字体族'],
  ['shadow', '阴影'],
  ['z', '层级'],
  ['duration', '时长'],
  ['easing', '缓动']
];

const byGroup = new Map();
for (const item of tokens) {
  const group = item.path.split('.')[0];
  if (!byGroup.has(group)) byGroup.set(group, []);
  byGroup.get(group).push(item);
}

const rootLines = [];
const darkLines = [];
for (const [group, title] of GROUPS) {
  const list = byGroup.get(group) || [];
  if (!list.length) continue;
  rootLines.push(`  /* ---- ${title} ---- */`);
  let hasDark = false;
  for (const item of list) {
    const line = cssLine(item.token);
    if (!line) continue;
    rootLines.push(line);
    if (item.token.$extensions?.modes?.dark) {
      const varName = item.token.$extensions.cssVar;
      const darkValue = cssValue(item.token, 'dark');
      if (darkValue != null) {
        if (!hasDark) {
          darkLines.push(`  /* ---- ${title} ---- */`);
          hasDark = true;
        }
        darkLines.push(`  ${varName}: ${darkValue};`);
      }
    }
  }
}

const css = `/* ==========================================================================
   Dataset Factory · 设计令牌（生成物，禁止手改）
   ------------------------------------------------------------------
   唯一源：frontend/tokens.json
   生成：node scripts/build-tokens.mjs
   校验：node scripts/build-tokens.mjs --check
   说明：颜色保留 HSL 通道写法，供 hsl(var(--x) / alpha) 使用。
   ========================================================================== */

:root {
${rootLines.join('\n')}
}

.dark {
${darkLines.join('\n')}
}
`;

function variableName(item) {
  const v = item.token.$extensions?.cssVar?.replace(/^--/, '');
  if (!v) return null;
  if (item.token.$type === 'color') return `color/${v}`;
  if (v === 'radius') return 'radius/default';
  if (v.startsWith('r-')) return `radius/${v.slice(2)}`;
  if (v.startsWith('space-')) return `space/${v.slice(6)}`;
  if (v.startsWith('h-')) return `height/${v.slice(2)}`;
  if (v.startsWith('icon-')) return `icon/${v.slice(5)}`;
  if (v.startsWith('w-col-')) return `width/col-${v.slice(6)}`;
  if (v.startsWith('w-modal-')) return `width/modal-${v.slice(8)}`;
  if (v.startsWith('t-')) return `font/size/${v.slice(2)}`;
  // 行高在 CSS 里是无单位倍数，Figma 变量只能存像素，映射会失真；行高由文字样式承载。
  if (v.startsWith('lh-')) return null;
  if (v.startsWith('fw-')) return `font/weight/${v.slice(3)}`;
  if (v.startsWith('font-')) return `font/family/${v.slice(5)}`;
  // z-index 是代码层概念，Figma 没有对应属性。
  if (v.startsWith('z-')) return null;
  if (v.startsWith('dur-')) return `motion/duration/${v.slice(4)}`;
  if (v === 'ease') return 'motion/easing/default';
  return null;
}

function hexToRgba(hex) {
  const h = String(hex).replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function parseNumber(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'value' in value) return value.value;
  const m = String(value).match(/^(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function variableValue(token, mode) {
  const modeValue = mode === 'dark' ? token.$extensions?.modes?.dark?.value : token.$value;
  if (modeValue == null) return null;
  if (token.$type === 'color') {
    const alias = resolveAlias(modeValue);
    if (alias) {
      const figmaOverride = token.$extensions?.figma;
      if (figmaOverride?.alias) return { alias: figmaOverride.alias, opacity: figmaOverride.opacity };
      return { alias: alias.replace(/^color\./, 'color/') };
    }
    if (modeValue && typeof modeValue === 'object' && modeValue.colorSpace) {
      const [r, g, b] = modeValue.components;
      return { color: { r, g, b, a: modeValue.alpha ?? 1 } };
    }
    if (typeof modeValue === 'string' && /^#[0-9A-Fa-f]{6,8}$/.test(modeValue)) {
      return { color: hexToRgba(modeValue) };
    }
    return null;
  }
  if (token.$type === 'dimension') {
    const alias = resolveAlias(modeValue);
    if (alias) return { alias: alias.replace(/^radius\./, 'radius/') };
    if (modeValue && typeof modeValue === 'object' && 'value' in modeValue) return modeValue.value;
    return parseNumber(modeValue);
  }
  if (token.$type === 'number') return parseNumber(modeValue);
  if (token.$type === 'fontFamily') {
    return Array.isArray(modeValue) ? modeValue[0] : String(modeValue);
  }
  if (token.$type === 'duration') {
    if (modeValue && typeof modeValue === 'object' && 'value' in modeValue) {
      return modeValue.unit === 's' ? modeValue.value * 1000 : modeValue.value;
    }
    return parseNumber(modeValue);
  }
  if (token.$type === 'cubicBezier') return modeValue;
  return null;
}

const variables = [];
for (const item of tokens) {
  const name = variableName(item);
  if (!name) continue;
  const type = item.token.$type;
  if (type !== 'color' && type !== 'dimension' && type !== 'number' && type !== 'fontFamily' && type !== 'duration' && type !== 'cubicBezier') continue;
  const light = variableValue(item.token, 'light');
  if (light == null) continue;
  const dark = variableValue(item.token, 'dark');
  variables.push({
    name,
    type,
    description: item.token.$description || '',
    cssVar: item.token.$extensions?.cssVar || null,
    light,
    dark: dark ?? null
  });
}

const textStyles = [];
for (const item of tokens) {
  if (item.token.$type !== 'typography') continue;
  const v = item.token.$value;
  const styleName = item.token.$extensions?.figmaStyle;
  if (!styleName) continue;
  const fontFamilyAlias = resolveAlias(v.fontFamily);
  const fontSizeAlias = resolveAlias(v.fontSize);
  const fontWeightAlias = resolveAlias(v.fontWeight);
  const familyToken = tokens.find((t) => t.path === fontFamilyAlias);
  const sizeToken = tokens.find((t) => t.path === fontSizeAlias);
  const weightToken = tokens.find((t) => t.path === fontWeightAlias);
  const family = familyToken?.token.$extensions?.figmaFamily || 'HarmonyOS Sans SC';
  const size = sizeToken ? parseNumber(sizeToken.token.$value) : null;
  const weight = weightToken ? Number(weightToken.token.$value) : 400;
  const lineHeightExt = item.token.$extensions?.figmaLineHeight;
  const lineHeight = lineHeightExt
    ? `${lineHeightExt.value}${lineHeightExt.unit === 'PERCENT' ? '%' : 'px'}`
    : typeof v.lineHeight === 'number'
      ? `${Math.round(v.lineHeight * 1000) / 10}%`
      : String(v.lineHeight);
  textStyles.push({
    name: styleName,
    fontFamily: family,
    fontStyle: weight >= 600 ? 'Bold' : weight >= 500 ? 'Medium' : 'Regular',
    fontSize: size,
    lineHeight
  });
}

function shadowColorToHex(color) {
  if (typeof color === 'string') return color;
  if (color && typeof color === 'object' && color.colorSpace) {
    const h = (x) => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase();
    const base = color.hex
      ? color.hex.replace('#', '').toUpperCase()
      : `${h(color.components[0])}${h(color.components[1])}${h(color.components[2])}`;
    const alpha = color.alpha ?? 1;
    return `#${base}${alpha < 1 ? h(alpha) : ''}`;
  }
  return String(color);
}

function shadowLength(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'value' in value) return value.value;
  return value;
}

function shadowToEffect(shadow) {
  return {
    color: shadowColorToHex(shadow.color),
    offsetX: shadowLength(shadow.offsetX),
    offsetY: shadowLength(shadow.offsetY),
    blur: shadowLength(shadow.blur),
    spread: shadowLength(shadow.spread)
  };
}

const effectStyles = [];
for (const item of tokens) {
  if (item.token.$type !== 'shadow') continue;
  const nameMap = { '1': '阴影/1 卡片', '2': '阴影/2 悬浮', '3': '阴影/3 浮层' };
  const key = item.path.split('.')[1];
  if (!nameMap[key]) continue;
  const effects = Array.isArray(item.token.$value)
    ? item.token.$value.map(shadowToEffect)
    : item.token.$value;
  effectStyles.push({ name: nameMap[key], effects });
}

const figma = {
  generatedFrom: 'frontend/tokens.json',
  variables,
  textStyles,
  effectStyles
};

if (CHECK) {
  const existing = fs.existsSync(CSS_OUT) ? fs.readFileSync(CSS_OUT, 'utf8') : '';
  if (existing !== css) {
    console.error('tokens.css 与 tokens.json 不一致；请运行 node scripts/build-tokens.mjs');
    process.exit(1);
  }
  console.log('tokens.css 已是最新');
} else {
  fs.writeFileSync(CSS_OUT, css, 'utf8');
  fs.writeFileSync(FIGMA_OUT, JSON.stringify(figma, null, 2) + '\n', 'utf8');
  console.log(`wrote ${path.relative(ROOT, CSS_OUT)} and ${path.relative(ROOT, FIGMA_OUT)}`);
}
