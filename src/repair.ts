/**
 * 乱码修复核心：检测并修复"二次编码"乱码（mojibake baked into valid UTF-8）。
 *
 * 原理：文件内容在历史上被"用错误编码解码 → 回存 UTF-8"，
 * 字节信息仍在（无 U+FFFD 时），可反向链恢复：
 *   当前文本 --编码回转为误读编码M的字节--> --用正确编码T解码--> 原文
 *
 * 支持的修复链（M = 误读编码，需可无损编码回转；T = 真实编码候选池）：
 *   - M = latin-1   （ÖÐÎÄ 型，GBK/Big5/SJIS 等被 Latin-1 误读）
 *   - M = cp1252    （含 €‚ƒ 等 0x80-0x9F 特殊映射）
 *   - M = gbk       （涓枃 型，UTF-8 被误读为 GBK，中文工具最常见）
 *
 * 策略：**逐行修复**。某些行因字节组合非法/U+FFFD 无法反向，保持原样不动；
 * 只要有任一行得到高质量结果即报告 found，由用户在确认弹窗里预览后决定。
 *
 * 第一原则：**宁可不修，不能修错**——本来就正确的文本绝不允许被改动。
 * 为此设多重防线（CJK 双字节空间大量重叠，逐行三重质量门槛挡不住
 * "巧合"解码成另一种脚本；全面测试 test/mojibake-cases/ 固化全部场景）：
 *  1. 行级一致性门：修前行有明确文字系统身份（han/kana/hkana/hangul/cyrillic）时，
 *     修后必须是同一脚本，否则该行拒修；
 *  2. 文档级一致性门：主导真值编码的脚本必须与全文主导脚本相容
 *     （中文文档不可能"修复"成韩文），否则整篇不改动；
 *  3. 孤立段门：全孤立非 ASCII 行（Müller/École 型欧洲文字）禁双字节真值
 *     （gbk/big5/euc-kr）与西里尔输出候选——多字节编码的乱码必产生 ≥2
 *     连续非 ASCII 段，孤立变音符号是正常欧洲文字的指纹；
 *  4. 半角假名门：解码输出 100% 半角假名 = 字节恰落 Shift-JIS 单字节区的
 *     巧合（Big5/EUC-KR 字节对典型），拒绝；
 *  5. 西里尔词形罚分：koi8-r/cp1251 互为错位解码平手时，取"词首大写+
 *     后续小写"词形正常者；且西里尔候选优先让位于已过门槛的 kana/han/hangul
 *     候选（Latin-1 误读 CJK 时 cp1251 常得满分西里尔垃圾，真日文/中文/韩文
 *     解码虽 plaus 略低却是正确链），避免日文被修成西里尔；
 *  6. 拉丁邻接门（F6）：解码结果里非拉丁文字系统字符紧贴 Basic Latin 字母
 *     （GrцЯe / Gr秤e 型）即拒——真修复的异文块与 Latin 必有空格/标点分隔。
 *     实测拦下正常德文 "Größe" 被 cp1252→cp1251 修成 "GrцЯe"。
 *  7. 误读编码可无损回转门：cp1252 误读层仅接受 ∈ CP1252 字符集的字符
 *     （≤0xFF 或 0x80-0x9F 特殊映射）；阿拉伯/希伯来/泰文等码点 >0xFF 且不在
 *     映射表的字符直接令该链失效——否则合法 UTF-8 的正常阿拉伯文/希伯来文会被
 *     静默"修"成乱码（实测：正常阿拉伯文 نص 被 cp1252→utf-8 修成 "F5 91(J..."，
 *     直接违反第一原则）。latin-1/gbk 误读层对 >0xFF 字符本就返回 null，仅 cp1252
 *     旧分支曾把码点当字节静默截断，已修正。
 * 另：**UTF-8 BOM 容忍**（第 8 道防线）——插件用 TextDecoder("utf-8")（不带
 *   ignoreBOM）读文件，带 BOM 文件首行行首保留 U+FEFF；U+FEFF 不在任何误读编码
 *   可无损回转的字符集内，若不剥离则整个首行被静默跳过（首行常是标题）。repairLine
 *   先剥离行首 BOM 搜候选、命中后拼回，只修 BOM 之后的乱码，不越权改正文。
 * 已知歧义（算法不可判，依赖确认弹窗预览兜底）：韩文 EUC-KR 与 GBK 常用
 * 汉字双字节空间大量重叠且同为常用字（한국어 ↔ 茄惫绢 同为 1.00 分），
 * 候选按 gbk 优先取中文；真韩文用户于确认弹窗里可识别拒修。
 */

import { scoringRatio } from "./encoding";
import { charToGbk, isCommonHanzi } from "./encode-tables";

