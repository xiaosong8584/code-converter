/**
 * VIP 状态完整性指纹（纯本地，无服务端）。
 *
 * 移植自 desktoppet auth/seal.ts，目标一致：让 data.json 里的 vip 块
 * 「被手改 / 被复制 / 系统时钟被回拨」在下次启动时变得无效或至少可见。
 * 两个正交机制：
 *
 *  ① 时钟高水位 —— effectiveNow()
 *     maxSeen 记录插件见过的最大时间戳；有效当前时间取
 *     max(墙钟, maxSeen - TOLERANCE_MS) —— 即「时间只能往前走」。
 *     通用码的到期判定用这个值，回拨系统时钟拿不回有效期。
 *
 *     **前置条件：seal 必须每次启动都落盘，即使 VIP 已过期。**
 *     因此 seal 与 vip **平级**存放在 data.json（见 vip.ts 的 restoreVipState），
 *     不随 VIP 失效而丢弃。
 *
 *     刻意用 max 而不是「检测回拨 + 惩罚」，为的是零误报：跨时区、
 *     云同步跳变、休眠唤醒都不会被误判。
 *
 *  ② 滚动摘要 —— computeSeal() / verifySeal()
 *     h = SHA-256(v|deviceId|codeHash|maxSeen|opens|SEAL_SECRET) 前 32 hex。
 *     纯函数（不做链式累积），验证 = 重算比对。
 *     覆盖 deviceId 可拦「复制他人 data.json」；覆盖 codeHash 可拦
 *     「只改 vip.active / expiresAt」。
 *
 * 为什么指纹缺失时不补种、而要求重新激活（关键设计）
 * codeHash 只能在激活时算 —— 那时手上才有原始激活码；加载时只有
 * VipState（type / expiresAt / activatedAt），由它算出的指纹是伪造者
 * 也能算的。于是「删掉 seal → 下次启动补种」会变成完整的免费 VIP 通道。
 * 因此加载时遇到无 seal 的 active vip，只能视为不可信并要求重新激活。
 * 代价是升级后现有用户要重新输一次码，这是必须付的。
 *
 * 能力边界（勿当作硬安全边界）
 * SEAL_SECRET 是包内常量，main.js 可逆出，因此本层是**篡改可见 +
 * 回拨封顶**，不是不可篡改。真正的吊销、使用次数、分享防护需要服务端。
 */

/** 指纹格式版本（调整摘要输入或布局时 +1） */
export const SEAL_VERSION = 1 as const;

/** 时钟回拨容忍度 24h：吸收跨时区 / 云同步 / 休眠唤醒的抖动 */
export const TOLERANCE_MS = 24 * 60 * 60 * 1000;

/** 包内常量（见文件头「能力边界」）；与 desktoppet 区分开 */
const SEAL_SECRET = "code-converter-vip-seal-v1";

/** VIP 完整性指纹（与 vip 平级存进 data.json，见文件头 ① 的前置条件） */
export interface VipSeal {
	/** 指纹格式版本 */
	v: typeof SEAL_VERSION;
	/** 绑定的设备 ID（复制他人 data.json 会被拦） */
	deviceId: string;
	/** 激活码指纹（SHA-256 前 16 字节 hex） */
	codeHash: string;
	/** 时间高水位（ms）：有效当前时间不低于此值减 TOLERANCE_MS */
	maxSeen: number;
	/** 通过校验的启动次数（仅作审计信号，异常只记录不惩罚） */
	opens: number;
	/** 滚动摘要 */
	h: string;
}

/** 摘要输入（去掉 h 本身） */
type SealCore = Omit<VipSeal, "h">;

/**
 * 有效当前时间。时钟无法回拨：取墙钟与「高水位 - 容忍度」的较大者。
 *
 * wallMs 必须显式传入（默认 Date.now()）。**不要**在内部读 Date.now()：
 * 判定链上游已经取过一次时间，这里再取一次会引入秒级不一致，
 * 更严重的是让测试无法注入固定时间 —— 断言会变成空过。
 */
