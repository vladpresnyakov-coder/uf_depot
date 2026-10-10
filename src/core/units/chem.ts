/** Атомные массы IUPAC, г/моль. */
export const ATOMIC = { H: 1.008, O: 15.999, S: 32.06, Cl: 35.45, Al: 26.982, Fe: 55.845, Na: 22.99 } as const;
export const H2O = 2 * ATOMIC.H + ATOMIC.O;
export const SO4 = ATOMIC.S + 4 * ATOMIC.O;

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Перевод щёлочности: мг/л CaCO₃ → мг-экв/л. */
export const alkCaCO3ToMeq = (mgL: number) => mgL / 50.04;