/** 修复结果 */
export interface RepairResult {
	/** 是否找到至少一行的可靠修复方案 */
	found: boolean;
	/** 修复后全文（未修复的行保持原样） */
	text: string;
	/** 修复行数 / 含非 ASCII 的总行数 */
	repairedLines: number;
	scannedLines: number;
	/** 采用最多的修复链（展示用） */
	chain?: string;
	/** 修复后全文可读性评分 0-100 */
	score: number;
	/** 全文 U+FFFD 数量（这部分永远不可恢复） */
	fffdCount: number;
}

/** 单行修复质量门槛 */
const REPAIR_MIN_SCORE = 0.95;

/** "该文本属于某文字系统"的命中率门槛（占全部非 ASCII 字符，文档/行级共用） */
const SCRIPT_RATE = 0.45;

/** CP1252 的 0x80-0x9F 特殊映射（字符 → 字节） */
const CP1252_HIGH: Record<number, number> = {
	0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
	0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
	0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
	0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
	0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
	0x017e: 0x9e, 0x0178: 0x9f
};

/**
 * 把文本按"误读编码 M"编码回转为原始字节。
 * 必须无损：任何一个字符映射不回去，返回 null（该链对该文本不适用）。
 */
function encodeBack(text: string, misread: string): Uint8Array | null {
	const out: number[] = [];
	for (const ch of text) {
		const code = ch.codePointAt(0)!;
		if (code < 0x80) {
			out.push(code);
			continue;
		}
		if (misread === "latin-1") {
			if (code > 0xff) return null;
			out.push(code);
		} else if (misread === "cp1252") {
			if (code <= 0xff) {
				out.push(code);
			} else {
				// 0x80-0x9F 段：走 CP1252 特殊映射（€‚ƒ 等，这些 Unicode 码点
				// > 0xFF，必须映射到对应字节）；其余码点 > 0xFF 的字符（阿拉伯/
				// 希伯来/泰文/西里尔等）根本不在 CP1252 字符集内，不可能是
				// "被 CP1252 误读"产生的文本——必须返回 null 让该链失效，否则
				// 会把合法 UTF-8 的正常阿拉伯文/希伯来文静默"修"成乱码
				// （实测：正常阿拉伯文 نص 被 cp1252→utf-8 修成 "F5 91(J..."）。
				const mapped = CP1252_HIGH[code];
				if (mapped !== undefined) out.push(mapped);
				else return null;
			}
		} else if (misread === "gbk") {
			const b = charToGbk(code);
			if (!b) return null;
			out.push(b[0], b[1]);
		} else {
			return null;
		}
	}
	return new Uint8Array(out);
}

/** 真实编码候选池（按常见度），严格解码失败即跳过 */
const TRUTH_CANDIDATES = [
	"utf-8",
	"gbk",
	"big5",
	"shift-jis",
	"euc-kr",
	"cp1251",
	"koi8-r",
	"cp1252",
	"cp1254"
];

/** TextDecoder 实例缓存：解码器在非流式 decode 下无状态，复用可省掉
 * 每条候选链的实例新建开销（3 误读 × 9 真值 × 行数，量级极大） */
const DECODERS = new Map<string, TextDecoder>();
function decoderOf(enc: string): TextDecoder {
	let d = DECODERS.get(enc);
	if (!d) {
		d = new TextDecoder(enc, { fatal: true });
		DECODERS.set(enc, d);
	}
	return d;
}

function strictDecode(bytes: Uint8Array, enc: string): string | null {
	try {
		return decoderOf(enc).decode(bytes);
	} catch {
		return null;
	}
}

/**
 * 宽 CJK 表意文字判定（不区分常用/生僻）：汉字基本区 + 扩展 A + 兼容汉字 +
 * 扩展 B 及以上。刻意**不**依赖 isCommonHanzi（GB2312 一级常用字位图）——繁体中文
 * 与日文常用汉字大量落在 GB2312 一级字库之外（體/測/試/語 等），用常用字表判定会把
 * 「正确回转」误判成垃圾。
 */
function isAnyCjkIdeograph(code: number): boolean {
	return (
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		code >= 0x20000 && code <= 0x2ffff
	);
}

/**
 * 该真值编码是否使用「宽 CJK 判据」（见下方 plausibility 的实测依据）。
 * 分档是刻意收窄的，不是随手放宽——放宽到哪些真值、为什么，都有夹具实证。
 */
function usesWideCjk(truth: string | undefined): boolean {
	return truth === "utf-8" || truth === "shift-jis";
}

