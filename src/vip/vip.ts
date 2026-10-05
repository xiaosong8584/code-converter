/**
 * VIP 激活码验证模块（Ed25519 离线签名，移植自 desktoppet auth/vip.ts）。
 *
 * 格式（不区分大小写，连字符 / 空格可省略）：
 *   VIPU0002-XXXXXXXX-XXXXXXXX-…（通用码，15 组 × 8 个 Base32 字符）
 *   VIPD0002-…                                              （专用码）
 *
 * 数据布局（15 组 = 120 个 Base32 字符 = 75 字节）：
 * - [0]        类型字节（通用 0x55 / 专用 0x44）
 * - [1..2]     通用码：到期日（自 2026-01-01 UTC 的天数，uint16 大端）；专用码填 0
 * - [3..8]     专用码：SHA-256(deviceId) 前 6 字节；通用码填 0
 * - [9..10]    保留位（生成器填 0）
 * - [11..74]   Ed25519 签名（64 字节），覆盖前 11 字节
 *
 * 安全模型：
 * 包内只带【公钥】，私钥只存在于作者本地 .vip-secret（不进 git，不进包）。
 * 攻击者拿到构建产物也无法伪造激活码。
 *
 * 本插件与 desktoppet 复用同一密钥对（同作者）：desktoppet/.vip-secret
 * 的私钥可直接为本插件签发激活码，scripts/generate-vip-code.mjs 同款。
 *
 * 已知边界（同参考实现，属阶段 2，必须有服务端）：
 * ① 通用码可被分享（静态 bearer token 无使用次数限制）；
 * ② 到期日按本地时钟判断 —— 已由 seal.ts 时间高水位缓解（最多骗回 24h）；
 * ③ 无吊销 —— 私钥泄露只能靠 magic 版本号整体轮换（全部旧码作废）。
 *
 * 兼容性：Web Crypto 的 Ed25519 需 Chromium 113+（Obsidian ≥ 1.5.8）。
 * manifest 的 minAppVersion 保持 1.0.0，仅 VIP 激活依赖新版本 —— 由
 * isEd25519Available() 做运行时探测，不支持时给用户明确提示而非静默失败。
 *
 * 轮换流程：生成新密钥对（公钥写回本文件 ED25519_PUB_X）→ magic 末 4 位
 * 版本号 +1 → 重新签发激活码。已激活用户不受影响：激活状态存在 data.json，
 * 加载时不重新验签（但需过 seal 完整性指纹）。
 */

import { advanceSeal, effectiveNow } from "./seal";
import type { SealFailReason, VipSeal } from "./seal";

/**
 * Ed25519 公钥 JWK 的 x 分量（Base64URL，43 字符 = 32 字节）。
 * 与 desktoppet 共用同一密钥对（勿手动编辑；轮换时用签发脚本重生成后替换）。
 */
const ED25519_PUB_X = "RRRNVXgbJPjQHj-UaYOG6291BusXB_JEHQKIl6xl-r8";

/** 魔数（同时也是格式版本号；轮换密钥时末 4 位 +1） */
const MAGIC_UNIVERSAL = "VIPU0002";
const MAGIC_DEDICATED = "VIPD0002";

/** 天数纪元：2026-01-01 UTC（uint16 可表示到 2205 年） */
const EPOCH_UTC = Date.UTC(2026, 0, 1);

/** 数据段布局常量 */
const DATA_LEN = 75; // 总字节数（11 载荷 + 64 签名）
const BODY_LEN = 120; // Base32 字符数（15 组 × 8）
const PAYLOAD_LEN = 11; // 被签名覆盖的前缀长度
const SIG_LEN = 64; // Ed25519 签名长度
const TYPE_UNIVERSAL = 0x55;
const TYPE_DEDICATED = 0x44;

export type VipType = "universal" | "dedicated";

export interface VipState {
	active: true;
	type: VipType;
	/** 通用码有到期日（YYYY-MM-DD）；专用码为 null */
	expiresAt: string | null;
	/** 激活日期（ISO YYYY-MM-DD） */
	activatedAt: string;
}

/**
 * 完整性指纹（见 vip/seal.ts）必须与 VipState **平级**存放在 data.json 顶层，
 * 不能嵌在 vip 里 —— 否则 VIP 一旦过期、vip 被置 null，指纹随之丢弃，
 * 时间高水位就停在「最后一次成功加载」，攻击者回拨系统时钟仍能重新买到有效期。
 */
export type { VipSeal };

