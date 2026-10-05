/**
 * i18n 聚合模块：合并 10 种语言，提供 t(key) 翻译函数。
 * - 当前语言存在 key → 用该语言
 * - 否则回退 en → 再回退 key 本身
 * - 支持 {n}/{p}/{enc} 等占位符替换
 */

import { LocaleDict, LocaleCode } from "./types";
import { zhCN } from "./zh-CN";
import { en } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";
import { ru } from "./ru";
import { fr } from "./fr";
import { de } from "./de";
import { es } from "./es";
import { ptBR } from "./pt-BR";
import { ar } from "./ar";

export const LOCALES: Record<LocaleCode, LocaleDict> = {
	"zh-CN": zhCN,
	"en": en,
	"ja": ja,
	"ko": ko,
	"ru": ru,
	"fr": fr,
	"de": de,
	"es": es,
	"pt-BR": ptBR,
	"ar": ar
};

export const LOCALE_NAMES: Record<LocaleCode, string> = {
	"zh-CN": "简体中文",
	"en": "English",
	"ja": "日本語",
	"ko": "한국어",
	"ru": "Русский",
	"fr": "Français",
	"de": "Deutsch",
	"es": "Español",
	"pt-BR": "Português (BR)",
	"ar": "العربية"
};

let current: LocaleCode = "zh-CN";

export function setLocale(code: LocaleCode): void {
	if (LOCALES[code]) current = code;
	else current = "en";
}

export function getLocale(): LocaleCode {
	return current;
}

/** RTL（从右到左）语言集合 */
const RTL_LOCALES: Set<LocaleCode> = new Set(["ar"]);

/** 当前语言是否 RTL */
export function isRtl(): boolean {
	return RTL_LOCALES.has(current);
}

/** 给定语言代码是否 RTL */
export function isRtlLocale(code: LocaleCode): boolean {
	return RTL_LOCALES.has(code);
}

export type TParams = Record<string, string | number>;

/** 翻译一个 key；不存在则回退 en → key 本身；做占位符替换 */
export function t(key: string, params?: TParams): string {
	let msg = LOCALES[current]?.[key as keyof LocaleDict];
	if (msg == null) msg = LOCALES["en"]?.[key as keyof LocaleDict];
	if (msg == null) msg = key;

	if (params) {
		for (const [k, v] of Object.entries(params)) {
			msg = msg.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
		}
	}
	return msg;
}