/**
 * 合理度评分（判别"解码对了"vs"解码成另一种垃圾"）：
 * scoringRatio 对任何可打印垃圾（如 Big5 误读出的生僻汉字）都给满分，
 * 无法区分语言。这里改用"常用字符命中率"：
 *   命中 = ASCII 可打印/空白 + 常用汉字（严格档）或全部 CJK 表意文字（宽档）
 *        + 假名/谚文/西里尔/常用标点
 *
 * `truth` 决定汉字判据档位。分档的实测依据（放宽错一档就是安全事故）：
 *  - **gbk 必须保持严格**。这是压制「任意字节被 gbk 解码出的垃圾候选」唯一有效的杠杆：
 *    GBK 误读出的垃圾串常用字命中率极低（擔杮岅僥僗僩 0%、脏殡耦躔囗疙 46%、
 *    統杅汐汕污汛 67%，均低于 0.95 门槛）。一旦放宽，垃圾候选与正确候选平手，而
 *    候选池里 gbk 排序在前，垃圾会抢走胜利（实测正常德文被修成 `Gr<U+E506>e`、
 *    俄文被修成「脏殡 耦躔囗疙」，27/27 → 23/27）。
 *  - **big5 同样不能放宽**。Big5 一/二级字库覆盖 13706 字，对上述垃圾串命中率达
 *    72%–100%（統杅汐汕污汛 100%），毫无判别力；且 Big5 双字节空间极稠密，俄文/
 *    希腊文乱码字节也总能被 big5 合法解码，放宽后夹具 P05/P06/P12 回归（27/27 →
 *    24/27，俄文被修成「婄澣 勷臝鳧貲」）。
 *  - **shift-jis 可以放宽**。SJIS 首字节空间窄（0x81–0x9F / 0xE0–0xFC），俄文/希腊文
 *    乱码字节几乎无法被合法解码为 SJIS，放宽不会让它们冒用日文身份；而日文常用汉字
 *    （語 等）大量不在 GB2312 一级表内，严格判据会把正确的日文回转压到 0.83 而拦死。
 *    放宽后夹具 P03 从「只修好第 1 行」变为完整还原，27/27 不回退。
 *  - **utf-8 同样放宽**。utf-8 解码是确定性的，不存在「另一种 utf-8 垃圾候选」竞争；
 *    而繁体中文/日文的 UTF-8 被 Latin-1 误读（Obsidian 生态最常见的一类）此前整类无法
 *    修复——「繁體中文測試」的正确回转命中率仅 0.50，被 0.95 门槛拦死。
 *
 * 注意：**不含拉丁扩展区（0x80-0x24F）**——那里正是 ÖÐÎÄ/Ã© 型乱码的聚集地，
 * 把它算命中会让"正常中文被误修成拉丁串"。
 *
 * 省略 `truth` 时按宽档计分。该口径只用于向用户展示「修复后全文可读性」，
 * 不参与任何候选筛选；宽档让「繁體中文測試」这类正确文本显示 100 而非 50。
 */
function plausibility(text: string, truth?: string): number {
	if (!text.length) return 0;
	// 谓词只选一次，避免在字符循环里重复求值（27 条候选链 × 行数，量级极大）
	const hanHit = usesWideCjk(truth) ? isAnyCjkIdeograph : isCommonHanzi;
	let good = 0;
	let total = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0)!;
		if (code === 0xFFFD) continue;
		total++;
		const hit =
			(code >= 9 && code <= 13) ||
			(code >= 0x20 && code <= 0x7e) ||
			(code >= 0x400 && code <= 0x4ff) || // 西里尔
			(code >= 0x3040 && code <= 0x30ff) || // 假名
			(code >= 0xac00 && code <= 0xd7a3) || // 谚文
			(code >= 0x2000 && code <= 0x206f) || // 通用标点
			(code >= 0x3000 && code <= 0x303f) || // CJK 标点
			(code >= 0xff00 && code <= 0xffef) || // 全角
			hanHit(code);
		if (hit) good++;
	}
	return total === 0 ? 0 : good / total;
}

/** 是否含有非 ASCII 字符（用 charCodeAt 判断，避免控制字符正则告警） */
function hasNonAscii(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		if (s.charCodeAt(i) > 0x7f) return true;
	}
	return false;
}

/**
 * 行内是否存在"≥2 个连续非 ASCII 字符"段。
 * 多字节编码（GB2312/Big5/EUC-KR 的尾字节 ≥0xA1）的乱码在 Latin-1 误读下，
 * 每个原字符必然表现为 ≥2 个连续非 ASCII 字符（如 ÖÐÎÄ）；而欧洲文字的
 * 变音符号（Müller/Straße/École）是孤立单字符（前后都是 ASCII 字母）。
 * 据此实现"孤立段门"：全孤立行的双字节真值候选与西里尔输出候选一律拒绝。
 */
function hasNonAsciiRun(line: string): boolean {
	let run = 0;
	for (const ch of line) {
		if (ch.codePointAt(0)! >= 0x80) {
			if (++run >= 2) return true;
		} else {
			run = 0;
		}
	}
	return false;
}

/**
 * 解码结果是否 100% 半角假名（≥1 个）。Shift-JIS 的半角假名来自单字节
 * 0xA1-0xDF；若解码输出全为半角假名，说明输入字节只是恰好全部落在该
 * 单字节区（Big5/EUC-KR 字节对的典型巧合），绝非真日文 → 判巧合拒绝。
 */
function isAllHalfwidthKana(text: string): boolean {
	let nonAscii = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0)!;
		if (code < 0x80) continue;
		nonAscii++;
		if (code < 0xff61 || code > 0xff9f) return false;
	}
	return nonAscii > 0;
}

