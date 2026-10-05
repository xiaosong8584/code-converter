/**
 * 文件类型过滤：扩展名白名单 + 二进制黑名单。
 * 纯逻辑层，不依赖 obsidian，可直接进单元测试。
 *
 * 两道防护解决同一个事故场景：把二进制（图片 / PDF / 压缩包 / 编译产物）当成
 * 文本解码后写回磁盘，是不可逆的损坏——备份能救，但没必要给这个机会。
 */

import { DEFAULT_TEXT_EXTENSIONS } from "./types";

/**
 * 已知二进制 / 压缩格式的扩展名。列表里的文件绝不按文本解码再写回。
 * 刻意不含 svg（XML 文本）、csv、json、yaml、ipynb、log。
 * 注意：ts 故意不进列表——它既是 TypeScript 源码又是视频流格式，
 * 只能靠内容嗅探（NUL 字节）区分，不能靠扩展名一刀切。
 */
export const BINARY_EXTENSIONS: readonly string[] = [
	// 图片
	"png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "avif", "heic", "heif",
	// 文档 / 电子书
	"doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "pdf", "epub", "mobi",
	// 压缩包 / 磁盘镜像
	"zip", "7z", "rar", "gz", "tgz", "tar", "bz2", "xz", "iso", "img",
	// 字体
	"woff", "woff2", "ttf", "otf", "eot", "svgz",
	// 音视频
	"mp3", "wav", "ogg", "flac", "m4a", "aac", "mp4", "mkv", "avi", "mov", "webm",
	// 可执行 / 编译产物
	"exe", "dll", "so", "dylib", "a", "o", "obj", "bin", "class", "jar", "war",
	"pyc", "pyo", "wasm", "lib", "pdb",
	// 数据库
	"db", "sqlite", "sqlite3", "mdb", "accdb"
];

const BINARY_SET: ReadonlySet<string> = new Set(BINARY_EXTENSIONS);

/** 嗅探字节数上限：前 8KB 足以识别绝大多数二进制的魔数与 NUL 分布 */
const NUL_SCAN_BYTES = 8192;

/**
 * 默认清单：从 {@link DEFAULT_TEXT_EXTENSIONS} 解析而来，供「留空回退」复用。
 * 不能写死成 `["md"]`——默认值本身已经是多扩展名清单了。
 */
const DEFAULT_LIST: string[] = DEFAULT_TEXT_EXTENSIONS.toLowerCase()
	.split(/[;,\s]+/)
	.filter((e) => e.length > 0);

/**
 * 解析扩展名清单：分号 / 逗号 / 空白均可分隔，大小写不敏感，去前导点、去重、去空项。
 * 空串或纯空白 → 回退到 {@link DEFAULT_TEXT_EXTENSIONS} 解析出的完整清单，
 * 绝不返回空数组——空清单会让自动转换静默失效，比默认值更糟，且用户完全无感知。
 */
export function parseExtensions(raw: string | null | undefined): string[] {
	if (!raw || !raw.trim()) return DEFAULT_LIST.slice();
	const out: string[] = [];
	for (const part of raw.split(/[;,\s]+/)) {
		const e = part.trim().toLowerCase().replace(/^\./, "");
		if (e && !out.includes(e)) out.push(e);
	}
	return out.length ? out : DEFAULT_LIST.slice();
}

/** 扩展名是否在白名单内（大小写不敏感） */
export function isTextExtension(
	ext: string | null | undefined,
	extensions: readonly string[]
): boolean {
	if (!ext) return false;
	return extensions.includes(ext.toLowerCase());
}

/** 前 N 字节内是否出现 NUL——二进制的指纹，纯文本几乎不可能出现 */
export function hasNulByte(bytes: Uint8Array): boolean {
	const n = Math.min(NUL_SCAN_BYTES, bytes.length);
	for (let i = 0; i < n; i++) {
		if (bytes[i] === 0) return true;
	}
	return false;
}

/**
 * 判定是否为二进制文件：扩展名命中黑名单，或前 8KB 含 NUL。
 * 两个条件互补——黑名单挡住已知格式，NUL 嗅探挡住没写进清单的未知二进制。
 */
export function isBinaryFile(ext: string | null | undefined, bytes: Uint8Array): boolean {
	if (ext && BINARY_SET.has(ext.toLowerCase())) return true;
	return hasNulByte(bytes);
}
