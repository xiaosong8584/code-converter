/**
 * 编码探测与转换核心。
 *
 * 设计原则（安全优先）：
 * 1. 先做严格 UTF-8 校验（合法 UTF-8 直接放行，不触碰，零风险）。
 * 2. 识别 BOM，BOM 是强信号，优先信任。
 * 3. 非 UTF-8 且无 BOM 时，按候选编码（GBK/Big5/Shift-JIS 等）做"解码质量评分"，
 *    取置信度最高者；低于阈值则标记 needsManualConfirm，绝不静默强转。
 */

import { EncodingDetectResult, BomType } from "./types";

/** 候选非 UTF-8 编码（按常见度排序，覆盖 10 大语种 / 17 种编码） */
const CANDIDATE_ENCODINGS = [
	// CJK
	"gbk",        // 简体中文 GBK
	"gb18030",    // 简体中文 GB18030（GBK 超集）
	"big5",       // 繁体中文 Big5
	"cp950",      // 繁体中文 Big5/CP950
	"shift-jis",  // 日文 Shift-JIS
	"euc-jp",     // 日文 EUC-JP
	"cp932",      // 日文 Windows CP932
	"euc-kr",     // 韩文 EUC-KR
	"cp949",      // 韩文 Windows CP949
	// 西里尔
	"iso-8859-5", // 西里尔 ISO-8859-5
	"cp1251",     // 西里尔 Windows CP1251
	"koi8-r",     // 俄 KOI8-R
	"cp866",      // 俄 CP866
	// 拉丁
	"cp1252",     // 西欧 Windows CP1252（最常见）
	"cp1250",     // 中欧 CP1250
	"cp1254",     // 土耳其 CP1254
	"cp1257",     // 波罗的海 CP1257
	"cp1258",     // 越南 CP1258
	// 希腊/希伯来/阿拉伯
	"cp1253",     // 希腊
	"cp1255",     // 希伯来
	"cp1256",     // 阿拉伯
	"iso-8859-1"  // 拉丁 1（西欧 256，兜底）
] as const;

/** 从字节头部识别 BOM */
export function detectBom(bytes: Uint8Array): BomType {
	if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
		return "utf-8";
	}
	if (bytes.length >= 2) {
		if (bytes[0] === 0xFF && bytes[1] === 0xFE) return "utf-16le";
		if (bytes[0] === 0xFE && bytes[1] === 0xFF) return "utf-16be";
	}
	if (bytes.length >= 4) {
		if (
			bytes[0] === 0x00 &&
			bytes[1] === 0x00 &&
			bytes[2] === 0xFE &&
			bytes[3] === 0xFF
		)
			return "utf-32le";
		if (
			bytes[0] === 0xFE &&
			bytes[1] === 0xFF &&
			bytes[2] === 0x00 &&
			bytes[3] === 0x00
		)
			return "utf-32be";
	}
	return "none";
}

/**
 * 严格校验字节序列是否为合法 UTF-8。
 * 使用 TextDecoder + fatal，100% 可靠。
 */
