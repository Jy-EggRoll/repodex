/** 仓库体积风险档：后端与 demo 共用，阈值唯一来源。 */
export type RepoRisk = "safe" | "warn" | "danger";

export function riskForSize(sizeMb: number): RepoRisk {
  if (sizeMb < 800) return "safe";
  if (sizeMb <= 900) return "warn";
  return "danger";
}
