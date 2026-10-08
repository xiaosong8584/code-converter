/**
 * 备份模块：转换前把原文件字节存入备份目录，出问题可回滚。
 * 使用 adapter.readBinary / writeBinary，路径基于仓库根。
 */

import { TFile, Vault, Notice } from "obsidian";
import { ConversionRecord, CodeConverterSettings } from "./types";
import { t } from "./i18n";
import { appendToFile } from "./log";

const PLUGIN_NAME = "Code Converter";

/** 把仓库内相对路径安全化为文件名 */
function safeName(relPath: string): string {
	return relPath.replace(/[\\/]+/g, "__").replace(/^__/, "");
}

/** 备份原文件到 backupDir（同名加时间戳避免覆盖） */
export async function backupFile(
	vault: Vault,
	backupDir: string,
	relPath: string
): Promise<string> {
	const file = vault.getAbstractFileByPath(relPath);
	if (!file) throw new Error(`file not found: ${relPath}`);

	const bytes = await vault.readBinary(file as unknown as TFile);
	const time = new Date().toISOString().replace(/[:.]/g, "-");
	const target = `${backupDir}/${safeName(relPath)}.${time}.bak`;

	// 确保备份目录存在（Obsidian 写入会自动建父目录，但保险起见）
	await ensureDir(vault, backupDir);
	// writeBinary 要 ArrayBuffer（d.ts: adapter.write 只收 string，Uint8Array 属类型契约外）
	await vault.adapter.writeBinary(target, new Uint8Array(bytes).buffer);
	return target;
}

/**
 * 递归确保目录存在。
 * 点开头目录（如 .code-converter/backups）不在 vault 索引里，getAbstractFileByPath
 * 对它永远返回 null → 必须用 adapter.exists（磁盘层）判断；createFolder 撞上
 * "Folder already exists."（索引滞后）时静默忽略。
 */
async function ensureDir(vault: Vault, path: string): Promise<void> {
	const parts = path.split("/").filter(Boolean);
	let cur = "";
	for (const p of parts) {
		cur = cur ? `${cur}/${p}` : p;
		if (!(await vault.adapter.exists(cur))) {
			try {
				await vault.createFolder(cur);
			} catch {
				/* 目录已存在（索引滞后）→ 继续用 */
			}
		}
	}
}

/** 记录一次转换（console + 追加到日志文件，便于审计） */
export function logConversion(
	record: ConversionRecord,
	vault?: Vault,
	settings?: CodeConverterSettings
): void {
	// 只写日志文件，不输出到控制台（避免污染日志）
	if (vault && settings && settings.logFile) {
		// 异步追加，失败不影响主流程
		appendToFile(vault, settings.logFile, record).catch(() => {});
	}
}

/** 生成转换记录 */
export function makeRecord(
	relPath: string,
	from: string,
	confidence: number,
	backupPath: string
): ConversionRecord {
	return {
		file: relPath,
		fromEncoding: from,
		toEncoding: "utf-8",
		confidence,
		backupPath,
		timestamp: Date.now()
	};
}

/** 生成失败记录（status=failed，错误原因进 error 字段，供日志排查） */
export function makeFailureRecord(
	relPath: string,
	error: string
): ConversionRecord {
	return {
		file: relPath,
		fromEncoding: "unknown",
		toEncoding: "utf-8",
		confidence: 0,
		backupPath: "",
		timestamp: Date.now(),
		status: "failed",
		error
	};
}

/** 提示备份已生成 */
export function notifyBackup(backupPath: string): void {
	new Notice(`[${PLUGIN_NAME}] ${t("notice.backupCreated", { p: backupPath })}`);
}

/** 转换完成后提示 */
export function notifyConverted(file: string, from: string, confidence: number): void {
	new Notice(`[${PLUGIN_NAME}] ${file}: ${t("notice.converted", { n: confidence })}`);
}

export { safeName };
