/**
 * 转换编排：探测 → 备份 → 解码 → 去/写 BOM → 写回 UTF-8。
 * 这是插件的"安全核心"，所有转换都走这里，统一保证先备份再改。
 */

import { Notice, TFile, Vault } from "obsidian";
import { detectEncoding, decodeWithEncoding, analyzeReplacementDamage } from "./encoding";
import { backupFile, makeRecord, logConversion, notifyBackup, notifyConverted } from "./backup";
import { CodeConverterSettings, ConversionRecord } from "./types";
import { isBinaryFile } from "./file-filter";
import { t } from "./i18n";

export interface ConvertResult {
	converted: boolean;
	skipped: boolean;
	record?: ConversionRecord;
	message?: string;
	/** 合法 UTF-8 但 U+FFFD 超标时的损坏分析（仅 isUtf8 分支返回） */
	damage?: { count: number; total: number; ratio: number };
}

/** 判断损坏占比是否达到警告阈值（0 = 关闭） */
export function isDamageOverThreshold(
	settings: CodeConverterSettings,
	ratio: number
): boolean {
	return settings.damageWarnRatio > 0 && ratio * 100 >= settings.damageWarnRatio;
}

/** 把一个 TFile 转成 UTF-8 */
export async function convertFileToUtf8(
	vault: Vault,
	file: TFile,
	settings: CodeConverterSettings,
	force: boolean
): Promise<ConvertResult> {
	const relPath = file.path;
	const bytes: Uint8Array = new Uint8Array(await vault.readBinary(file));

	// 二进制拦截：扩展名命中黑名单或前 8KB 含 NUL 即拒绝。
	// 放在探测之前——把二进制当文本解码再写回是不可逆损坏，越早拦下越便宜。
	if (isBinaryFile(file.extension, bytes)) {
		return {
			converted: false,
			skipped: true,
			message: `${relPath}: ${t("notice.binarySkipped")}`
		};
	}

	const result = detectEncoding(bytes, settings.confidenceThreshold);

	// 已经是 UTF-8：无需转换；但若 U+FFFD 超标，附带损坏分析供上层告警
	if (result.isUtf8) {
		const damage = analyzeReplacementDamage(bytes);
		return {
			converted: false,
			skipped: true,
			damage,
			message: `${relPath}: ${t("notice.alreadyUtf8")}`
		};
	}

	// 非 UTF-8：低置信度且非强制 → 需要人工确认
	if (!force && result.needsManualConfirm) {
		return {
			converted: false,
			skipped: true,
			message: `${relPath}: ${t("notice.lowConfidence", {
				enc: result.encoding,
				n: result.confidence
			})}（阈值 ${settings.confidenceThreshold}%）`
		};
	}

	let backupPath = "";
	if (settings.backupBeforeConvert) {
		backupPath = await backupFile(vault, settings.backupDir, relPath);
		notifyBackup(backupPath);
	}

	// 解码到字符串
	let text = decodeWithEncoding(bytes, result.encoding);

	// 按配置去除 UTF-8 BOM
	if (settings.stripBomOnConvert) {
		if (text.charCodeAt(0) === 0xFEFF) {
			text = text.slice(1);
		}
	}

	// 按配置写入 UTF-8 BOM。先去再加，保证最终恰好一个 BOM，不会叠成两个。
	// 用途：MSVC 在源文件无 BOM 时按系统代码页读取，C++ 项目转成无 BOM UTF-8
	// 后中文会再次乱码；gcc/clang 会自动跳过 BOM，开启此选项对它们是安全的。
	if (settings.writeBomOnConvert && text.charCodeAt(0) !== 0xFEFF) {
		text = "\uFEFF" + text;
	}

	// 写回 UTF-8（Vault 没有 write 方法，正确 API 是 modify；adapter.write 默认即 UTF-8 文本）
	await vault.modify(file, text);

	const record = makeRecord(relPath, result.encoding, result.confidence, backupPath);
	logConversion(record, vault, settings);
	notifyConverted(relPath, result.encoding, result.confidence);

	return { converted: true, skipped: false, record };
}

/** 批量转换（如扫描整个文件夹），返回统计与全部记录 */
export async function convertFilesToUtf8(
	vault: Vault,
	files: TFile[],
	settings: CodeConverterSettings,
	force: boolean
): Promise<{
	total: number;
	converted: number;
	skipped: number;
	/** 跳过清单（路径 + 原因，如低置信度）——供控制台输出与排查 */
	skippedList: { path: string; reason: string }[];
	/** 失败清单（路径 + 错误原因） */
	failed: { path: string; error: string }[];
	records: ConversionRecord[];
	/** 疑似上游损坏（U+FFFD 超标）的文件清单 */
	damaged: { path: string; count: number; ratio: number }[];
}> {
	const failed: { path: string; error: string }[] = [];
	const skippedList: { path: string; reason: string }[] = [];
	const records: ConversionRecord[] = [];
	const damaged: { path: string; count: number; ratio: number }[] = [];
	let converted = 0;
	let skipped = 0;

	for (const f of files) {
		try {
			const r = await convertFileToUtf8(vault, f, settings, force);
			if (r.converted) {
				converted++;
				if (r.record) records.push(r.record);
			} else {
				skipped++;
				if (r.message) skippedList.push({ path: f.path, reason: r.message });
				if (
					r.damage &&
					isDamageOverThreshold(settings, r.damage.ratio)
				) {
					damaged.push({
						path: f.path,
						count: r.damage.count,
						ratio: r.damage.ratio
					});
				}
			}
		} catch (e) {
			failed.push({ path: f.path, error: (e as Error).message });
		}
	}

	return { total: files.length, converted, skipped, skippedList, failed, records, damaged };
}
