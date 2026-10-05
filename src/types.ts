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
	/** 记录状态：ok=成功；failed=失败（error 给原因）。缺省视为 ok（兼容旧日志） */
	status?: "ok" | "failed";
	/** 失败原因（仅 status="failed" 时存在） */
	error?: string;
}

/** 界面语言 */
export type UILocale =
	| "zh-CN"
	| "en"
	| "ja"
	| "ko"
	| "ru"
	| "fr"
	| "de"
	| "es"
	| "pt-BR"
	| "ar";

/** 插件设置 */
export interface CodeConverterSettings {
	/** 是否开启导入自动检测（新建/导入文件时静默转换为 UTF-8） */
	autoConvertOnImport: boolean;
	/** 转换的文件扩展名清单（分号/逗号/空格分隔），默认 {@link DEFAULT_TEXT_EXTENSIONS} */
	textExtensions: string;
	/** 置信度阈值（低于此值需人工确认），0-100 */
	confidenceThreshold: number;
	/** 转换前是否自动备份 */
	backupBeforeConvert: boolean;
	/** 备份目录（仓库相对路径），默认 {@link DEFAULT_BACKUP_DIR} */
	backupDir: string;
	/** 是否自动去除 UTF-8 BOM */
	stripBomOnConvert: boolean;
	/** 转换后是否写入 UTF-8 BOM（MSVC 等按 BOM 识别 UTF-8 的编译器需要） */
	writeBomOnConvert: boolean;
	/** 界面语言 */
	locale: UILocale;
	/** 日志文件路径（仓库相对路径，空字符串=禁用文件日志），默认 {@link DEFAULT_LOG_FILE} */
	logFile: string;
	/** 上游损坏警告阈值：合法 UTF-8 中 U+FFFD 占比（%）达到该值时警告，0=关闭 */
	damageWarnRatio: number;
}

/**
 * 插件自建的产物统一收敛到 `VaultRoot/.code-converter/` 下，仓库根保持干净。
 * 点开头路径不会被 Obsidian 索引为笔记、不出现在文件列表里。
 *
 * 这两个常量是唯一事实源：settings.ts 的 placeholder 与「留空回退」都必须引用它们，
 * 不要在任何地方再硬编码路径字符串——历史上漏改其中一份会让「界面提示的默认值」与
 * 「实际写入位置」不一致。
 */
export const DATA_DIR = ".code-converter";
export const DEFAULT_BACKUP_DIR = `${DATA_DIR}/backups`;
export const DEFAULT_LOG_FILE = `${DATA_DIR}/log.json`;

/**
 * 转换的文件扩展名清单。默认覆盖 Markdown + 常见源码 + 纯文本。
 * 控制「导入时自动转换」与「转换当前文件夹」的范围；手动「转换当前文件」
 * 不受它限制（用户主动指定的文件），但同样受 BINARY_EXTENSIONS 保护。
 *
 * 两条消费路径都是 VIP 增强功能，所以非 VIP 时该输入框置灰、只能吃默认值
 * （详见 vip/gate.ts 的 VIP_ONLY_SETTINGS）。
 *
 * 与上面的路径常量一样是唯一事实源：file-filter.ts 的默认清单、settings.ts 的
 * placeholder 与「留空回退」都必须引用它，不要另抄一份字符串。
 */
export const DEFAULT_TEXT_EXTENSIONS = "md;h;hpp;cpp;c;cc;py;txt";

export const DEFAULT_SETTINGS: CodeConverterSettings = {
	autoConvertOnImport: true,
	textExtensions: DEFAULT_TEXT_EXTENSIONS,
	confidenceThreshold: 80,
	backupBeforeConvert: true,
	backupDir: DEFAULT_BACKUP_DIR,
	stripBomOnConvert: true,
	writeBomOnConvert: false,
	locale: "zh-CN",
	logFile: DEFAULT_LOG_FILE,
	damageWarnRatio: 5
};