/**
 * 西里尔词形合理性罚分：正常俄文是"词首大写+后续小写"或全小写；
 * koi8-r 与 cp1251 互为错位解码时会出现"词首小写+词中大写"的反常词形
 * （koi8-r 文本被 cp1251 解成 "òÅÓÔ"）。选优时罚分低者胜，用于打破两个
 * 西里尔真值候选的平手（实测 "Тест" 0 罚 vs "òÅÓÔ" 1 罚）。
 */
function cyrWordShapePenalty(text: string): number {
	let penalty = 0;
	for (const word of text.split(/[^ЁёА-я]+/)) {
		if (!word) continue;
		const codes = [...word].map((c) => c.codePointAt(0)!);
		const hasUpper = codes.some((c) => (c >= 0x410 && c <= 0x42f) || c === 0x401);
		const firstLower = (codes[0] >= 0x430 && codes[0] <= 0x44f) || codes[0] === 0x451;
		if (hasUpper && firstLower) penalty++;
	}
	return penalty;
}

/**
 * 拉丁邻接门（F6）：解码结果里若存在"非拉丁文字系统字符紧贴 Basic Latin 字母
 * (A-Za-z)"，说明是 Latin 文本里掺了几个异文乱码（GrцЯe / Gr秤e 型），绝非真
 * 修复——真修复的异文块与 Latin 之间必有空格/标点分隔。正常德文 "Größe" 曾被
 * cp1252→cp1251 以 1.0 压线修成 "GrцЯe"，靠此门拦下（第一原则：正确文本绝不动）。
 */
function hasLatinAdjacentScript(text: string): boolean {
	const chars = [...text];
	for (let i = 0; i < chars.length; i++) {
		const c = chars[i].codePointAt(0)!;
		// 第五轮修复：这张表原先只列了 6 段，**任何不在清单里的"异文字符"都漏过**。
		// 最致命的是私用区 U+E000–U+F8FF——Shift-JIS/Big5/EUC-KR 对"字节对结构合法、
		// 但语义未收录"的组合（如 SJIS 0xF6 0xDF）会解出 PUA 字符。实测
		// `Größe: 42, Preis: 100`（完全正常的德文）被 latin-1 → shift-jis 修成
		// `Gr<U+E506>e: 42, ...`：该 PUA 字符既不在旧清单里、也不在任何 plausibility
		// 命中段，于是 printable/plaus 恰好 0.950 压线、post=undefined、孤立段门因
		// hasRun=true 不生效，八道门**全部放行**，正确文本被写坏（违反第一原则）。
		// 这里补齐 CJK 兼容汉字 / CJK 扩展 B+ / 谚文 Jamo / PUA / 其他字母区块。
		// 刻意不覆盖通用标点与符号区（U+2000–U+303F、U+20A0–U+2BFF 等）：它们与
		// 拉丁字母相邻是正常形态（`1945 — 1949`），把它们算异文会造成误拦。
		const nonLatin =
			(c >= 0x3400 && c <= 0x4dbf) || // 汉字扩展A
			(c >= 0x4e00 && c <= 0x9fff) || // 汉字
			(c >= 0xac00 && c <= 0xd7a3) || // 谚文
			(c >= 0x1100 && c <= 0x11ff) || // 谚文 Jamo
			(c >= 0x3130 && c <= 0x318f) || // 谚文兼容字母
			(c >= 0x3040 && c <= 0x30ff) || // 假名
			(c >= 0xff61 && c <= 0xff9f) || // 半角假名
			(c >= 0x400 && c <= 0x4ff) || // 西里尔
			(c >= 0x370 && c <= 0x3ff) || // 希腊
			(c >= 0x530 && c <= 0x58f) || // 希伯来
			(c >= 0x590 && c <= 0x5ff) || // 阿拉伯
			(c >= 0x900 && c <= 0x97f) || // 天城文
			(c >= 0xf900 && c <= 0xfaff) || // CJK 兼容汉字（SJIS 映射目标之一）
			(c >= 0xe000 && c <= 0xf8ff) || // 私用区：未收录字节对的解码垃圾，必拦
			c >= 0x20000 && c <= 0x2ffff; // CJK 扩展 B 及以上
		if (!nonLatin) continue;
		const prev = i > 0 ? chars[i - 1].codePointAt(0)! : 0;
		const next = i < chars.length - 1 ? chars[i + 1].codePointAt(0)! : 0;
		const adjLatin =
			(prev >= 0x41 && prev <= 0x5a) || (prev >= 0x61 && prev <= 0x7a) ||
			(next >= 0x41 && next <= 0x5a) || (next >= 0x61 && next <= 0x7a);
		if (adjLatin) return true;
	}
	return false;
}