/**
 * 已激活 VIP 是否仍在有效期内（加载时的二次检查，不需要验签）。
 *
 * nowMs 必须是 effectiveNow() 的结果，否则用户回拨系统时钟就能绕过。
 * 专用码永不过期；到期日当天仍有效（字符串比较，避免时区解析问题）。
 */
export function isStillValid(vip: VipState, nowMs: number): boolean {
	if (vip.type === "dedicated" || vip.expiresAt == null) return true;
	return vip.expiresAt >= new Date(nowMs).toISOString().slice(0, 10);
}

/** 一次启动时的 VIP 判定结果（调用方负责映射到 UI 与存储） */
export type VipRestoreResult = {
	/**
	 * 本次启动后应落盘的指纹。null = 不落盘。
	 * **status 为 expired 时它同样非 null，必须落盘。**（理由见 seal.ts ①）
	 */
	seal: VipSeal | null;
	/** 系统时钟低于高水位超过容忍度（仅记录，不提示） */
	clockRolledBack: boolean;
} & (
	| { status: "active"; vip: VipState }
	| { status: "inactive" }
	| { status: "invalidated"; reason: SealFailReason | "no-seal" }
	| { status: "expired"; expiresAt: string | null }
);

/**
 * 判定一份来自 data.json 的记录是否仍然可信，可信则推进指纹。
 *
 * vip 与 seal 是 data.json 的两个**平级**字段。
 * 判定顺序：无指纹 → 指纹验真 → 到期判定。
 * 纯函数：不读写任何存储，调用方负责把 result.seal 与 result.vip 写回。
 *
 * 为什么「缺 seal」不补种（关键）：codeHash 只能在激活时算 —— 那时手上才有
 * 原始激活码；加载时只有 VipState，由它算出的指纹是伪造者也能算的。
 * 于是「删 seal → 下次启动补种」会变成完整的免费 VIP 通道。
 *
 * @param nowMs 本次启动的真实时间。默认 Date.now()；测试可注入固定值。
 */
export async function restoreVipState(
	storedVip: VipState | null | undefined,
	storedSeal: VipSeal | null | undefined,
	deviceId: string,
	nowMs: number = Date.now()
): Promise<VipRestoreResult> {
	const hasVip = storedVip !== null && storedVip !== undefined && storedVip.active === true;

	if (!storedSeal) {
		// 无指纹：从未激活（无 VIP）或老数据 / 手写记录（有 VIP）
		if (!hasVip) return { status: "inactive", seal: null, clockRolledBack: false };
		return { status: "invalidated", reason: "no-seal", seal: null, clockRolledBack: false };
	}

	const check = await advanceSeal(storedSeal, deviceId, nowMs);
	if (!check.ok) {
		return { status: "invalidated", reason: check.reason, seal: null, clockRolledBack: false };
	}

	// 用「本次启动后的高水位」判到期：回拨时钟时取旧高水位，正常时等于当前时间。
	const effective = effectiveNow(check.next.maxSeen, nowMs);

	if (!hasVip) {
		// VIP 已失效但指纹仍合法：指纹继续推进落盘，让时间天花板单调上升
		return { status: "inactive", seal: check.next, clockRolledBack: check.clockRolledBack };
	}
	if (!isStillValid(storedVip, effective)) {
		return {
			status: "expired",
			expiresAt: storedVip.expiresAt,
			seal: check.next,
			clockRolledBack: check.clockRolledBack
		};
	}
	return {
		status: "active",
		vip: storedVip,
		seal: check.next,
		clockRolledBack: check.clockRolledBack
	};
}

/** Ed25519 公钥 JWK（导出以便测试注入自签密钥对） */
export interface Ed25519PubJwk {
	kty: "OKP";
	crv: "Ed25519";
	x: string;
}

/** RFC 4648 Base32 字母表（A-Z + 2-7，无 0/1/8/9，规避形近字符） */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 包内默认公钥 */
const PK_DEFAULT: Ed25519PubJwk = { kty: "OKP", crv: "Ed25519", x: ED25519_PUB_X };

/** 能力探测结果缓存：Ed25519 支持与否对整次运行都成立 */
let ed25519Supported: boolean | null = null;

/**
 * 当前环境是否支持 Web Crypto 的 Ed25519（Chromium 113+）。
 * 老版本 Obsidian 走这里返回 false，激活弹窗据此提示「请升级 Obsidian」。
 */
export async function isEd25519Available(): Promise<boolean> {
	if (ed25519Supported !== null) return ed25519Supported;
	try {
		await crypto.subtle.importKey("jwk", PK_DEFAULT, { name: "Ed25519" }, false, ["verify"]);
		ed25519Supported = true;
	} catch {
		ed25519Supported = false;
	}
	return ed25519Supported;
}

