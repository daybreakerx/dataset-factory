#!/usr/bin/env node
/**
 * 校验 tokens.json 的取值形状是否符合严格 DTCG 2025.10（本项目使用的子集）。
 *
 * 只校验格式、别名与取值类型，不改任何 token；失败时退出码 1。
 * 用法：node scripts/validate-tokens.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'tokens.json');
const root = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const errors = [];
const tokens = [];

function walk(node, prefix) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && typeof value.$type === 'string') {
      tokens.push({ path: next, token: value });
    } else if (value && typeof value === 'object') {
      walk(value, next);
    }
  }
}

walk(root, '');

const paths = new Set(tokens.map((item) => item.path));
const cssVars = new Map();

function isAlias(value) {
  return typeof value === 'string' && /^\{[^}]+\}$/.test(value);
}

function checkAlias(value, where) {
  if (!isAlias(value)) return false;
  const target = value.slice(1, -1);
  if (!paths.has(target)) errors.push(`${where}: 别名目标不存在：${target}`);
  return true;
}

function isColor(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.colorSpace === 'srgb' &&
    Array.isArray(value.components) &&
    value.components.length === 3 &&
    value.components.every((component) => typeof component === 'number' && component >= 0 && component <= 1) &&
    (value.alpha === undefined || (typeof value.alpha === 'number' && value.alpha >= 0 && value.alpha <= 1)) &&
    (value.hex === undefined || /^#[0-9A-Fa-f]{6}$/.test(value.hex))
  );
}

function isDimension(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.value === 'number' &&
    typeof value.unit === 'string' &&
    value.unit.length > 0
  );
}

function isDuration(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.value === 'number' &&
    (value.unit === 'ms' || value.unit === 's')
  );
}

function checkColor(value, where) {
  if (checkAlias(value, where)) return;
  if (!isColor(value)) errors.push(`${where}: 需要 DTCG 颜色对象（colorSpace／components／alpha／hex）`);
}

function checkDimension(value, where) {
  if (checkAlias(value, where)) return;
  if (!isDimension(value)) errors.push(`${where}: 需要 DTCG 尺寸对象 { value, unit }`);
}

function checkDuration(value, where) {
  if (checkAlias(value, where)) return;
  if (!isDuration(value)) errors.push(`${where}: 需要 DTCG 时长对象 { value, unit: "ms" | "s" }`);
}

function checkToken(item) {
  const { path: where, token } = item;
  const value = token.$value;
  const type = token.$type;

  if (value === undefined || value === null) errors.push(`${where}: 缺少 $value`);
  if (typeof value === 'string' && !isAlias(value)) {
    errors.push(`${where}: 不允许裸字符串取值；请用 DTCG 对象或别名`);
  }

  switch (type) {
    case 'color':
      checkColor(value, where);
      break;
    case 'dimension':
      checkDimension(value, where);
      break;
    case 'duration':
      checkDuration(value, where);
      break;
    case 'shadow': {
      if (!Array.isArray(value)) {
        errors.push(`${where}: shadow 需要阴影对象数组`);
        break;
      }
      value.forEach((shadow, index) => {
        checkColor(shadow.color, `${where}[${index}].color`);
        for (const key of ['offsetX', 'offsetY', 'blur', 'spread']) {
          checkDimension(shadow[key], `${where}[${index}].${key}`);
        }
      });
      break;
    }
    case 'typography': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${where}: typography 需要组合对象`);
        break;
      }
      if (!(isAlias(value.fontFamily) || typeof value.fontFamily === 'string')) {
        errors.push(`${where}.fontFamily: 需要字体族或别名`);
      }
      if (!(isAlias(value.fontSize) || isDimension(value.fontSize))) {
        errors.push(`${where}.fontSize: 需要 DTCG 尺寸对象或别名`);
      }
      if (!(isAlias(value.fontWeight) || typeof value.fontWeight === 'number')) {
        errors.push(`${where}.fontWeight: 需要数字或别名`);
      }
      if (typeof value.lineHeight !== 'number') {
        errors.push(`${where}.lineHeight: 需要无单位倍数（number）`);
      }
      if (!(isAlias(value.letterSpacing) || isDimension(value.letterSpacing))) {
        errors.push(`${where}.letterSpacing: 需要 DTCG 尺寸对象或别名`);
      }
      break;
    }
    case 'fontFamily':
      if (!(Array.isArray(value) && value.every((family) => typeof family === 'string'))) {
        errors.push(`${where}: fontFamily 需要字符串数组`);
      }
      break;
    case 'fontWeight':
      if (!(typeof value === 'number' || isAlias(value))) {
        errors.push(`${where}: fontWeight 需要数字或别名`);
      }
      break;
    case 'number':
      if (typeof value !== 'number') errors.push(`${where}: number 需要数字`);
      break;
    case 'cubicBezier':
      if (!(Array.isArray(value) && value.length === 4 && value.every((part) => typeof part === 'number'))) {
        errors.push(`${where}: cubicBezier 需要 4 个数字`);
      }
      break;
    default:
      errors.push(`${where}: 未支持的 $type：${type}`);
  }

  const dark = token.$extensions?.modes?.dark?.value;
  if (dark !== undefined) {
    if (type === 'color') checkColor(dark, `${where}.dark`);
    else if (type === 'dimension') checkDimension(dark, `${where}.dark`);
    else if (type === 'duration') checkDuration(dark, `${where}.dark`);
    else if (type === 'shadow') {
      // 暗色阴影在自定义扩展里保持 CSS 字符串，不属于 DTCG $value。
    } else {
      errors.push(`${where}: ${type} 不应有暗色取值`);
    }
  }

  const cssVar = token.$extensions?.cssVar;
  if (cssVar) {
    if (cssVars.has(cssVar)) errors.push(`${where}: cssVar 重复：${cssVar}（另见 ${cssVars.get(cssVar)}）`);
    else cssVars.set(cssVar, where);
  }
}

for (const item of tokens) checkToken(item);

if (errors.length) {
  console.error(`tokens.json 未通过严格 DTCG 校验，共 ${errors.length} 处：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`tokens.json 通过严格 DTCG 2025.10 形状校验（本项目类型子集）：${tokens.length} 个 token，${cssVars.size} 个 CSS 变量。`);
