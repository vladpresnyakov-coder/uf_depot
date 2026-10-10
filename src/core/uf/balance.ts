/** U-01: объём линейного участка q0 → q1 (м³/ч) за t (с). */
export const vol = (q0: number, q1: number, t: number) => ((q0 + q1) / 2) * (t / 3600);

/** Объём части [a, b] (с от начала стадии длительностью t). Точное интегрирование линейной функции. */
export function volPart(q0: number, q1: number, t: number, a: number, b: number): number {
  if (b <= a || t <= 0) return 0;
  const k = (q1 - q0) / t;
  return (q0 * (b - a) + (k * (b * b - a * a)) / 2) / 3600;
}

export const qAt = (q0: number, q1: number, t: number, a: number) => (t > 0 ? q0 + ((q1 - q0) * a) / t : q0);

/** U-02: дозирование. D мг/л, Q м³/ч, w доля, ρ кг/л, C г/л той же базы. */
export function dosing(D: number, Q: number, w: number, rho: number, C?: number | null) {
  const Ma = (D * Q) / 1000;
  const Mc = Ma / w;
  return { activeKgH: Ma, commercialKgH: Mc, commercialLH: Mc / rho, workingLH: C ? (D * Q) / C : NaN };
}

/** U-03: баланс ОО с полным возвратом концентрата ОО-2 на вход ОО-1. */
export function roBalance(V1: number, V2: number, eta1: number, eta2: number) {
  const F2 = V2 / eta2, R2 = F2 - V2, P1 = V1 + F2, F1 = P1 / eta1, UF = F1 - R2, C1 = F1 - P1;
  return { F2, R2, P1, F1, UF, C1, check: UF - (V1 + V2 + C1) };
}
export const kP1 = (eta1: number) => 1 / eta1;
export const kP2 = (eta1: number, eta2: number) => 1 / (eta1 * eta2) - (1 - eta2) / eta2;

/** U-08: требуемый напор, м. Давления — бар изб., отметки и потери — м. */
export function head(b: { p_in?: number | null; p_out?: number | null; z_in?: number | null; z_out?: number | null; h_loss?: number | null; dp_membrane_bar?: number | null; rho?: number }) {
  const g = 9.80665, rho = b.rho ?? 998;
  const need = ["p_in", "p_out", "z_in", "z_out", "h_loss"] as const;
  const miss = need.filter((k) => typeof b[k] !== "number" || !Number.isFinite(b[k] as number));
  if (miss.length) return { complete: false as const, missing: [...miss] };
  const toM = (bar: number) => (bar * 1e5) / (rho * g);
  const parts = { pressure: toM((b.p_out as number) - (b.p_in as number)), elevation: (b.z_out as number) - (b.z_in as number), losses: b.h_loss as number, membrane: toM(b.dp_membrane_bar ?? 0) };
  return { complete: true as const, H: parts.pressure + parts.elevation + parts.losses + parts.membrane, parts, rho };
}
