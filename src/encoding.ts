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

/** 候选非 UTF-8 编码（按常见度排序） */
const CANDIDATE_ENCODINGS = [
	"gbk",
	"big5",
	"shift-jis",
	"euc-jp",
	"cp932",
	"iso-8859-1"
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

/** 把字节按指定编码解码为字符串（带 BOM 时先剥离） */
export function decodeWithEncoding(bytes: Uint8Array, encoding: string): string {
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

	try {
		const out = new TextDecoder(encoding.toLowerCase(), { fatal: false }).decode(src);
		return out;
	} catch {
		// 浏览器 TextDecoder 未必支持所有编码（如 gbk），退化用 Latin-1 占位
		let s = "";
		for (let i = 0; i < src.length; i++) s += String.fromCharCode(src[i]);
		return s;
	}
}

/**
 * 解码质量评分：解码结果中"可打印/有意义字符"占比越高，越可能选对了编码。
 * 乱码会大量出现 \uFFFD（替换字符）或不可见控制符。
 */
function scoringRatio(text: string): number {
	if (!text.length) return 0;
	let good = 0;
	let total = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0)!;
		// 跳过 BOM / 全角空格
		if (code === 0xFEFF) continue;
		total++;
		// 可打印字符或常见空白
		const isPrintable =
			code === 9 || code === 10 || code === 13 ||
			(code >= 0x20 && code <= 0x7e) || // ASCII 可打印
			(code >= 0x0e00 && code <= 0x9fff) || // CJK 区段
			(code >= 0xac00 && code <= 0xd7a3) || // 韩文
			(code >= 0x3040 && code <= 0x30ff) || // 日文假名
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
		if (!pickCandidate(bytes, enc)) continue;
		const text = decodeWithEncoding(bytes, enc);
		const score = scoringRatio(text);
		if (score > bestScore) {
			bestScore = score;
			bestEnc = enc;
			// 经验映射：解码可打印比例越高，置信度越高
			bestConf = Math.round(score * 100);
		}
	}

	// 全为 ASCII 可打印（= 其实是 UTF-8 子集）不会走到这里；若评分低则压低置信度
	if (bestConf < 60) bestConf = Math.min(bestConf, 60);
	return { encoding: bestEnc, confidence: bestConf };
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
			return { isUtf8: true, bom, encoding: "utf-8", confidence: 100, needsManualConfirm: false };
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