/**
 * CJK 家族（汉字各扩展区 + CJK 兼容汉字 + 假名 + 半角假名）：日文行"漢字+平仮名
 * +片仮名"混排是正常形态，必须合并成单一类，否则真日文行会被误判为"跨脚本混合"。
 * 刻意用宽码位范围判定，**不**依赖 isCommonHanzi（GB2312 常用字表）——日文常用
 * 汉字大量不在 GB2312 常用表内（語/働/図/発/実/値/継 等），旧写法会把这些字归入
 * "other"，导致 "日本語テスト" 被判成 "cjk + other" 跨脚本混合而误报为垃圾。
 */
function isCjkFamily(code: number): boolean {
	return (
		(code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
		(code >= 0x4e00 && code <= 0x9fff) || // CJK 基本区
		(code >= 0xf900 && code <= 0xfaff) || // CJK 兼容汉字
		(code >= 0x3040 && code <= 0x30ff) || // 平/片假名
		(code >= 0xff61 && code <= 0xff9f) || // 半角假名
		code >= 0x20000 && code <= 0x2ffff // CJK 扩展 B 及以上
	);
}

/**
 * 测试/诊断用：判断一行是否为"连贯修复"——单一非拉丁脚本（无跨脚本混合乱码）
 * 且无拉丁邻接掺混（GrцЯe / Gr秤e 型）。用于歧义类用例通过判定：算法取最可能的
 * 单脚本修复（语言可能不符），但绝不允许产出"第三种混合垃圾"。
 */
export function lineIsCoherent(text: string): boolean {
	if (hasLatinAdjacentScript(text)) return false;
	const non = [...text].filter((ch) => {
		const c = ch.codePointAt(0)!;
		return c >= 0x80 && c !== 0xfffd;
	});
	if (non.length === 0) return true;
	let cls = "";
	for (const ch of non) {
		const code = ch.codePointAt(0)!;
		// 三分类：CJK 家族合并成 "cjk"；谚文、西里尔各自独立成类；其余 "other"。
		// hangul / cyrillic 必须保持独立，才能拦住真正的"混合乱码"
		//（中文文档被修成 CJK+西里尔 / CJK+谚文 的第三种文本）。
		let merged: string;
		if (isCjkFamily(code)) merged = "cjk";
		else if (code >= 0xac00 && code <= 0xd7a3) merged = "hangul";
		else if (code >= 0x400 && code <= 0x4ff) merged = "cyrillic";
		else merged = "other";
		if (cls && merged !== cls) return false; // 跨脚本 = 混合乱码
		cls = merged;
	}
	return true;
}


/**
 * 可判"文字系统身份"的脚本类：只含**自有文字系统**的 CJK/韩/假名/西里尔。
 * 刻意不含 latin-1/cp1252 的扩展区（Ö/Ç/Ã 等）——那里正是乱码候选
 * （ÖÐÎÄ 型）的聚集地，若把"文档里有 Ö"当成文档属于 Latin 而锁死
 * Latin 真值，会把本应修回中文的场景挡死。
 * hkana（半角假名 0xFF61-0xFF9F）单独成类：它是日文旧文件的正常原文，
 * 若不单列会被当成"无脚本命中"，被 gbk→shift-jis 链"修"成汉字垃圾。
 *
 * 该表同时用于：
 *  - `scriptDominant`：行内集中度（≥70% 单一脚本）
 *  - `dominantScriptOf`：文档锚与行级门（非 ASCII 命中率 ≥45%）
 */
const DOC_SCRIPT_CLASSES: Array<[string, (c: number) => boolean]> = [
	["han", (c) => isCommonHanzi(c)],
	["hangul", (c) => c >= 0xac00 && c <= 0xd7a3],
	["kana", (c) => c >= 0x3040 && c <= 0x30ff],
	["hkana", (c) => c >= 0xff61 && c <= 0xff9f], // 半角假名
	["cyrillic", (c) => c >= 0x400 && c <= 0x4ff]
];

function scriptDominant(text: string): boolean {
	const counts = new Map<string, number>();
	let nonAsciiHits = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0)!;
		if (code < 0x80) continue;
		for (const [name, test] of DOC_SCRIPT_CLASSES) {
			if (test(code)) {
				counts.set(name, (counts.get(name) || 0) + 1);
				nonAsciiHits++;
				break;
			}
		}
	}
	if (nonAsciiHits === 0) return true; // 纯 ASCII 行天然主导
	// CJK 家族（汉字/假名/半角假名）合并计算：日文行"漢字+平仮名+片仮名"混排
	// 是正常形态，逐类分开算时各占 ~50%，0.7 集中度门会把真日文行整体拒修
	// （实测："日本語テスト" han 3 / kana 3 → sd=false 假阴性）。西里尔/谚文
	// 是独立文字系统，仍单类计算。
	const cjk =
		(counts.get("han") || 0) +
		(counts.get("kana") || 0) +
		(counts.get("hkana") || 0);
	const maxSingle = Math.max(
		counts.get("hangul") || 0,
		counts.get("cyrillic") || 0,
		cjk
	);
	return maxSingle / nonAsciiHits >= 0.7;
}