export function isStrictUtf8(bytes: Uint8Array): boolean {
	try {
		new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

/** 去掉 UTF-8 BOM（若存在） */
export function stripUtf8Bom(bytes: Uint8Array): Uint8Array {
	if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
		return bytes.slice(3);
	}
	return bytes;
}

/**
 * 检查运行时 TextDecoder 是否支持该编码标签。
 * 不支持的标签构造即抛 RangeError——必须显式拦截，
 * 绝不能让解码落入静默兜底（会产出"满分乱码"）。
 */
export function isSupportedEncoding(encoding: string): boolean {
	try {
		new TextDecoder(encoding);
		return true;
	} catch {
		return false;
	}
}

/** 把字节按指定编码解码为字符串（带 BOM 时先剥离） */
export function decodeWithEncoding(bytes: Uint8Array, encoding: string): string {
	const encName = encoding.toLowerCase();
	// TextDecoder（Encoding Standard）不支持 UTF-32；显式拒绝
	if (encName === "utf-32" || encName === "utf-32le" || encName === "utf-32be") {
		throw new Error(`TextDecoder does not support ${encName}; conversion refused`);
	}
	// 标签不受支持 → 直接抛错，让上层按"转换失败"记录。
	// v1.4.4 之前这里会静默退化成逐字节 Latin-1 兜底，产出乱码并写回文件（数据毁灭级缺陷）。
	if (!isSupportedEncoding(encName)) {
		throw new Error(`unsupported encoding label: ${encoding}`);
	}
	let src = bytes;
	const bom = detectBom(bytes);
	if (bom === "utf-8") src = bytes.slice(3);

	try {
		if (bom === "utf-16le") return new TextDecoder("utf-16le").decode(bytes);
		if (bom === "utf-16be") {
			// 手工字节交换
			const swapped = new Uint8Array(bytes.length);
			for (let i = 0; i + 1 < bytes.length; i += 2) {
				swapped[i] = bytes[i + 1];
				swapped[i + 1] = bytes[i];
			}
			return new TextDecoder("utf-16le").decode(swapped);
		}
	} catch {
		/* fall through to generic */
	}

	return new TextDecoder(encName, { fatal: false }).decode(src);
}

/**
 * 解码质量评分：解码结果中"可打印/有意义字符"占比越高，越可能选对了编码。
 * 覆盖 Unicode 主要区段：拉丁、希腊、西里尔、希伯来、阿拉伯、泰文、CJK。
 * 乱码会大量出现 \uFFFD（替换字符）或不可见控制符。
 * （导出供乱码修复工具复用）
 */
export function scoringRatio(text: string): number {
	if (!text.length) return 0;
	let good = 0;
	let total = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0)!;
		// 跳过 BOM / 全角空格
		if (code === 0xFEFF) continue;
		total++;
		// 可打印字符或常见空白（含 10 大语种独立区段）
		const isPrintable =
			code === 9 || code === 10 || code === 13 ||
			(code >= 0x20 && code <= 0x7e) || // ASCII 可打印
			(code >= 0xa0 && code <= 0x2ff) || // 拉丁补充 / 希腊 / 西里尔 / 组合符
			(code >= 0x370 && code <= 0x3ff) || // 希腊
			(code >= 0x400 && code <= 0x4ff) || // 西里尔（俄文乱码修复链的输出区，缺失会把
			                                    // cp1251/koi8-r 真链的可打印分压到 0.1 全灭）
			(code >= 0x530 && code <= 0x58f) || // 希伯来
			(code >= 0x590 && code <= 0x5ff) || // 阿拉伯
			(code >= 0x900 && code <= 0x97f) || // 天城文（南亚兜底）
			(code >= 0x1100 && code <= 0x11ff) || // 谚文
		(code >= 0x1e00 && code <= 0x1eff) || // 拉丁扩展
		(code >= 0x2000 && code <= 0x206f) || // 常规标点（— … " " 等，中文文档常见）
		(code >= 0x20a0 && code <= 0x20cf) || // 货币符号（€ 等）
		(code >= 0x2100 && code <= 0x27bf) || // 字母符号/箭头/数学/带圈数字/罗马数字/
		                                      // 制表符(┌─┐)/几何图形/杂项符号——技术文档
		                                      // ASCII 画图与特殊符号的主力区，GBK 全覆盖
		(code >= 0x3000 && code <= 0x303f) || // CJK 标点（。、「」等）
		(code >= 0x3040 && code <= 0x312f) || // 日文假名 + 注音符号（Big5 常见）
		(code >= 0x4e00 && code <= 0x9fff) || // CJK 汉字
		(code >= 0xac00 && code <= 0xd7a3) || // 韩文音节
		(code >= 0xfe30 && code <= 0xfe4f) || // CJK 竖排形式
		(code >= 0xff00 && code <= 0xffef) || // 全角
		(code >= 0x10000 && code <= 0x10ffff); // 扩展区
		if (isPrintable) good++;
	}
	return total === 0 ? 0 : good / total;
}

/** 候选编码中找一个浏览器能解码的（避免个别运行时缺 codec） */
function pickCandidate(bytes: Uint8Array, enc: string): boolean {
	try {
		decodeWithEncoding(bytes, enc);
		return true;
	} catch {
		return false;
	}
}

/**
 * 对非 UTF-8 字节序列做候选编码探测。
 * @returns 最佳候选编码 + 置信度（0-100）
 */
