/**
 * 对外 i18n 入口（转发到 locales/index.ts）。
 * 各模块 import { t, setLocale, LOCALES, LOCALE_NAMES } from "./i18n"。
 */

export {
	LOCALES,
	LOCALE_NAMES,
	setLocale,
	getLocale,
	t,
	isRtl,
	isRtlLocale,
	TParams
} from "./locales/index";
