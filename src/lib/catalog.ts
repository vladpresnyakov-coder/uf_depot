"use client";
/**
 * Справочники пользователя: товарные коагулянты и методики дозы.
 * Без входа — в браузере (localStorage); после входа через Telegram — в аккаунте (/api/catalog).
 */
import type { Basis, CoagulantType } from "@/core/coagulation/profiles";
import { PROFILES } from "@/core/coagulation/profiles";
import { MANUAL_METHOD_ID, type DoseMethod } from "@/core/coagulation/doseMethod";

export interface Product {
  id: string;
  coagulantType: CoagulantType;
  name: string;
  manufacturer: string;
  grade: string;
  batch: string;
  form: "liquid" | "solid";
  hydrateN: number | null;
  concentration: number | null;
  concentrationBasis: Basis | null;
  density: number | null;
  basicity: number | null;
  basicityDefinition: string;
  freeAcidity: number | null;
  fe2Share: number | null;
  workingPreparation: string;
  workingConcentration: number | null;
  workingBasis: Basis | null;
  source: string;
  demo?: boolean;
}

export interface Catalog {
  version: 1;
  defaultType: CoagulantType;
  products: Product[];
  methods: DoseMethod[];
  defaultProduct: Partial<Record<CoagulantType, string>>;
  defaultMethod: Partial<Record<CoagulantType, string>>;
}

const KEY = "ufdepot.catalog.v1";
const TODAY = "2026-10-11";
export const TYPES = Object.keys(PROFILES) as CoagulantType[];
export const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

export function emptyProduct(t: CoagulantType): Product {
  const P = PROFILES[t];
  return {
    id: newId("prod"), coagulantType: t, name: "", manufacturer: "", grade: "", batch: "",
    form: P.salt ? "solid" : "liquid", hydrateN: null, concentration: null, concentrationBasis: P.metal === "Al" && !P.salt ? "Al2O3" : "salt",
    density: null, basicity: null, basicityDefinition: "", freeAcidity: null, fe2Share: null,
    workingPreparation: "", workingConcentration: null, workingBasis: null, source: "",
  };
}

export const manualMethod = (t: CoagulantType): DoseMethod => ({
  id: MANUAL_METHOD_ID(t), name: "Доза задаётся пользователем", coagulantType: t, model: "manual", version: 1,
  inputs: [], coefficients: [], outputBasis: "metal", source: "Не требуется", status: "verified", createdAt: TODAY,
});

export function emptyMethod(t: CoagulantType): DoseMethod {
  return {
    id: newId("meth"), name: "", coagulantType: t, model: "expression", version: 1,
    inputs: [], expression: "", coefficients: [], outputBasis: "metal", band: { lower: 0.2, upper: 0.2 },
    phWindow: { min: null, max: null }, source: "", status: "user", createdAt: TODAY,
  };
}

/** Начальный справочник: демо-продукты и ручная доза по умолчанию; один демо-пример методики для показа механизма. */
export function seedCatalog(): Catalog {
  const demo = (t: CoagulantType, p: Partial<Product>): Product => ({ ...emptyProduct(t), id: `demo-${t}`, demo: true, source: "ДЕМО: значения для примера, не паспорт производителя", ...p });
  const products: Product[] = [
    demo("PACl", { name: "ДЕМО-ПОХА-17", manufacturer: "(демо)", grade: "жидкий", form: "liquid", concentration: 17, concentrationBasis: "Al2O3", density: 1.37, basicity: 70, basicityDefinition: "[OH]/(3·[Al]), мольн. %", workingPreparation: "разбавление водой", workingConcentration: 10, workingBasis: "Al2O3" }),
    demo("FeCl3", { name: "ДЕМО-FeCl₃-40", manufacturer: "(демо)", grade: "раствор 40 %", form: "liquid", concentration: 40, concentrationBasis: "salt", density: 1.42, workingPreparation: "разбавление водой", workingConcentration: 20, workingBasis: "salt" }),
    demo("FeSO4", { name: "ДЕМО-FeSO₄·7H₂O", manufacturer: "(демо)", grade: "кристаллический", form: "solid", hydrateN: 7, concentration: 98, concentrationBasis: "hydrate", workingPreparation: "растворение", workingConcentration: 100, workingBasis: "hydrate" }),
  ];
  const methods: DoseMethod[] = [
    ...TYPES.map(manualMethod),
    {
      id: "demo-pacl-expr", name: "ДЕМО-пример: по цветности и мутности", coagulantType: "PACl", model: "expression", version: 1,
      inputs: [{ key: "color", min: 5, max: 80 }, { key: "turbidity", min: 0.5, max: 20 }],
      expression: "a + b*color + c*turbidity",
      coefficients: [
        { name: "a", value: 0.5, unit: "мг/л Al", basis: "ДЕМО" },
        { name: "b", value: 0.05, unit: "мг/л Al на град.", basis: "ДЕМО" },
        { name: "c", value: 0.1, unit: "мг/л Al на NTU", basis: "ДЕМО" },
      ],
      outputBasis: "metal", band: { lower: 0.3, upper: 0.3 }, phWindow: { min: 6.5, max: 7.8 },
      source: "ДЕМО: коэффициенты условные, показывают работу механизма. Не использовать для проектирования.", status: "demo", createdAt: TODAY,
    },
  ];
  return {
    version: 1, defaultType: "PACl", products, methods,
    defaultProduct: { PACl: "demo-PACl", FeCl3: "demo-FeCl3", FeSO4: "demo-FeSO4" },
    defaultMethod: Object.fromEntries(TYPES.map((t) => [t, MANUAL_METHOD_ID(t)])),
  };
}

/** Проверка формы справочника; ручная доза всегда есть для каждого типа. */
export function normalizeCatalog(v: unknown): Catalog | null {
  const c = v as Catalog;
  if (!c || c.version !== 1 || !Array.isArray(c.products) || !Array.isArray(c.methods)) return null;
  for (const t of TYPES) if (!c.methods.some((m) => m.id === MANUAL_METHOD_ID(t))) c.methods.unshift(manualMethod(t));
  c.defaultProduct ??= {};
  c.defaultMethod ??= {};
  if (!TYPES.includes(c.defaultType)) c.defaultType = "PACl";
  return c;
}

export function loadCatalog(): Catalog {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const c = normalizeCatalog(JSON.parse(raw)); if (c) return c; }
  } catch { /* хранилище недоступно — работаем с начальным справочником */ }
  return seedCatalog();
}

export function saveCatalog(c: Catalog): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(c)); return true; } catch { return false; }
}
