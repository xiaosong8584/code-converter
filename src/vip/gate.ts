/**
 * VIP 功能门禁（付费功能清单 + 判定函数）。
 *
 * 设计原则：
 * 1. **纯函数、无副作用、不依赖 Obsidian** —— 可在 test/vip-ad.test.mjs 里直接回归。
 * 2. **显式清单，不用 slice(-N)** —— 将来新增语言/命令时，作者必须在源文件里显式
 *    表态"它是否收费"，不会被数组顺序变化悄悄改变收费范围。
 *    代价是新增语言时要记得同步本文件，由 test 里的「尾部一致性」用例兜底。
 * 3. **只在调用点判定 vipActive 参数** —— 本模块不持有状态，避免与
 *    vipState/seal 的生命周期耦合（seal 失效后 vipState 会变 null）。
 *
 * ⚠️ 合规（Obsidian Developer Policies）：付费功能允许，但
 *    ① 目录 listing 必须选 "Optional payments"；
 *    ② README 必须写明哪些功能需要付费。
 *    改动本文件的清单时，**必须**同步 README.md / README.zh-CN.md 的 Disclosure
 *    与 USER_GUIDE.md，否则会被社区目录人工审查打回。
 */

import type { UILocale } from "../types";

/**
 * 需要 VIP 才能执行的命令 id（与 main.ts 里 addCommand 的 id 一一对应）。
 *
 * 当前：文件夹批量扫描转换（vault 级批量操作，定位为增强功能）。
 * 单文件转换 / 检测 / 乱码修复 / 日志导出保持永久免费。
 */
export const VIP_ONLY_COMMANDS: readonly string[] = ["cc-convert-folder"];

/**
 * 需要 VIP 的界面语言：src/locales/index.ts 里 LOCALES 顺序的**后 6 种**。
 *
 * 免费 4 种：zh-CN / en / ja / ko
 * VIP 6 种：ru / fr / de / es / pt-BR / ar
 */
export const VIP_ONLY_LOCALES: readonly UILocale[] = ["ru", "fr", "de", "es", "pt-BR", "ar"];

/**
 * 需要 VIP 才能开启的设置项（键名 = CodeConverterSettings 的字段名）。
 *
 * - `textExtensions`：转换的文件扩展名。文件夹批量转换是 VIP 增强功能；
 *   导入自动转换本身永久免费，但它的扫描范围由这个白名单约束，非 VIP
 *   改了不会产生任何效果，所以输入框置灰——留着可编辑会让人误以为已生效。
 *
 * 注意：`autoConvertOnImport` **不在本清单里**——它是插件的灵魂（防 Obsidian
 * 保存毁坏非 UTF-8 文件），永久免费且默认开启。
 */
export const VIP_ONLY_SETTINGS: readonly string[] = ["textExtensions"];

/**
 * 界面语言被锁时的回落语言。
 *
 * 为什么是 en 而不是 DEFAULT_SETTINGS.locale（zh-CN）：被锁的是欧陆/阿拉伯语系用户，
 * 回落到中文比回落英文更突兀；en 对所有 VIP 语言用户都是"看不懂但至少是拉丁字母"的
 * 中间态。用户激活 VIP 后可重新选回原语言。
 */
export const FALLBACK_LOCALE: UILocale = "en";

/** 命令是否需要 VIP（vipActive = 本次启动判定后的 VIP 是否有效） */
export function isCommandLocked(commandId: string, vipActive: boolean): boolean {
	return !vipActive && VIP_ONLY_COMMANDS.includes(commandId);
}

/** 界面语言是否需要 VIP */
export function isLocaleLocked(locale: UILocale, vipActive: boolean): boolean {
	return !vipActive && VIP_ONLY_LOCALES.includes(locale);
}

/** 设置项是否需要 VIP */
export function isSettingLocked(settingKey: string, vipActive: boolean): boolean {
	return !vipActive && VIP_ONLY_SETTINGS.includes(settingKey);
}
