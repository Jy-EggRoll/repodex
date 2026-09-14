/** Repository size risk tier: shared by the backend and demo — single source of thresholds. */
export type RepoRisk = "safe" | "warn" | "danger";

export function riskForSize(sizeMb: number): RepoRisk {
  if (sizeMb < 800) return "safe";
  if (sizeMb <= 900) return "warn";
  return "danger";
}