export function effectiveNow(
	maxSeen: number | undefined,
	wallMs: number = Date.now(),
	toleranceMs: number = TOLERANCE_MS
): number {
	return Math.max(wallMs, (maxSeen ?? 0) - toleranceMs);
}

/** SHA-256 → 完整 hex */
export async function sha256Hex(text: string): Promise<string> {
	const bytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
	);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * 激活码指纹：SHA-256 前 16 字节（32 hex）。
 * 先按验证侧同一规则归一化（大写 + 去空格与连字符），
 * 同一码无论输入格式如何得到同一指纹。
 */
export async function codeFingerprint(rawCode: string): Promise<string> {
	return (await sha256Hex(rawCode.toUpperCase().replace(/[\s-]/g, ""))).slice(0, 32);
}

/** 计算滚动摘要（纯函数） */
export async function computeSeal(s: SealCore): Promise<string> {
	const raw = `${s.v}|${s.deviceId}|${s.codeHash}|${s.maxSeen}|${s.opens}|${SEAL_SECRET}`;
	return (await sha256Hex(raw)).slice(0, 32);
}

/**
 * 校验指纹。结构校验与摘要比对都在这里 —— 任何字段缺失 / 类型不对
 * 一律按「被篡改」处理（返回 false），不抛异常。
 */
export async function verifySeal(seal: VipSeal | null | undefined): Promise<boolean> {
	if (!seal || typeof seal !== "object") return false;
	if (seal.v !== SEAL_VERSION) return false;
	if (typeof seal.deviceId !== "string" || seal.deviceId.length === 0) return false;
	if (typeof seal.codeHash !== "string" || seal.codeHash.length < 16) return false;
	if (typeof seal.maxSeen !== "number" || !Number.isFinite(seal.maxSeen)) return false;
	if (typeof seal.opens !== "number" || !Number.isFinite(seal.opens)) return false;
	if (typeof seal.h !== "string" || seal.h.length !== 32) return false;
	return (await computeSeal(seal)) === seal.h;
}

/**
 * 激活时铸造首份指纹。opens 从 0 开始 —— 首次启动由 advanceSeal 计到 1。
 * nowMs 由调用方显式传入，便于测试注入固定时间。
 */
export async function makeSeal(deviceId: string, rawCode: string, nowMs: number): Promise<VipSeal> {
	const core: SealCore = {
		v: SEAL_VERSION,
		deviceId,
		codeHash: await codeFingerprint(rawCode),
		maxSeen: nowMs,
		opens: 0
	};
	return { ...core, h: await computeSeal(core) };
}

export type SealFailReason = "wrong-device" | "tampered" | "malformed";

export type SealAdvanceResult =
	| { ok: true; next: VipSeal; clockRolledBack: boolean }
	| { ok: false; reason: SealFailReason };

/**
 * 启动时推进指纹：先验真，再抬高高水位 + 计一次启动。
 *
 * 通过校验后返回**新的** seal（调用方需写回 data.json）。
 * clockRolledBack = 真实时钟低于高水位超过容忍度（已被静默吸收，
 * 到期判定仍按高水位算）；仅作为审计信号记录，不惩罚。
 */
export async function advanceSeal(
	seal: VipSeal | null | undefined,
	deviceId: string,
	nowMs: number = Date.now()
): Promise<SealAdvanceResult> {
	if (!seal || typeof seal !== "object") return { ok: false, reason: "malformed" };
	if (typeof seal.deviceId !== "string" || typeof seal.h !== "string") {
		return { ok: false, reason: "malformed" };
	}
	if (seal.deviceId !== deviceId) return { ok: false, reason: "wrong-device" };
	if (!(await verifySeal(seal))) return { ok: false, reason: "tampered" };

	const clockRolledBack = nowMs < seal.maxSeen - TOLERANCE_MS;
	const core: SealCore = {
		v: SEAL_VERSION,
		deviceId: seal.deviceId,
		codeHash: seal.codeHash,
		maxSeen: Math.max(seal.maxSeen, nowMs),
		opens: seal.opens + 1
	};
	return { ok: true, clockRolledBack, next: { ...core, h: await computeSeal(core) } };
}
