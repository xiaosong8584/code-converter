/**
 * 编码探测与转换相关类型定义。
 */

/** 探测结果 */
export interface EncodingDetectResult {
	/** 是否检测到合法 UTF-8（含纯 ASCII） */
	isUtf8: boolean;
	/** 原始 BOM 类型 */
	bom: BomType;
	/** 建议编码（若非 UTF-8，给出最可能的候选） */
	encoding: string;
	/** 置信度 0-100 */
	confidence: number;
	/** 是否经过用户可确认的低置信度路径 */
	needsManualConfirm: boolean;
}

/** BOM 类型 */
export type BomType = "utf-8" | "utf-16le" | "utf-16be" | "utf-32le" | "utf-32be" | "none";

/** 单个文件的转换记录（用于日志与备份回溯） */
export interface ConversionRecord {
	file: string;
	fromEncoding: string;
	toEncoding: string;
	confidence: number;
	backupPath: string;
	timestamp: number;
}

/** 插件设置 */
export interface CodeConverterSettings {
	/** 是否开启导入自动检测（新建/导入文件时静默转换为 UTF-8） */
	autoConvertOnImport: boolean;
	/** 置信度阈值（低于此值需人工确认），0-100 */
	confidenceThreshold: number;
	/** 转换前是否自动备份 */
	backupBeforeConvert: boolean;
	/** 备份目录（仓库相对路径） */
	backupDir: string;
	/** 是否自动去除 UTF-8 BOM */
	stripBomOnConvert: boolean;
}

export const DEFAULT_SETTINGS: CodeConverterSettings = {
	autoConvertOnImport: false,
	confidenceThreshold: 80,
	backupBeforeConvert: true,
	backupDir: ".code-converter-backups",
	stripBomOnConvert: true
};
