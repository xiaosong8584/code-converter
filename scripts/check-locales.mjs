// 校验 10 个语言文件的 key 与 locales/types.ts 的 LocaleDict 完全一致
import fs from "node:fs";

// 从 types.ts 提取 LocaleDict 的 key
const types = fs.readFileSync("src/locales/types.ts", "utf8");
const expected = new Set();
for (const m of types.matchAll(/"([a-zA-Z0-9]+\.[a-zA-Z0-9.]+)":\s*string/g)) {
	expected.add(m[1]);
}

const locales = ["zh-CN", "en", "ja", "ko", "ru", "fr", "de", "es", "pt-BR", "ar"];
let fail = 0;
for (const code of locales) {
	const src = fs.readFileSync(`src/locales/${code}.ts`, "utf8");
	const got = new Set();
	for (const m of src.matchAll(/^\t"([^"]+)":/gm)) {
		got.add(m[1]);
	}
	const missing = [...expected].filter((k) => !got.has(k));
	const extra = [...got].filter((k) => !expected.has(k));
	if (missing.length || extra.length) {
		fail++;
		console.log(`✗ ${code}: 缺 ${missing.length} [${missing.slice(0, 5).join(", ")}] 多 ${extra.length} [${extra.slice(0, 5).join(", ")}]`);
	} else {
		console.log(`✓ ${code}: ${got.size} keys 完整`);
	}
}
process.exit(fail ? 1 : 0);
