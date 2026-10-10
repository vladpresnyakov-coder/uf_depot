import { ATOMIC, H2O, SO4 } from "../units/chem";

export type CoagulantType = "PACl" | "Al2(SO4)3" | "FeCl3" | "Fe2(SO4)3" | "FeSO4";
export type Metal = "Al" | "Fe";
/** База выражения дозы или концентрации. */
export type Basis = "metal" | "Al2O3" | "salt" | "hydrate" | "product";

export interface CoagulantProfile {
  type: CoagulantType;
  label: string;
  metal: Metal;
  oxidation: "Al(III)" | "Fe(III)" | "Fe(II)";
  salt: { formula: string; molarMass: number; metalAtoms: number } | null;
  bases: Basis[];
  /** мг-экв щёлочности на ммоль металла (стехиометрия, полный гидролиз). */
  alkalinityEqPerMmol: number;
  usesBasicity: boolean;
  checks: string[];
}

export const PROFILES: Record<CoagulantType, CoagulantProfile> = {
  PACl: {
    type: "PACl", label: "ПОХА / PACl", metal: "Al", oxidation: "Al(III)", salt: null,
    bases: ["metal", "Al2O3", "product"], alkalinityEqPerMmol: 3, usesBasicity: true,
    checks: ["основность и её определение для баланса щёлочности"],
  },
  "Al2(SO4)3": {
    type: "Al2(SO4)3", label: "Сульфат алюминия Al₂(SO₄)₃", metal: "Al", oxidation: "Al(III)",
    salt: { formula: "Al₂(SO₄)₃", molarMass: 2 * ATOMIC.Al + 3 * SO4, metalAtoms: 2 },
    bases: ["metal", "Al2O3", "salt", "hydrate", "product"], alkalinityEqPerMmol: 3, usesBasicity: false,
    checks: ["безводная соль или кристаллогидрат (n)"],
  },
  FeCl3: {
    type: "FeCl3", label: "Хлорид железа(III) FeCl₃", metal: "Fe", oxidation: "Fe(III)",
    salt: { formula: "FeCl₃", molarMass: ATOMIC.Fe + 3 * ATOMIC.Cl, metalAtoms: 1 },
    bases: ["metal", "salt", "hydrate", "product"], alkalinityEqPerMmol: 3, usesBasicity: false,
    checks: ["доля Fe²⁺ в продукте, если указана"],
  },
  "Fe2(SO4)3": {
    type: "Fe2(SO4)3", label: "Сульфат железа(III) Fe₂(SO₄)₃", metal: "Fe", oxidation: "Fe(III)",
    salt: { formula: "Fe₂(SO₄)₃", molarMass: 2 * ATOMIC.Fe + 3 * SO4, metalAtoms: 2 },
    bases: ["metal", "salt", "hydrate", "product"], alkalinityEqPerMmol: 3, usesBasicity: false,
    checks: ["доля Fe²⁺ в продукте, если указана"],
  },
  FeSO4: {
    type: "FeSO4", label: "Сульфат железа(II) FeSO₄", metal: "Fe", oxidation: "Fe(II)",
    salt: { formula: "FeSO₄", molarMass: ATOMIC.Fe + SO4, metalAtoms: 1 },
    bases: ["metal", "salt", "hydrate", "product"], alkalinityEqPerMmol: 2, usesBasicity: false,
    checks: ["независимый статус проверки окисления Fe²⁺"],
  },
};

/** Массовая доля металла в форме, выраженной базой (кроме «товарный продукт»). */
export function metalFraction(type: CoagulantType, basis: Basis, hydrateN?: number | null): number {
  const p = PROFILES[type];
  if (basis === "metal") return 1;
  if (basis === "Al2O3") return p.metal === "Al" ? (2 * ATOMIC.Al) / (2 * ATOMIC.Al + 3 * ATOMIC.O) : NaN;
  if (!p.salt) return NaN;
  const m = p.salt.metalAtoms * ATOMIC[p.metal];
  if (basis === "salt") return m / p.salt.molarMass;
  if (basis === "hydrate") return hydrateN != null && hydrateN > 0 ? m / (p.salt.molarMass + hydrateN * H2O) : NaN;
  return NaN;
}

export function basisLabel(type: CoagulantType, basis: Basis, hydrateN?: number | null): string {
  const p = PROFILES[type];
  switch (basis) {
    case "metal": return p.metal;
    case "Al2O3": return "Al₂O₃";
    case "salt": return `${p.salt?.formula} безв.`;
    case "hydrate": return `${p.salt?.formula}·${hydrateN ?? "n"}H₂O`;
    case "product": return "товарный продукт";
  }
}
