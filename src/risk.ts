/**
 * 「导入时自动转换为 UTF-8」开启前的风险确认 —— 纯逻辑层。
 *
 * 单独拆出来是为了不依赖 Obsidian，可以直接进单元测试。
 * UI 部分见 src/risk-modal.ts。
 */

/** 风险正文使用的 i18n key，数组顺序即弹窗中的展示顺序 */
export const AUTO_CONVERT_RISK_KEYS = [
	"modal.risk.intro",
	"modal.risk.body1",
	"modal.risk.body2",
	"modal.risk.body3",
	"modal.risk.body4"
] as const;

/**
 * 是否需要在「开启」这一刻弹风险确认。
 *
 * 口径：只在 false → true 的转变上提示。
 * - 关闭（true → false）不打扰，尊重用户收回决定的权利；
 * - 已经是开启状态的不重复弹（例如重绘面板、重新进入设置）；
 * - current 取的是**已落盘的设置值**，不是 UI 上开关的瞬时状态，
 *   所以「弹窗里取消」这种情况下次再开仍然会提示。
 */
export function shouldWarnOnEnable(next: boolean, current: boolean): boolean {
	return next === true && current !== true;
}

/**
 * 开启后是否要额外警告「备份处于关闭状态」。
 * 没有备份时误判只能手工恢复，属于必须单独强调的那一条。
 */
export function shouldWarnAboutBackup(backupEnabled: boolean): boolean {
	return backupEnabled !== true;
}