/**
 * 主导脚本判定（文档锚与行级一致性门共用）：统计非 ASCII 字符中各脚本类的
 * "命中率"——最高命 中类占**全部非 ASCII 字符**（含全角标点、制表符、箭头等
 * 不属于任何脚本类的字符）的比例 ≥ threshold 即认定该文本"属于"该语言。
 * 无命中返回 undefined，调用方对其不做约束。
 *
 * 为什么用"非 ASCII 命中率"而不是"命中类内部占比"：中文文档里全角括号（）、
 * 制表符 │ ─ → 是高频字符（占非 ASCII 的 30%+），若把它们从分母剔掉，
 * 命中率会被稀释到 ~70%，门就挡不住截图场景（中文 README 被"巧合"修成韩文）。
 *
 * 同一份判据用于两个层级：
 *  - 文档级（repairMojibake 门）：全文文本，门槛 SCRIPT_RATE
 *  - 行级（逐行一致性门）：单行文本，同一门槛——修复不得改变行的文字系统身份
 */
function dominantScriptOf(text: string, threshold: number): string | undefined {
	const counts = new Map<string, number>();
	let nonAscii = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0)!;
		if (code < 0x80 || code === 0xfffd) continue;
		nonAscii++;
		for (const [name, test] of DOC_SCRIPT_CLASSES) {
			if (test(code)) {
				counts.set(name, (counts.get(name) || 0) + 1);
				break;
			}
		}
	}
	if (nonAscii === 0) return undefined;
	let best: string | undefined;
	let bestN = 0;
	for (const [n, c] of counts) {
		if (c > bestN) {
			bestN = c;
			best = n;
		}
	}
	return best && bestN / nonAscii >= threshold ? best : undefined;
}

