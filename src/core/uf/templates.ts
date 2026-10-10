import type { Recipes, StageDef, FlowSpec, WaterSource } from "./types";

/**
 * Шаблоны режимов. У каждого значения указано происхождение:
 * «задание §N» — из ТЗ UF Calc; «рекомендация S2 (по заданию)»; «демо» — до получения S2; «предложение» — на согласование.
 */
const S = (id: string, name: string, kind: StageDef["kind"], t: number, flow: FlowSpec, from: WaterSource, to: string | null, extra: Partial<StageDef> = {}): StageDef =>
  ({ id, name, kind, t, flow, from, to, ...extra });

function chemStage(prefix: string, title: string, dose: Record<string, number>, drain: string, soak: number, inter = false): StageDef[] {
  const rinse = inter ? "Межстадийная отмывка" : `${title}: отмывка`;
  return [
    S(`${prefix}-P0`, `${title}: пуск насоса подачи`, "CEB", 7, { u: "lmh", v0: 0, v1: 120 }, "UF", drain, { station: "bw", dose, orig: "демо; дозирование пропорционально расходу — предложение" }),
    S(`${prefix}-P1`, `${title}: подача в нижний сброс`, "CEB", 30, { u: "lmh", v0: 120, v1: 120 }, "UF", drain, { station: "bw", dose, orig: "поток 120 л/(м²·ч) — рекомендация S2 по заданию; время — демо" }),
    S(`${prefix}-P2`, `${title}: переключение`, "CEB", 8, { u: "lmh", v0: 120, v1: 120 }, "UF", drain, { station: "bw", dose, orig: "демо" }),
    S(`${prefix}-P3`, `${title}: подача в верхний сброс`, "CEB", 30, { u: "lmh", v0: 120, v1: 120 }, "UF", drain, { station: "bw", dose, orig: "демо" }),
    S(`${prefix}-P4`, `${title}: останов и изоляция`, "CEB", 7, { u: "lmh", v0: 120, v1: 0 }, "UF", drain, { station: "bw", dose, orig: "демо" }),
    S(`${prefix}-S`, `${title}: выдержка`, "SOAK", soak, { u: "m3h", v0: 0, v1: 0 }, "none", null, { orig: "демо" }),
    S(`${prefix}-R0`, `${rinse} — пуск`, "RINSE", 7, { u: "lmh", v0: 0, v1: 230 }, "UF", drain, { station: "bw", orig: "демо" }),
    S(`${prefix}-R1`, `${rinse} в нижний сброс`, "RINSE", 60, { u: "lmh", v0: 230, v1: 230 }, "UF", drain, { station: "bw", orig: "поток 230 л/(м²·ч) — рекомендация S2 по заданию; время — демо" }),
    S(`${prefix}-R2`, `${rinse} — переключение`, "RINSE", 8, { u: "lmh", v0: 230, v1: 230 }, "UF", drain, { station: "bw", orig: "демо" }),
    S(`${prefix}-R3`, `${rinse} в верхний сброс`, "RINSE", 60, { u: "lmh", v0: 230, v1: 230 }, "UF", drain, { station: "bw", orig: "демо" }),
    S(`${prefix}-R4`, `${rinse} — останов`, "RINSE", 7, { u: "lmh", v0: 230, v1: 0 }, "UF", drain, { station: "bw", orig: "демо" }),
  ];
}

/** Демо-дозы, мг/л действующего вещества. Не рекомендации. */
export const DEMO_DOSES = { NaOH: 400, NaOCl: 200, HCl: 500 } as const;

