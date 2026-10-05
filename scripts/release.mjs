/**
 * scripts/release.mjs — 发布打包
 *
 * 产出 `dist/`，与 obsidian-sample-plugin 的标准 3 件套对齐（sample-plugin README
 * 明确写 "Upload the files manifest.json, main.js, styles.css as binary attachments"）：
 *   main.js        生产构建（压缩、无 sourcemap）
 *   manifest.json  插件清单（版本唯一事实源）
 *   styles.css     插件样式表（Obsidian 加载插件时自动 applyStylesheet）
 *
 * 注意：
 *   - versions.json **不打包**——它留在仓库根供 Obsidian 社区目录系统读取
 *     （旧版 Obsidian 用它判断能否下载此插件版本），不属于插件目录内容。
 *   - LICENSE **不打包**——仓库级协议文件，跟插件运行无关。
 *
 * 流程：版本一致性闸门 → 清空 dist/ → 生产构建 → 复制清单文件 → 校验 dist。
 * 任一步失败立即以非零码退出，绝不产出半成品 dist/。
 *
 * 用法：`npm run release`（建议先 `npm test` 通过再发版）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DIST = path.join(ROOT, "dist");

/** 需要从仓库根复制到 dist/ 的文件（对应 obsidian-sample-plugin 的 3 件套） */
const MANIFEST_FILES = ["manifest.json", "styles.css"];

/** dist/ 必须齐全的文件集合 */
const EXPECTED_FILES = ["main.js", ...MANIFEST_FILES];

/** dist/ 里绝不应当出现的名字（误打包的源码、密钥、依赖、测试） */
const FORBIDDEN = [
	".vip-secret",
	"package.json",
	"package-lock.json",
	"tsconfig.json",
	"node_modules",
	"test",
	"src",
	"scripts",
	".git",
	".obsidian"
];

/** 通用的密钥泄漏特征（PEM 头） */
const SECRET_MARKERS = ["PRIVATE KEY", "-----BEGIN"];

const report = { fail: [], warn: [], ok: [] };

function fail(msg) {
	report.fail.push(msg);
}
function warn(msg) {
	report.warn.push(msg);
}
function ok(msg) {
	report.ok.push(msg);
}

