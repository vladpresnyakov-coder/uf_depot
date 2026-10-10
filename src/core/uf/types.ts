export type WaterSource = "raw" | "UF" | "RO1" | "RO2" | "none";
export type StageKind = "FR" | "F" | "FS" | "FX" | "FF" | "FFS" | "RS" | "BW" | "CEB" | "SOAK" | "RINSE" | "W";

/** Расход стадии: в л/(м²·ч) (привязан к площади), в м³/ч, или связан с расходом фильтрации / FF. */
export type FlowSpec =
  | { u: "lmh"; v0: number; v1: number }
  | { u: "m3h"; v0: number; v1: number }
  | { u: "filt"; from0?: boolean; to0?: boolean }
  | { u: "ff"; from0?: boolean; to0?: boolean };

export interface StageDef {
  id: string;
  name: string;
  kind: StageKind;
  /** длительность, с */
  t: number;
  flow: FlowSpec;
  from: WaterSource;
  /** приёмник: "UF" (бак УФ) или ключ стока */
  to: string | null;
  produces?: boolean;
  station?: "bw";
  /** доза действующего вещества, мг/л, по реагентам; отсутствует — дозирования нет */
  dose?: Record<string, number> | null;
  /** происхождение значения */
  orig?: string;
}

export interface CebProgram { name: string; src: "UF" | "RO1" | "RO2"; stages: StageDef[] }

export interface Recipes {
  tFilt: number;
  filtRamp: StageDef[];
  filtStop: StageDef[];
  preService: StageDef[];
  restart: StageDef[];
  bw: StageDef[];
  ceb: Record<string, CebProgram>;
}

export interface SupercycleRow { n: number; ceb: string | null }

export interface SimParams {
  N: number;
  groups: number[][];
  phase?: number[];
  startPos?: number[];
  A_unit: number;
  J: number;
  ffLinked: boolean;
  Qff?: number | null;
  rec: Recipes;
  supercycle: SupercycleRow[];
  /** максимум продления фильтрации, с */
  maxExt: number;
  warmupDays: number;
  days: number;
  eta1: number;
  eta2: number;
  detailDay?: number | null;
}