/**
 * 验证激活码（生产入口）。
 * 失败原因：格式错、魔数错、签名无效、已过期、设备不匹配、环境不支持 Ed25519。
 * 输入容忍：大小写混排、带 / 不带连字符、夹杂空格均可。
 */
export async function verifyVip(
	rawCode: string,
	deviceId: string,
	nowMs: number = Date.now()
): Promise<VipState | null> {
	return verifyVipCode(rawCode, deviceId, PK_DEFAULT, nowMs);
}

/**
 * 验证激活码（可注入公钥）。
 * 公钥作为参数而非模块常量传入，使测试能用自签密钥对走完整验签路径，
 * 不必污染生产入口。
 */
export async function verifyVipCode(
	rawCode: string,
	deviceId: string,
	pubKey: Ed25519PubJwk,
	/**
	 * 判定过期用的「当前时间」。生产入口传 Date.now()；
	 * 加载侧二次检查应传 effectiveNow()，否则回拨系统时钟即可绕过。
	 */
	nowMs: number = Date.now()
): Promise<VipState | null> {
	if (!(await isEd25519Available())) return null;

	const code = rawCode.toUpperCase().replace(/[\s-]/g, "");

	let magic: string;
	if (code.startsWith(MAGIC_UNIVERSAL)) magic = MAGIC_UNIVERSAL;
	else if (code.startsWith(MAGIC_DEDICATED)) magic = MAGIC_DEDICATED;
	else return null;

	const body = code.slice(magic.length);
	if (!new RegExp(`^[A-Z2-7]{${BODY_LEN}}$`).test(body)) return null;

	const bytes = base32Decode(body, DATA_LEN);
	if (!bytes) return null;

	const payload = bytes.subarray(0, PAYLOAD_LEN);
	const sig = bytes.subarray(PAYLOAD_LEN, PAYLOAD_LEN + SIG_LEN);

	const key = await crypto.subtle.importKey("jwk", pubKey, { name: "Ed25519" }, false, ["verify"]);
	// 签名覆盖前 11 字节（类型 + 到期日 / 设备指纹 + 保留位），任何一位被改都验签失败
	// TS 5.7 下 base32Decode 返回 Uint8Array<ArrayBufferLike>，需显式收窄为 BufferSource
	if (!(await crypto.subtle.verify("Ed25519", key, sig as BufferSource, payload as BufferSource)))
		return null;

	const activatedAt = new Date(nowMs).toISOString().slice(0, 10);

	// --- 通用码 ---
	if (payload[0] === TYPE_UNIVERSAL) {
		const days = (payload[1] << 8) | payload[2];
		const expiresAt = new Date(EPOCH_UTC + days * 86400000).toISOString().slice(0, 10);
		// 到期日当天仍有效（按日期字符串比较，避免时区解析问题）
		if (expiresAt < activatedAt) return null;
		return { active: true, type: "universal", expiresAt, activatedAt };
	}

	// --- 专用码 ---
	if (payload[0] === TYPE_DEDICATED) {
		// 设备指纹比对。指纹已在签名覆盖范围内，篡改必然验签失败；
		// 这里显式比较只是为了让失败语义清晰，不构成额外安全边界。
		const devHash = new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceId))
		);
		if (!timingSafeEqual(payload.subarray(3, 9), devHash.subarray(0, 6))) return null;
		return { active: true, type: "dedicated", expiresAt: null, activatedAt };
	}

	return null;
}

/** RFC 4648 Base32 解码（无填充；长度或字符集不符返回 null） */
function base32Decode(s: string, expectedLen: number): Uint8Array | null {
	let bits = 0;
	let value = 0;
	let pos = 0;
	const out = new Uint8Array(expectedLen);
	for (const ch of s) {
		const idx = B32.indexOf(ch);
		if (idx < 0) return null;
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			if (pos >= expectedLen) return null;
			out[pos++] = (value >>> (bits - 8)) & 0xff;
			bits -= 8;
		}
	}
	// 剩余位必须为 0：既保证字节数精确，也拒绝被拼接 / 截断的码
	if (pos !== expectedLen || bits !== 0) return null;
	return out;
}

/** 恒定时间比较（防逐字节探测） */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
	return r === 0;
}

/**
 * 生成 UUID v4（deviceId 用）。
 * 优先用 crypto.randomUUID()（Chromium 92+），
 * 老版本 Obsidian 回退到 crypto.getRandomValues。
 */
export function generateUUID(): string {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	const b = crypto.getRandomValues(new Uint8Array(16));
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = Array.from(b)
		.map((x) => x.toString(16).padStart(2, "0"))
		.join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