function readJson(rel) {
	const abs = path.join(ROOT, rel);
	if (!fs.existsSync(abs)) {
		throw new Error(`缺少文件：${rel}`);
	}
	return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function readText(rel) {
	return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * 版本一致性闸门。
 *
 * 这是本脚本最高价值的一步：Obsidian 社区目录校验要求 tag 与 manifest version
 * 精确一致（见 .github/workflows/ci.yml 注释），而历史上最容易漏的就是「改了
 * manifest.json 却忘了给 versions.json 加一行」——那样插件装不上去。
 *
 * @returns {string} manifest 里的版本号（供后续摘要使用）
 */
function verifyVersionConsistency() {
	const pkg = readJson("package.json");
	const manifest = readJson("manifest.json");
	const versions = readJson("versions.json");
	const readme = readText("README.md");
	const readmeZh = fs.existsSync(path.join(ROOT, "README.zh-CN.md"))
		? readText("README.zh-CN.md")
		: "";

	const version = manifest.version;
	const points = [
		["manifest.json", manifest.version],
		["package.json", pkg.version]
	];

	// 硬失败：版本不一致会让 CI 的 tag 校验直接挂掉
	for (const [file, value] of points) {
		if (value !== version) {
			fail(`${file} 的 version 是 ${value}，与 manifest.json 的 ${version} 不一致`);
		}
	}

	// 硬失败：versions.json 缺该版本 → 社区目录装不上
	const minApp = versions[version];
	if (minApp === undefined) {
		fail(`versions.json 缺少 "${version}" 条目（必须是 "${version}": "<minAppVersion>"）`);
	} else if (minApp !== manifest.minAppVersion) {
		fail(
			`versions.json["${version}"] = ${minApp}，与 manifest.json.minAppVersion ` +
				`= ${manifest.minAppVersion} 不一致`
		);
	}

	// 提示级：README 徽章是装饰，但发版忘改会误导用户
	for (const [file, text] of [["README.md", readme], ["README.zh-CN.md", readmeZh]]) {
		if (text && !text.includes(`version-${version}-`)) {
			warn(`${file} 的版本徽章未更新到 ${version}`);
		}
	}

	// 提示级：manifest id 与 npm 包名按约定应一致
	if (manifest.id !== pkg.name) {
		warn(`manifest.json.id (${manifest.id}) 与 package.json.name (${pkg.name}) 不同`);
	}

	if (report.fail.length === 0) {
		ok(`版本一致：${version}（最低 Obsidian ${manifest.minAppVersion}）`);
	}
	return version;
}

/**
 * 清空 dist/。必须清空而不是追加——残留的陈旧产物（比如上次的 LICENSE 或
 * 一次失败构建留下的半截 main.js）会混进本次发布包。
 */
function cleanDist() {
	fs.rmSync(DIST, { recursive: true, force: true });
	fs.mkdirSync(DIST, { recursive: true });
	ok("已清空 dist/");
}

function copyManifestFiles() {
	for (const name of MANIFEST_FILES) {
		const src = path.join(ROOT, name);
		if (!fs.existsSync(src)) {
			fail(`仓库根缺少 ${name}，无法打包`);
			continue;
		}
		fs.copyFileSync(src, path.join(DIST, name));
	}
}

/**
 * 校验产物不含密钥。
 *
 * 做法是拿本地 .vip-secret 的**真实内容**与产物比对，只在发现匹配时报警、
 * 绝不回显密钥片段。比起匹配 ".vip-secret" 这类文件名（源码注释里提到它就会被
 * 误判），比对原文才是判据。
 */
function verifyNoSecretLeak(mainPath) {
	const code = fs.readFileSync(mainPath, "utf8");
	const secretPath = path.join(ROOT, ".vip-secret");
	if (fs.existsSync(secretPath)) {
		const secret = fs.readFileSync(secretPath, "utf8").trim();
		if (secret && code.includes(secret)) {
			fail("dist/main.js 包含 .vip-secret 的原文——私钥泄漏，停止发布");
			return;
		}
	} else {
		warn("仓库根未找到 .vip-secret，跳过密钥原文比对（仅做 PEM 特征检查）");
	}
	for (const marker of SECRET_MARKERS) {
		if (code.includes(marker)) {
			fail(`dist/main.js 含疑似密钥标记 "${marker}"——停止发布`);
		}
	}
}

/**
 * 校验最终 dist/ 的完整性与安全。全部为硬失败——发布包错了比没发更糟。
 */
function verifyDist() {
	const mainPath = path.join(DIST, "main.js");

	// 1. 必需文件齐全且非空
	for (const name of EXPECTED_FILES) {
		// main.js 由 build() 生成，其余由 copyManifestFiles 复制，两者都可能缺席
		if (!fs.existsSync(path.join(DIST, name))) {
			fail(`dist/ 缺少 ${name}`);
			continue;
		}
		if (fs.statSync(path.join(DIST, name)).size === 0) {
			fail(`dist/${name} 是空文件`);
		}
	}

	// 2. 包体积与外部化：异常偏小或被打包进 obsidian 都说明打包出错
	if (fs.existsSync(mainPath)) {
		const size = fs.statSync(mainPath).size;
		const code = fs.readFileSync(mainPath, "utf8");
		if (size < 100_000) {
			fail(`dist/main.js 只有 ${size} 字节，异常偏小，打包很可能出错`);
		} else {
			ok(`dist/main.js ${size.toLocaleString()} 字节`);
		}
		if (!/require\(\s*["']obsidian["']\s*\)/.test(code)) {
			fail('dist/main.js 里找不到 require("obsidian")——外部化失效');
		} else {
			ok("obsidian / electron / node 内置模块保持外部化");
		}
		verifyNoSecretLeak(mainPath);
	}

	// 3. 发布模式不应有 sourcemap
	for (const entry of fs.readdirSync(DIST)) {
		if (entry.endsWith(".map")) {
			fail(`dist/ 里有 sourcemap：${entry}（发布模式应关闭 sourcemap）`);
		}
	}

	// 4. 不得混入源码/密钥/依赖/测试
	const actual = new Set(fs.readdirSync(DIST));
	for (const name of FORBIDDEN) {
		if (actual.has(name)) {
			fail(`dist/ 里出现了不应发布的文件：${name}`);
		}
	}
	const extra = [...actual].filter((n) => !EXPECTED_FILES.includes(n));
	for (const name of extra) {
		warn(`dist/ 里有未预期的文件：${name}（预期只有 ${EXPECTED_FILES.join("、")}）`);
	}

	if (report.fail.length === 0) {
		ok(`dist/ 内容正确：${EXPECTED_FILES.join("、")}`);
	}
}

function printReport(version) {
	const fmt = {
		ok: (m) => `  ✓ ${m}`,
		warn: (m) => `  ⚠ ${m}`,
		fail: (m) => `  ✗ ${m}`
	};
	console.log(`\n发布摘要 v${version}`);
	console.log("─".repeat(60));
	for (const key of ["ok", "warn", "fail"]) {
		for (const msg of report[key]) console.log(fmt[key](msg));
	}
	console.log("─".repeat(60));
	if (report.fail.length > 0) {
		// 按实际状态自述，不能写死文案——闸门失败时 dist/ 已移除，
		// 构建阶段失败时 dist/ 仍保留，说反了会误导排查方向
		const kept = fs.existsSync(DIST);
		console.log(
			`\n发布失败：${report.fail.length} 个问题未通过——` +
				(kept ? "dist/ 已保留供排查。" : "未产出 dist/。")
		);
		process.exitCode = 1;
	} else {
		console.log(`\n发布成功 ✓  dist/ 就绪（${report.warn.length} 条提示，不影响发布）`);
	}
}

async function main() {
	console.log("发布流程：版本闸门 → 构建 → 打包 → 校验");
	console.log("─".repeat(60));
	const version = verifyVersionConsistency();
	if (report.fail.length > 0) {
		// 闸门不通过：不构建，并移除可能存在的旧 dist/——否则上一版的有效产物
		// 会留在原地，用户可能误把它当成「当前版本已发布」直接分发出去。
		// 这条是纠偏动作、不是「通过」，故不走 ok 列表，避免在失败报告里被误读。
		fs.rmSync(DIST, { recursive: true, force: true });
		console.log("（已移除 dist/，避免上一版产物被当成当前版本分发）");
		printReport(version);
		return;
	}
	cleanDist();
	await build(true);
	copyManifestFiles();
	verifyDist();
	printReport(version);
}

main().catch((err) => {
	console.error("\n发布过程中发生异常：");
	console.error(err && err.stack ? err.stack : String(err));
	process.exitCode = 1;
});