/** 修复单行：返回 [修复后文本, 链标识] 或 null（无可靠方案） */
function repairLine(
	line: string
): { text: string; chain: string; score: number } | null {
	// UTF-8 BOM 容忍：main.ts 以 new TextDecoder("utf-8")（不带 ignoreBOM）解码，
	// 带 BOM 文件的第一行行首会保留一个 U+FEFF。BOM 不属于任何乱码模式，必须先
	// 剥离再搜候选——否则首字符 U+FEFF 会让三条误读链全部回转失败
	// （latin-1 拒 >0xFF、cp1252 不在特殊映射表、gbk 回转表内无此字符），整个
	// 首行被静默跳过，而首行往往正是最重要的标题行。命中修复后把 BOM 拼回，
	// 保留文件原有编码标记，不越权改动正文（stripBomOnConvert 只管转换路径）。
	const hasBom = line.charCodeAt(0) === 0xFEFF;
	const src = hasBom ? line.slice(1) : line;
	// 修去 U+FFFD 后无非 ASCII → 无乱码可言
	if (!hasNonAscii(src.replace(/\uFFFD/g, ""))) return null;
	const hasRun = hasNonAsciiRun(src);

	// 通过全部门槛的候选（逐链记录，用于后续择优/歧义判定）
	const passing: Array<{
		text: string;
		chain: string;
		plaus: number;
		post: string | undefined;
		utf8: boolean;
		cyrPen: number;
	}> = [];

	for (const misread of ["latin-1", "cp1252", "gbk"]) {
		const bytes = encodeBack(src, misread);
		if (!bytes) continue;
		for (const truth of TRUTH_CANDIDATES) {
			if (truth === misread) continue;
			const decoded = strictDecode(bytes, truth);
			if (decoded === null || decoded === src) continue;
			const printable = scoringRatio(decoded);
			if (printable < REPAIR_MIN_SCORE) continue;
			const plaus = plausibility(decoded, truth);
			// 脚本感知的合理度门槛：仅对 shift-jis（真日文链）放宽假名主导解码到
			// 0.80——日文常因含 GB2312 之外的汉字（語 等）合理度被压到 ~0.83，但
			// 假名本身是强日文信号。cp1251 解码出的半角假名只是字节巧合垃圾，
			// 绝不放宽（否则俄文会被修成半角假名垃圾），故放宽限定 truth=shift-jis。
			// 只算一次：post 供后面让位/拒修门复用（原先此处算 post0，几行后又对
			// 同一个 decoded 重算一遍同参数结果，属纯浪费——27 条候选链 × 行数）
			const post = dominantScriptOf(decoded, SCRIPT_RATE);
			const minPlaus =
				truth === "shift-jis" && (post === "kana" || post === "hkana")
					? 0.8
					: REPAIR_MIN_SCORE;
			if (plaus < minPlaus) continue;
			if (!scriptDominant(decoded)) continue;
			// 孤立段门：行内非 ASCII 全部孤立（无 ≥2 连续段）时，尾字节 ≥0xA1
			// 的双字节真值（GB2312/Big5/EUC-KR）在 Latin-1 误读下不可能产生
			// 这种形态，西里尔输出同理（俄文单词必为连续非 ASCII 段）。
			// 实测防线：正常德文 "Größe: 42, Preis: 100 €" 曾被 cp1252→euc-kr
			// 以 0.95/0.95 压线修成 "Gr秤e: ..."；Müller/École 型行曾险被
			// latin-1→cp1251 修成俄文（scoringRatio 补西里尔后会复活，必须同守）。
			if (
				!hasRun &&
				(truth === "gbk" || truth === "big5" || truth === "euc-kr")
			)
				continue;
			if (!hasRun && post === "cyrillic") continue;
			// 半角假名主导的输出拒修：半角假名（0xFF61-0xFF9F）只来自 Shift-JIS 单
			// 字节区；除 shift-jis 原链外，任何误读解码命中该区都是字节巧合（典型
			// cp1251 解俄文字节 → 半角假名垃圾）。真日文修复产出的是全角假名 kana，
			// 不受影响。实测拦下俄文被 cp1251 修成 "戝ﾊﾌ ﾇﾏﾔﾏﾗ"。
			if (post === "hkana") continue;
			// 纯半角假名输出拒绝：Big5/EUC-KR 字节对恰落 Shift-JIS 单字节
			// 半角假名区的"巧合"（实测：繁体行被修成 ｳ]ｩwﾀﾉ...）
			if (truth === "shift-jis" && isAllHalfwidthKana(decoded)) continue;
			// 拉丁邻接门（F6）：异文脚本字符紧贴 Basic Latin 字母 = Latin 文本
			// 掺异文乱码（GrцЯe / Gr秤e 型），绝非真修复，拒。
			if (hasLatinAdjacentScript(decoded)) continue;
			passing.push({
				text: decoded,
				chain: `${misread} → ${truth}`,
				plaus,
				post,
				utf8: truth === "utf-8",
				cyrPen: cyrWordShapePenalty(decoded)
			});
		}
	}
	if (passing.length === 0) return null;
	// 择优：合理度高者胜；平手先比西里尔词形罚分（打破 koi8-r/cp1251 错位解码
	// 平手，实测 koi8-r 文本曾险被先到的 cp1251 候选抢修）；再平手优先 UTF-8 链。
	let best = passing[0];
	for (const c of passing) {
		if (
			c.plaus > best.plaus + 1e-9 ||
			(Math.abs(c.plaus - best.plaus) <= 1e-9 && c.cyrPen < best.cyrPen) ||
			(Math.abs(c.plaus - best.plaus) <= 1e-9 &&
				c.cyrPen === best.cyrPen &&
				c.utf8 &&
				!best.utf8)
		) {
			best = c;
		}
	}
	// 西里尔优先让位于自有文字系统（FIX）：Latin-1 误读 CJK 时 cp1251 解码常得
	// 满分西里尔垃圾，而真正的日文/韩文解码（kana/hangul/hkana）虽 plaus 略低却是
	// 正确链——只要自有文字系统候选已过门槛，就优先采用，避免日文被修成西里尔。
	// 仅限 kana/hangul/hkana，不含 han：gbk 解码俄文字节也会产出汉字垃圾，若让位
	// 会把真俄文误修成汉字；真中文场景（P01/P04）本就靠 gbk 候选优先，无需此让位。
	// 真俄文场景（P05/P06）只有西里尔候选过门槛，不受影响。
	const nonCyr = passing.find(
		(c) => c.post === "kana" || c.post === "hkana" || c.post === "hangul"
	);
	if (best.post === "cyrillic" && nonCyr) best = nonCyr;
	// BOM 拼回：只修 BOM 之后的乱码部分，文件原有标记原样保留
	return {
		text: hasBom ? "\uFEFF" + best.text : best.text,
		chain: best.chain,
		score: Math.round(best.plaus * 100)
	};
}

/**
 * 修复一段文本中的二次编码乱码（逐行处理，失败行保持原样）。
 * @param text 当前文件全文（应为合法 UTF-8 解码结果）
 */
