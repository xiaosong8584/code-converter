/**
 * 转换编排：探测 → 备份 → 解码 → 去 BOM → 写回 UTF-8。
 * 这是插件的"安全核心"，所有转换都走这里，统一保证先备份再改。
 */

import { Notice, TFile, Vault } from "obsidian";
import { detectEncoding, decodeWithEncoding, stripUtf8Bom } from "./encoding";
import { backupFile, makeRecord, logConversion, notifyBackup, notifyConverted } from "./backup";
import { CodeConverterSettings, ConversionRecord } from "./types";

export interface ConvertResult {
	converted: boolean;
	skipped: boolean;
	record?: ConversionRecord;
	message?: string;
}

/** 把一个 TFile 转成 UTF-8 */
export async function convertFileToUtf8(
	vault: Vault,
	file: TFile,
	settings: CodeConverterSettings,
	force: boolean
): Promise<ConvertResult> {
	const relPath = file.path;
	const bytes: Uint8Array = await vault.readBinary(file);
	const result = detectEncoding(bytes, settings.confidenceThreshold);

	// 已经是 UTF-8：无需转换
	if (result.isUtf8) {
		return {
			converted: false,
			skipped: true,
			message: `${relPath}: 已是 UTF-8，无需转换。`
		};
	}

	// 非 UTF-8：低置信度且非强制 → 需要人工确认
	if (!force && result.needsManualConfirm) {
		return {
			converted: false,
			skipped: true,
			message: `${relPath}: 检测到 ${result.encoding}（置信度 ${result.confidence}%），低于阈值 ${settings.confidenceThreshold}%，请人工确认后强制转换。`
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

	// 写回 UTF-8（adapter.write 默认即 UTF-8 文本）
	await vault.write(file, text);

	const record = makeRecord(relPath, result.encoding, result.confidence, backupPath);
	logConversion(record);
	notifyConverted(relPath, result.encoding, result.confidence);

	return { converted: true, skipped: false, record };
}

/** 批量转换（如扫描整个文件夹），返回统计 */
export async function convertFilesToUtf8(
	vault: Vault,
	files: TFile[],
	settings: CodeConverterSettings,
	force: boolean
): Promise<{ total: number; converted: number; skipped: number; failed: string[] }> {
	const failed: string[] = [];
	let converted = 0;
	let skipped = 0;

	for (const f of files) {
		try {
			const r = await convertFileToUtf8(vault, f, settings, force);
			if (r.converted) converted++;
			else skipped++;
		} catch (e) {
			failed.push(`${f.path}: ${(e as Error).message}`);
		}
	}

	return { total: files.length, converted, skipped, failed };
}