export function defaultRecipes(): Recipes {
  const D = DEMO_DOSES;
  return {
    tFilt: 1800,
    filtRamp: [S("FR", "Разгон фильтрации", "FR", 10, { u: "filt", from0: true }, "raw", "UF", { produces: true, orig: "демо" })],
    filtStop: [S("FST", "Останов фильтрации при пределе продления", "FS", 10, { u: "filt", to0: true }, "raw", "UF", { produces: true, orig: "предложение" })],
    preService: [
      S("FX", "Переход фильтрация → FF", "FX", 0, { u: "ff" }, "raw", "drain_ff", { orig: "демо (0 — мгновенно)" }),
      S("FF", "Прямая промывка исходной водой (FF)", "FF", 30, { u: "ff" }, "raw", "drain_ff", { orig: "задание §10: 30 с, расход = фильтрации" }),
      S("FFS", "Останов подачи после FF", "FFS", 5, { u: "ff", to0: true }, "raw", "drain_ff", { orig: "демо" }),
    ],
    restart: [S("RS", "Пуск подачи после ожидания", "RS", 10, { u: "ff", from0: true }, "raw", "drain_ff", { orig: "предложение" })],
    bw: [
      S("BW0", "BW: разгон насоса", "BW", 7, { u: "lmh", v0: 0, v1: 230 }, "UF", "drain_bw_bottom", { station: "bw", orig: "задание §10 (вне Net BW)" }),
      S("BW1", "BW: нижний сброс BWDB", "BW", 30, { u: "lmh", v0: 230, v1: 230 }, "UF", "drain_bw_bottom", { station: "bw", orig: "задание §10" }),
      S("BW2", "BW: переключение", "BW", 8, { u: "lmh", v0: 230, v1: 230 }, "UF", "drain_bw_bottom", { station: "bw", orig: "задание §10 (в Net BW)" }),
      S("BW3", "BW: верхний сброс BWDT", "BW", 22, { u: "lmh", v0: 230, v1: 230 }, "UF", "drain_bw_top", { station: "bw", orig: "задание §10" }),
      S("BW4", "BW: останов насоса", "BW", 7, { u: "lmh", v0: 230, v1: 0 }, "UF", "drain_bw_top", { station: "bw", orig: "задание §10 (вне Net BW)" }),
    ],
    ceb: {
      "CEB1.1A": { name: "CEB 1.1(A) щелочная", src: "UF", stages: chemStage("A", "Щелочная", { NaOH: D.NaOH }, "drain_chem_alk", 600) },
      "CEB1.1B": { name: "CEB 1.1(B) щелочно-окислительная", src: "UF", stages: chemStage("B", "Щелочно-окислительная", { NaOH: D.NaOH, NaOCl: D.NaOCl }, "drain_chem_cl", 900) },
      CEB1: { name: "CEB 1 щелочная + кислотная", src: "UF", stages: [...chemStage("1A", "Щелочная", { NaOH: D.NaOH }, "drain_chem_alk", 600, true), ...chemStage("1K", "Кислотная", { HCl: D.HCl }, "drain_chem_acid", 600)] },
      CEB2: { name: "CEB 2 кислотная", src: "UF", stages: chemStage("K", "Кислотная", { HCl: D.HCl }, "drain_chem_acid", 600) },
      CEB3: { name: "CEB 3 окислительная", src: "UF", stages: chemStage("O", "Окислительная", { NaOCl: D.NaOCl }, "drain_chem_cl", 900) },
    },
  };
}

/** Источник CEB применяется к подаче и всем отмывкам программы. */
export function applySources(rec: Recipes): Recipes {
  for (const c of Object.values(rec.ceb)) for (const s of c.stages) if (s.from !== "none") s.from = c.src;
  return rec;
}

/** Тест D (§24.1): все прочие переходы нулевые. */
export function testDRecipes(): Recipes {
  const r = defaultRecipes();
  r.filtRamp[0].t = 0;
  r.preService[0].t = 0;
  r.preService[2].t = 0;
  return applySources(r);
}

export const DRAIN_LABELS: Record<string, string> = {
  drain_ff: "сток FF", drain_bw_bottom: "BW нижний сброс", drain_bw_top: "BW верхний сброс",
  drain_chem_alk: "щелочные стоки", drain_chem_acid: "кислотные стоки", drain_chem_cl: "хлорсодержащие стоки",
};