export function repairMojibake(text: string): RepairResult {
	const fffdCount = (text.match(/\uFFFD/g) || []).length;
	const lines = text.split("\n");
	let repairedLines = 0;
	let scannedLines = 0;
	const chainCount = new Map<string, number>();
	// 各"修复后真实脚本"被采纳的行数（文档级一致性门的判据，见下方注释）
	const outScriptCount = new Map<string, number>();
	// 逐行结果缓存：repairLine 对给定行内容是纯函数，而真实文档重复行极多
	//（标题、表格行、分隔线、键名），命中即省掉整条 3 误读 × 9 真值候选链扫描
	const lineCache = new Map<
		string,
		{ text: string; chain: string; score: number } | null
	>();

	const outLines = lines.map((line) => {
		// 只处理含非 ASCII 的行（乱码必然体现为非 ASCII 字符）
		if (!hasNonAscii(line)) return line;
		scannedLines++;
		let r = lineCache.get(line);
		if (r === undefined) {
			r = repairLine(line);
			lineCache.set(line, r);
		}
		if (!r) return line;
		// 行级一致性门：修复不得改变该行的文字系统身份。
		// 修前行有明确主导脚本（han/kana/hkana/hangul/cyrillic）时，修后必须
		// 仍是同一脚本——"正常行被巧合修成另一种脚本"（中文→韩文、日文→半角
		// 假名垃圾）在逐行层面就被拦下，不依赖文档级聚合（混排文档里任何
		// 单一脚本都到不了 45%，文档锚会失效，行级门是最后防线）。
		// 修前无脚本命中（整行都是 Latin 扩展区乱码，ÖÐÎÄ/ªÖ¸ 型）则不设限，
		// 保住"整行真乱码"的跨语言修复能力。
		const preScript = dominantScriptOf(line, SCRIPT_RATE);
		const postScript = dominantScriptOf(r.text, SCRIPT_RATE);
		if (preScript !== undefined && postScript !== preScript) {
			return line;
		}
		repairedLines++;
		chainCount.set(r.chain, (chainCount.get(r.chain) || 0) + 1);
		// 记录【修复后文本】的真实主导脚本，供文档级一致性门使用（见下方说明）。
		// postScript 已在行级门算过，这里直接复用，不重复扫描。
		if (postScript) {
			outScriptCount.set(postScript, (outScriptCount.get(postScript) || 0) + 1);
		}
		return r.text;
	});

	const outText = outLines.join("\n");
	// 无任何行被修复 → 未发现乱码
	if (repairedLines === 0) {
		return {
			found: false,
			text,
			repairedLines,
			scannedLines,
			score: Math.round(plausibility(text) * 100),
			fffdCount
		};
	}
	// 主导修复链（展示用）
	let chain: string | undefined;
	let maxN = 0;
	for (const [c, n] of chainCount) {
		if (n > maxN) {
			maxN = n;
			chain = c;
		}
	}

	// 文档级一致性门（原文锚定）：乱码修复的物理前提是"同一文档被同一条错误
	// 链路污染"。常用汉字回转成 GBK 字节后，这些字节在 EUC-KR/Shift-JIS 的
	// 双字节空间里大量重叠且合法——逐行独立判定时会被"巧合"修成另一种脚本
	// （典型：中文文档被修成韩文/日文，21791 条回转表对常用汉字 100% 命中是
	// 误修能发生的根因）。因此以【原文】（修前）的主导脚本为锚：
	// 原文非 ASCII 命中字符中，某脚本 ≥45% 即认定该文档"属于"这种语言，
	// 主导真值必须与之相容（如中文文档只能修成中文），否则视为误修，整篇
	// 判定未发现乱码、不改动。原文无 CJK/西里尔命中时退回旧行为（全放行）。
	const docScript = dominantScriptOf(text, SCRIPT_RATE);
	// 主导【修复后文本】的真实脚本：按被采纳行数取众数。
	let dominantPost: string | undefined;
	let maxP = 0;
	for (const [s, n] of outScriptCount) {
		if (n > maxP) {
			maxP = n;
			dominantPost = s;
		}
	}
	// 文档脚本（docScript，如 "han"）与主导修复产物的真实脚本必须相容：中文文档
	// 只能修成 han 类文本，不能修成 hangul/kana/cyrillic。文档无 CJK/西里尔主导时
	// （docScript undefined）放行。
	//
	// 第五轮修复：这里原先取 TRUTH_TO_SCRIPT[dominantTruth]——由"真值编码名"反查
	// 名义脚本，而不是解码产物的真实脚本。该映射在编码名与产物脚本不一致时会说谎：
	// cp1251 名义上是西里尔编码，但它同样能把 0x93/0x94 解成 U+201C/U+201D 智能引号
	// （纯拉丁产物），而候选池顺序里 cp1251 排在 cp1252 之前，于是主导真值被记成
	// "cp1251"、名义脚本记成 cyrillic，与中文锚（docScript="han"）判为不兼容而整篇
	// 拒绝——尽管那条行的修复结果 "“Hello”" 本身完全正确。改为直接统计修复后文本的
	// 真实脚本后：误拦消失（产物是拉丁 → 无脚本命中 → 放行），而"中文文档被整篇修成
	// 韩文垃圾"仍被拦（产物众数脚本 hangul ≠ han）；混入少量异文垃圾时判定也更严
	// （原先 nominal=han 放行、现在真实脚本 hangul 会拒）。
	const compatible =
		docScript === undefined ||
		dominantPost === undefined ||
		dominantPost === docScript;
	if (!compatible) {
		return {
			found: false,
			text,
			// 门拒后"无行被实际改动"，repairedLines 归零（调用方 Notice 展示不撒谎）
			repairedLines: 0,
			scannedLines,
			score: Math.round(plausibility(text) * 100),
			fffdCount
		};
	}

	return {
		found: true,
		text: outText,
		repairedLines,
		scannedLines,
		chain,
		score: Math.round(plausibility(outText) * 100),
		fffdCount
	};
}
