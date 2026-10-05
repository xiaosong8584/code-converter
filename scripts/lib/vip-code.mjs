/**
 * VIP 激活码格式定义与签发逻辑（纯函数，零副作用）。
 *
 * 移植自 desktoppet scripts/lib/vip-code.mjs，与 src/vip/vip.ts（验签侧）
 * 共享同一套格式常量。抽成独立模块的原因：测试需要 import 它走真实签发
 * 路径做往返测试，若逻辑混在 generate-vip-code.mjs（含 fs 读写与
 * process.exit）里，被 esbuild 打包进测试产物时会触发副作用。
 *
 * 本模块只依赖 node:crypto 的 sign / createHash / createPrivateKey，
 * 可在浏览器外的任意 Node 环境运行，也可被 bundler 直接打包。
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';

/** 魔数（同时也是格式版本号；轮换密钥时末 4 位 +1） */
export const MAGIC_UNIVERSAL = 'VIPU0002';
export const MAGIC_DEDICATED = 'VIPD0002';

/** 天数纪元：2026-01-01 UTC（uint16 可表示到 2205 年） */
export const EPOCH = Date.UTC(2026, 0, 1);

/** 数据段布局：11 字节载荷 + 64 字节签名 = 75 字节 = 120 个 Base32 字符 */
export const PAYLOAD_LEN = 11;
export const SIG_LEN = 64;
export const DATA_LEN = PAYLOAD_LEN + SIG_LEN;
export const BODY_LEN = 120;

/** 载荷 [0] 的类型字节 */
export const TYPE_UNIVERSAL = 0x55;
export const TYPE_DEDICATED = 0x44;

/** RFC 4648 Base32 字母表（A-Z + 2-7，无 0/1/8/9，规避形近字符） */
export const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 编码（无填充） */
export function b32encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * 组装 11 字节载荷。
 * 布局：[0]=类型；[1..2]=到期天数（仅通用码）；[3..8]=设备指纹（仅专用码）；
 * 未使用槽位填 0 —— 签名覆盖全部 11 字节，因此槽位含义变化不影响已签发码。
 */
export function makePayload({ type, days = 0, deviceId = null }) {
  const p = Buffer.alloc(PAYLOAD_LEN, 0);
  p[0] = type === 'universal' ? TYPE_UNIVERSAL : TYPE_DEDICATED;
  if (type === 'universal') {
    p[1] = (days >> 8) & 0xff;
    p[2] = days & 0xff;
  } else {
    const devHash = createHash('sha256').update(String(deviceId ?? ''), 'utf8').digest();
    p.set(devHash.subarray(0, 6), 3);
  }
  return p;
}

/**
 * 用 Ed25519 签发一个激活码。
 *
 * @param {object} opts
 * @param {{kty:string, crv:string, d:string, x:string}} opts.privateKey  Ed25519 私钥 JWK
 * @param {string} opts.magic   VIPU0002 / VIPD0002
 * @param {Buffer} opts.payload 11 字节载荷
 * @returns {string} 带连字符分组的激活码（16 段，共 143 字符）
 */
export function buildVipCode({ privateKey, magic, payload }) {
  if (payload.length !== PAYLOAD_LEN) {
    throw new Error(`payload 必须是 ${PAYLOAD_LEN} 字节，收到 ${payload.length}`);
  }
  if (magic !== MAGIC_UNIVERSAL && magic !== MAGIC_DEDICATED) {
    throw new Error(`未知魔数：${magic}`);
  }
  const sig = sign(null, payload, createPrivateKey({ key: privateKey, format: 'jwk', type: 'pkcs8' }));
  if (sig.length !== SIG_LEN) throw new Error(`签名长度异常：${sig.length}（应为 ${SIG_LEN}）`);
  return formatCode(magic, b32encode(Buffer.concat([payload, sig])));
}

/**
 * 从私钥 JWK 取公钥 JWK。
 * Ed25519 私钥 JWK 自带 x 字段即对应公钥（BoringSSL 保证自洽），
 * 无需再做一次 key object 往返导出。
 */
export function derivePublicKey(privateKey) {
  if (!privateKey || privateKey.crv !== 'Ed25519' || !/^[A-Za-z0-9_-]{43}$/.test(privateKey.x ?? '')) {
    throw new Error('privateKey 不是合法的 Ed25519 JWK');
  }
  return { kty: 'OKP', crv: 'Ed25519', x: privateKey.x };
}

function formatCode(magic, body) {
  if (body.length !== BODY_LEN) {
    throw new Error(`body 必须是 ${BODY_LEN} 个 Base32 字符，收到 ${body.length}`);
  }
  const groups = [];
  for (let i = 0; i < body.length; i += 8) groups.push(body.slice(i, i + 8));
  return `${magic}-${groups.join('-')}`;
}