export function detectNonUtf8Encoding(
	bytes: Uint8Array
): { encoding: string; confidence: number } {
	// 若含 BOM（UTF-16/32），直接信任
	const bom = detectBom(bytes);
	if (bom !== "none") {
		return { encoding: bom === "utf-16le" ? "utf-16le" : bom === "utf-16be" ? "utf-16be" : bom, confidence: 100 };
	}

	let bestEnc = "iso-8859-1";
	let bestScore = -1;
	let bestConf = 0;

	for (const enc of CANDIDATE_ENCODINGS) {
		if (!isSupportedEncoding(enc)) continue;
		if (!pickCandidate(bytes, enc)) continue;
		const text = decodeWithEncoding(bytes, enc);
		const score = scoringRatio(text);
		// 要求"有效优势"才替换：iso-8859-1 等单字节编码能把任意字节解成
		// 满分可打印 Latin 字符（无 U+FFFD），会以 0.002 级别的微弱分差
		// 反超正确的多字节编码（如 GBK 含极少量非法字节时 0.998 vs 1.0）。
		// 候选表已按常见度把 CJK 排前，同分/近分时保留先者即可。
		if (score > bestScore + 0.005) {
			bestScore = score;
			bestEnc = enc;
			// 经验映射：解码可打印比例越高，置信度越高
			bestConf = Math.round(score * 100);
		}
	}

	// 全为 ASCII 可打印（= 其实是 UTF-8 子集）不会走到这里
	return { encoding: bestEnc, confidence: bestConf };
}

/**
 * 分析"合法 UTF-8 但内容已损坏"的文件：
 * 统计 U+FFFD（替换字符 �）的数量与占比。
 *
 * 背景：U+FFFD 是"原始字节已丢失"的占位符——若某工具曾用错误编码读取文件
 * 并以替换字符回存 UTF-8，原始字节即不可逆丢失。这种文件编码转换无法修复，
 * 但应明确告知用户"为什么插件不转"。
 */
export function analyzeReplacementDamage(bytes: Uint8Array): {
	count: number;
	total: number;
	ratio: number;
} {
	const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
	let count = 0;
	let total = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0)!;
		if (code === 0xFEFF) continue; // 跳过 BOM
		total++;
		if (code === 0xfffd) count++;
	}
	return { count, total, ratio: total === 0 ? 0 : count / total };
}

/**
 * 完整探测流程：对一份文件的原始字节做编码判断。
 */
export function detectEncoding(
	bytes: Uint8Array,
	threshold: number
): EncodingDetectResult {
	const bom = detectBom(bytes);

	// 1) BOM 强信号
	if (bom !== "none") {
		if (bom === "utf-8") {
			// BOM 只是"作者声称这是 UTF-8"，不能替代对正文的校验：
			// 有些工具会写出 UTF-8 BOM 却跟着非法 UTF-8 正文（手工拼接字节、
			// 半截转换产物）。若直接信 BOM，会把这类文件谎报成 "UTF-8 100%"，
			// 用户永远看不到"它其实是别的编码"。BOM 本身是合法的 UTF-8
			// U+FEFF，故对整个字节串做严格校验即可同时覆盖正文；矛盾时不信任
			// BOM，剥离 BOM 后让正文自己走候选探测（与下方无 BOM 分支口径一致）。
			if (isStrictUtf8(bytes)) {
				return { isUtf8: true, bom, encoding: "utf-8", confidence: 100, needsManualConfirm: false };
			}
			const { encoding, confidence } = detectNonUtf8Encoding(stripUtf8Bom(bytes));
			return {
				isUtf8: false,
				bom,
				encoding,
				confidence,
				needsManualConfirm: confidence < threshold
			};
		}
		// UTF-16/32 一律视为非 UTF-8，需转
		const target = bom === "utf-16le" ? "utf-16le" : bom === "utf-16be" ? "utf-16be" : bom;
		return {
			isUtf8: false,
			bom,
			encoding: target,
			confidence: 100,
			needsManualConfirm: false
		};
	}

	// 2) 无 BOM：严格 UTF-8 校验
	if (isStrictUtf8(bytes)) {
		return { isUtf8: true, bom, encoding: "utf-8", confidence: 100, needsManualConfirm: false };
	}

	// 3) 非 UTF-8：候选编码探测
	const { encoding, confidence } = detectNonUtf8Encoding(bytes);
	return {
		isUtf8: false,
		bom,
		encoding,
		confidence,
		needsManualConfirm: confidence < threshold
	};
}
