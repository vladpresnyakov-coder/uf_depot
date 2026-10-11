"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PROFILES, basisLabel, type Basis, type CoagulantType } from "@/core/coagulation/profiles";
import { WATER_PARAMS, MANUAL_METHOD_ID, type DoseMethod, type WaterKey } from "@/core/coagulation/doseMethod";
import type { CoagResult } from "@/core/coagulation/calculate";
import { fmt, toNum, NumField, TextField, Select, Seg, StatusPill, Messages } from "@/components/ui";
import { loadCatalog, saveCatalog, seedCatalog, normalizeCatalog, emptyProduct, emptyMethod, newId, TYPES, type Catalog, type Product } from "@/lib/catalog";
import { useMe } from "@/lib/account";
import { SaveCalc } from "@/components/SaveCalc";
import { BuiltinCard } from "@/components/BuiltinCard";
import { JarPanel } from "./JarPanel";
import { fromParam, nf, readUfToCoag, sendToUf, type UfToCoag } from "@/lib/link";
import { useRouter } from "next/navigation";
import { metalFraction } from "@/core/coagulation/profiles";
import { builtinAsMethod, builtinById, builtinsFor, defaultOptions, recommendedBuiltin, OBJECT_TYPES, STATUS_LABEL, type ObjectType, type Opts } from "@/core/coagulation/normative";

/** Методики типа: ручная доза, встроенные (нормативные и справочные), методики пользователя. */
function methodsOf(c: Catalog, tp: CoagulantType): DoseMethod[] {
  const own = c.methods.filter((m) => m.coagulantType === tp);
  return [...own.filter((m) => m.model === "manual"), ...builtinsFor(tp).map((d) => builtinAsMethod(d, tp)), ...own.filter((m) => m.model !== "manual")];
}
import { ProductEditor, MethodEditor, productErrors, typeLabel } from "./CatalogEditors";
import { t } from "@/i18n/ru";

type S = Record<string, string>;
const DEMO_WATER: Partial<Record<WaterKey, string>> = { pH: "7,4", alkalinity: "2,1", temperature: "8", turbidity: "6", color: "35", permanganate: "6,8", tss: "8", al: "0,05", fe: "0,3" };
const STAR = "★";
const JAR_ID = "gost-r-51642-2000-a-jar";
/** Доля Al₂O₃ в товарном продукте, % — из паспорта (любая база, кроме «товарный»). */
function al2o3Pct(p: Product | null, t: CoagulantType): number {
  if (!p || p.concentration == null || !p.concentrationBasis || p.concentrationBasis === "product" || PROFILES[t].metal !== "Al") return NaN;
  return (p.concentration * metalFraction(t, p.concentrationBasis, p.hydrateN)) / metalFraction(t, "Al2O3");
}

export default function CoagulationCalculator() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [coag, setCoag] = useState<CoagulantType>("PACl");
  const [productId, setProductId] = useState<string>("");
  const [methodId, setMethodId] = useState<string>("");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editMethod, setEditMethod] = useState<DoseMethod | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [manualDose, setManualDose] = useState<S>({ basis: "metal", min: "1,5", nom: "2,5", max: "4" });
  const [accepted, setAccepted] = useState("");
  const [bOpts, setBOpts] = useState<Record<string, Opts>>({});
  const [objType, setObjType] = useState<ObjectType>("other");
  const [fromUf, setFromUf] = useState<UfToCoag | null>(null);
  const router = useRouter();
  const [flow, setFlow] = useState<S>({ mode: "uf", trains: "3", perTrain: "40", nom: "120", min: "", max: "", minO: "", maxO: "" });
  const [water, setWater] = useState<Partial<Record<WaterKey, string>>>(DEMO_WATER);
  const [ph, setPh] = useState<S>({ mode: "none", reagent: "NaOH", method: "manual", d100: "", target: "", w: "0,46", rho: "1,49", wc: "50" });
  const [contact, setContact] = useState<S>({ calc: "timeToVolume", time: "60", timeBasis: "", volume: "", flowBasis: "max", k: "", kBasis: "" });
  const [pipe, setPipe] = useState<S>({ flowBasis: "max", v: "1,5", din: "" });
  const [pumps, setPumps] = useState<S>({ p: "2,5", dp: "0,5", margin: "" });
  const [ox, setOx] = useState("auto");
  const [res, setRes] = useState<CoagResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [lastInput, setLastInput] = useState<unknown>(null);
  // где живёт справочник: браузер (без входа) или аккаунт; importOffer — в аккаунте пусто
  const [store, setStore] = useState<"local" | "account">("local");
  const [importOffer, setImportOffer] = useState(false);
  const [sync, setSync] = useState<"ok" | "saving" | "error">("ok");
  const first = useRef(true);
  const me = useMe();

  // справочник: сначала из браузера, после проверки входа — из аккаунта
  useEffect(() => {
    // расход из UF Calc: рабочие установки и подача при фильтрации на установку
    const l = fromParam() === "uf" ? readUfToCoag() : null;
    if (l) {
      const s3 = (x: number) => String(Number(x.toFixed(3))).replace(".", ",");
      setFlow((f) => ({ ...f, mode: "uf", trains: String(l.N), perTrain: s3(l.feedPerUnit), minO: "", maxO: l.feedMax > l.totalFeed * 1.001 ? s3(l.feedMax) : "" }));
      setFromUf(l);
    }
    const c = loadCatalog();
    setCat(c);
    selectType(c, c.defaultType);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!me) return;
    fetch("/api/catalog", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j.catalog) {
        const c = normalizeCatalog(j.catalog);
        if (c) { setStore("account"); setCat(c); selectType(c, c.defaultType); first.current = true; }
      } else { setStore("account"); setImportOffer(true); }
    }).catch(() => setSync("error"));
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pushCatalog(c: Catalog) {
    setSync("saving");
    try {
      const r = await fetch("/api/catalog", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ catalog: c }) });
      setSync(r.ok ? "ok" : "error");
    } catch { setSync("error"); }
  }

  function selectType(c: Catalog, tp: CoagulantType) {
    setCoag(tp);
    const prods = c.products.filter((p) => p.coagulantType === tp);
    setProductId(c.defaultProduct[tp] && prods.some((p) => p.id === c.defaultProduct[tp]) ? (c.defaultProduct[tp] as string) : prods[0]?.id ?? "");
    const meths = methodsOf(c, tp);
    setMethodId(c.defaultMethod[tp] && meths.some((m) => m.id === c.defaultMethod[tp]) ? (c.defaultMethod[tp] as string) : MANUAL_METHOD_ID(tp));
    setEditProduct(null); setEditMethod(null); setRes(null); setAccepted("");
  }
  const commit = (c: Catalog) => {
    setCat(c);
    if (store === "account") { setImportOffer(false); pushCatalog(c); } else setSaved(saveCatalog(c));
  };
  const adopt = (c: Catalog) => { setImportOffer(false); setCat(c); selectType(c, c.defaultType); pushCatalog(c); };

  const P = PROFILES[coag];
  const products = cat?.products.filter((p) => p.coagulantType === coag) ?? [];
  const methods = cat ? methodsOf(cat, coag) : [];
  const product = products.find((p) => p.id === productId) ?? null;
  const method = methods.find((m) => m.id === methodId) ?? null;
  const isManual = !method || method.model === "manual";
  const builtin = method?.model === "builtin" ? builtinById(method.builtinId ?? "") : null;
  const opts: Opts = builtin ? { ...defaultOptions(builtin), ...(bOpts[builtin.id] ?? {}) } : {};
  const setOpt = (k: string) => (v: string) => builtin && setBOpts((s) => ({ ...s, [builtin.id]: { ...opts, [k]: v } }));
  const neededKeys = new Set<string>(builtin ? builtin.required(opts) : method?.inputs.map((i) => i.key) ?? []);
  const rec = recommendedBuiltin(objType, coag);
  const upS = (set: (f: (s: S) => S) => void, k: string) => (v: string) => set((s) => ({ ...s, [k]: v }));

  const run = useCallback(async () => {
    if (!cat) return;
    setBusy(true); setErr(null);
    const pr = product;
    const w: Record<string, number | null> = {};
    for (const k of Object.keys(WATER_PARAMS)) w[k] = toNum(water[k as WaterKey] ?? "");
    const body = {
      coagulant: coag,
      passport: pr ? { name: pr.name, form: pr.form, hydrateN: pr.hydrateN, concentration: pr.concentration, concentrationBasis: pr.concentrationBasis, density: pr.density, basicity: pr.basicity, basicityDefinition: pr.basicityDefinition, freeAcidity: pr.freeAcidity, workingConcentration: pr.workingConcentration, workingBasis: pr.workingBasis } : { name: "", form: "liquid", concentration: null, concentrationBasis: null },
      flow: flow.mode === "uf" ? { mode: "uf", trains: toNum(flow.trains), perTrain: toNum(flow.perTrain), minOverride: toNum(flow.minO), maxOverride: toNum(flow.maxO) } : { mode: "coag", nom: toNum(flow.nom), min: toNum(flow.min), max: toNum(flow.max) },
      dose: isManual
        ? { mode: "manual", min: toNum(manualDose.min), nom: toNum(manualDose.nom), max: toNum(manualDose.max), basis: manualDose.basis, hydrateN: pr?.hydrateN ?? null }
        : { mode: "method", method, options: { ...opts, objectType: objType }, jar: builtin?.id === JAR_ID ? { tests: (cat.jarTests ?? []).filter((x) => x.coagulantType === coag), norms: cat.norms } : undefined, accepted: toNum(accepted), min: null, nom: null, max: null, basis: method!.outputBasis, hydrateN: pr?.hydrateN ?? null },
      water: w,
      ph: { mode: ph.mode, reagent: ph.reagent, method: ph.method, dose100: toNum(ph.d100), target: toNum(ph.target), curve: [[0, 7.1], [5, 7.4], [10, 7.7], [15, 7.95]], massFraction: toNum(ph.w), density: toNum(ph.rho), working100: toNum(ph.wc) },
      contact: { calc: contact.calc, time: toNum(contact.time), timeBasis: contact.timeBasis, volume: toNum(contact.volume), flowBasis: contact.flowBasis, k: toNum(contact.k), kBasis: contact.kBasis },
      pipe: { flowBasis: pipe.flowBasis, velocity: toNum(pipe.v), actualInnerDiameterMm: toNum(pipe.din) },
      pumps: { pointPressureBar: toNum(pumps.p), extraLossBar: toNum(pumps.dp), marginPct: toNum(pumps.margin) },
      feso4OxidationStatus: ox === "auto" ? undefined : ox,
    };
    setLastInput({ ...body, product: pr, methodName: method?.name ?? null });
    try {
      const r = await fetch("/api/coagulation/calculate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Ошибка расчёта"); setRes(null); } else setRes(j.result);
    } catch { setErr("Сервер расчёта недоступен."); }
    setBusy(false);
  }, [cat, coag, product, method, isManual, manualDose, accepted, flow, water, ph, contact, pipe, pumps, ox, JSON.stringify(opts), objType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (cat && productId !== undefined && first.current) { first.current = false; run(); } }, [cat, productId, methodId, run]);

  if (!cat) return <div className="page"><p className="muted">Загрузка справочников…</p></div>;

  // --- действия справочников ---
  const saveProduct = (p: Product) => {
    const exists = cat.products.some((x) => x.id === p.id);
    commit({ ...cat, products: exists ? cat.products.map((x) => (x.id === p.id ? p : x)) : [...cat.products, p] });
    setProductId(p.id); setEditProduct(null);
  };
  const deleteProduct = (id: string) => {
    const left = cat.products.filter((x) => x.id !== id);
    const dp = { ...cat.defaultProduct };
    if (dp[coag] === id) delete dp[coag];
    commit({ ...cat, products: left, defaultProduct: dp });
    setProductId(left.find((x) => x.coagulantType === coag)?.id ?? ""); setConfirmDel(null);
  };
  const saveMethod = (m: DoseMethod) => {
    const exists = cat.methods.some((x) => x.id === m.id);
    commit({ ...cat, methods: exists ? cat.methods.map((x) => (x.id === m.id ? m : x)) : [...cat.methods, m] });
    setMethodId(m.id); setEditMethod(null);
  };
  const deleteMethod = (id: string) => {
    const dm = { ...cat.defaultMethod };
    if (dm[coag] === id) dm[coag] = MANUAL_METHOD_ID(coag);
    commit({ ...cat, methods: cat.methods.filter((x) => x.id !== id), defaultMethod: dm });
    setMethodId(MANUAL_METHOD_ID(coag)); setConfirmDel(null);
  };

  return (
    <div className="page">
      <div className="eyebrow">Инструмент 1 · узел непосредственной коагуляции перед УФ</div>
      <h1>Коагуляция перед УФ</h1>
      <p className="lead">Исходная вода → предфильтр и насос подачи → коррекция pH → коагулянт → смешение и контакт → УФ. {store === "account" ? "Справочники продуктов и методик хранятся в вашем аккаунте." : "Без входа справочники продуктов и методик хранятся в этом браузере."} Начальные значения — <b>{t.demo}</b>.</p>
      {importOffer && cat && (
        <div className="msg info">
          В аккаунте ещё нет справочника. Перенести справочник из этого браузера ({cat.products.length} продукт., {cat.methods.filter((m) => m.model !== "manual").length} методик) или начать с демо-справочника?
          <div className="btns" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={() => adopt(loadCatalog())}>Перенести из браузера</button>
            <button type="button" className="btn ghost" onClick={() => adopt(seedCatalog())}>Начать с демо</button>
          </div>
        </div>
      )}
      {store === "account" && sync === "error" && <div className="msg bad small">Не удалось сохранить справочник в аккаунте. Изменения действуют до закрытия страницы — повторите действие позже.</div>}
      {store === "local" && !saved && <div className="msg warn small">Браузер не разрешает сохранять справочник: изменения действуют до закрытия страницы.</div>}

      {/* ===== Коагулянт ===== */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <h2>Коагулянт</h2>
          <button type="button" className="btn ghost" style={{ padding: "3px 10px" }} disabled={cat.defaultType === coag} onClick={() => commit({ ...cat, defaultType: coag })}>{cat.defaultType === coag ? `${STAR} тип по умолчанию` : "Сделать тип по умолчанию"}</button>
        </div>
        <Seg name="coag" value={coag} options={TYPES.map((k) => [k, `${cat.defaultType === k ? STAR + " " : ""}${typeLabel(k)}`])} onChange={(tp) => selectType(cat, tp)} />

        <div className="grid2" style={{ marginTop: 16 }}>
          <div>
            <h3>Товарный продукт</h3>
            {products.length ? (
              <select aria-label="Товарный продукт" value={productId} onChange={(e) => { setProductId(e.target.value); setEditProduct(null); }} style={{ width: "100%" }}>
                {products.map((p) => <option key={p.id} value={p.id}>{cat.defaultProduct[coag] === p.id ? STAR + " " : ""}{p.name}{p.manufacturer ? ` · ${p.manufacturer}` : ""}{p.demo ? " (ДЕМО)" : ""}</option>)}
              </select>
            ) : <div className="msg info small">Для {P.label} продуктов нет. Добавьте продукт с паспортными данными.</div>}
            <div className="btns" style={{ marginTop: 8 }}>
              <button type="button" className="btn ghost" onClick={() => setEditProduct(emptyProduct(coag))}>+ Новый</button>
              {product && <button type="button" className="btn ghost" onClick={() => setEditProduct(product)}>Изменить</button>}
              {product && <button type="button" className="btn ghost" onClick={() => setEditProduct({ ...product, id: newId("prod"), name: product.name + " (копия)", demo: false })}>Копия</button>}
              {product && cat.defaultProduct[coag] !== product.id && <button type="button" className="btn ghost" onClick={() => commit({ ...cat, defaultProduct: { ...cat.defaultProduct, [coag]: product.id } })}>{STAR} По умолчанию</button>}
              {product && (confirmDel === product.id
                ? <><button type="button" className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)" }} onClick={() => deleteProduct(product.id)}>Удалить «{product.name}»</button><button type="button" className="btn ghost" onClick={() => setConfirmDel(null)}>Не удалять</button></>
                : <button type="button" className="btn ghost" onClick={() => setConfirmDel(product.id)}>Удалить</button>)}
            </div>
            {product && !editProduct && <ProductSummary p={product} />}
          </div>
          <div>
            <h3>Методика расчёта дозы</h3>
            <select aria-label="Методика" value={methodId} onChange={(e) => { setMethodId(e.target.value); setEditMethod(null); setAccepted(""); }} style={{ width: "100%" }}>
              {(() => {
                const opt = (m: DoseMethod) => <option key={m.id} value={m.id}>{cat.defaultMethod[coag] === m.id ? STAR + " " : ""}{m.name}{m.model === "expression" || m.model === "lookup" ? ` · v${m.version}` : ""}{m.status === "demo" ? " (ДЕМО)" : ""}</option>;
                const b = methods.filter((m) => m.model === "builtin"), u = methods.filter((m) => m.model === "expression" || m.model === "lookup");
                return <>
                  {methods.filter((m) => m.model === "manual").map(opt)}
                  {b.length > 0 && <optgroup label="Нормативные и справочные">{b.map(opt)}</optgroup>}
                  {u.length > 0 && <optgroup label="Мои методики">{u.map(opt)}</optgroup>}
                </>;
              })()}
            </select>
            <div className="btns" style={{ marginTop: 8 }}>
              <button type="button" className="btn ghost" onClick={() => setEditMethod(emptyMethod(coag))}>+ Новая</button>
              {method && !isManual && !builtin && <button type="button" className="btn ghost" onClick={() => setEditMethod(method)}>Изменить</button>}
              {method && !isManual && !builtin && <button type="button" className="btn ghost" onClick={() => setEditMethod({ ...method, id: newId("meth"), name: method.name + " (копия)", version: 1, status: "user" })}>Копия</button>}
              {method && cat.defaultMethod[coag] !== method.id && <button type="button" className="btn ghost" onClick={() => commit({ ...cat, defaultMethod: { ...cat.defaultMethod, [coag]: method.id } })}>{STAR} По умолчанию</button>}
              {method && !isManual && !builtin && (confirmDel === method.id
                ? <><button type="button" className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)" }} onClick={() => deleteMethod(method.id)}>Удалить «{method.name}»</button><button type="button" className="btn ghost" onClick={() => setConfirmDel(null)}>Не удалять</button></>
                : <button type="button" className="btn ghost" onClick={() => setConfirmDel(method.id)}>Удалить</button>)}
            </div>
            <div className="fields" style={{ marginTop: 10 }}>
              <Select id="obj" label="Тип объекта" value={objType} options={OBJECT_TYPES} onChange={(v) => setObjType(v as ObjectType)} />
            </div>
            {objType !== "other" && (rec
              ? <p className="small" style={{ margin: "6px 0 0" }}>Рекомендуемая: {rec.title.split(" — ")[0]}{objType === "vos" && rec.id !== JAR_ID ? " (действующий документ — СП 31.13330.2021: доза по пробной коагуляции)" : ""}{coag === "PACl" && objType === "tes" ? " + пробное коагулирование по ГОСТ Р 51642-2000" : ""}{coag === "PACl" && objType === "vos" ? "; методика РД п. 7.4 — только как предварительная оценка" : ""}. {method?.builtinId !== rec.id && <button type="button" className="linkbtn" onClick={() => { setMethodId(builtinAsMethod(rec, coag).id); setAccepted(""); }}>Выбрать</button>}</p>
              : <p className="small muted" style={{ margin: "6px 0 0" }}>Для {P.label} рекомендуемой встроенной методики для этого типа объекта нет.</p>)}
            {method && !editMethod && (builtin ? <BuiltinCard d={builtin} compact /> : <MethodSummary m={method} t={coag} />)}
          </div>
        </div>
        {editProduct && <ProductEditor key={editProduct.id} initial={editProduct} onSave={saveProduct} onCancel={() => setEditProduct(null)} />}
        {editMethod && <MethodEditor key={editMethod.id} initial={editMethod} onSave={saveMethod} onCancel={() => setEditMethod(null)} />}
      </div>

      <div className="grid2">
        <div className="stack">
          {/* ===== Качество исходной воды ===== */}
          <div className="panel">
            <h2>Качество исходной воды</h2>
            <p className="small muted" style={{ marginTop: 0 }}>{isManual ? "Для ручной дозы показатели не обязательны, но нужны для баланса щёлочности и решения о коррекции pH." : `Методика требует: ${[...neededKeys].filter((k) => k in WATER_PARAMS).map((k) => WATER_PARAMS[k as WaterKey].label).join(", ") || "—"}.`} Пустое поле — нет данных, не ноль.</p>
            <div className="fields">
              {(Object.keys(WATER_PARAMS) as WaterKey[]).filter((k) => ((k !== "o2" && k !== "fe2") || coag === "FeSO4" || neededKeys.has(k)) && (k !== "turbidityMg" || neededKeys.has(k) || (water.turbidityMg ?? "") !== "")).map((k) => (
                <NumField key={k} id={`w-${k}`} label={WATER_PARAMS[k].label} unit={WATER_PARAMS[k].unit} value={water[k] ?? ""} onChange={(v) => setWater((s) => ({ ...s, [k]: v }))} required={neededKeys.has(k)} />
              ))}
            </div>
          </div>

          {/* ===== Расход ===== */}
          <div className="panel">
            <h2>Расход исходной воды</h2>
            {fromUf && <div className="msg info small">Из UF Calc ({new Date(fromUf.at).toLocaleString("ru-RU")}): {fromUf.N} раб. + {fromUf.X} рез. установок, {fromUf.modules} × {nf(fromUf.moduleArea)} м², J = {nf(fromUf.J)} л/(м²·ч); подача при фильтрации {nf(fromUf.feedPerUnit)} м³/ч на установку, всего {nf(fromUf.totalFeed)} м³/ч; Qnet = {nf(fromUf.Qnet, 1)} м³/ч.{flow.mode !== "uf" || toNum(flow.trains) !== fromUf.N || Math.abs((toNum(flow.perTrain) ?? 0) - fromUf.feedPerUnit) > 1e-3 ? " Расход изменён после передачи." : ""}</div>}
            <Seg name="flowmode" value={flow.mode} options={[["coag", "Только коагуляция"], ["uf", "С установками УФ"]]} onChange={upS(setFlow, "mode")} />
            {flow.mode === "coag" ? (
              <div className="fields" style={{ marginTop: 12 }}>
                <NumField id="qn" label="Qном" unit="м³/ч" value={flow.nom} onChange={upS(setFlow, "nom")} required hint="задаётся пользователем" />
                <NumField id="qmin" label="Qmin" unit="м³/ч" value={flow.min} onChange={upS(setFlow, "min")} placeholder="= Qном" hint="необязательно" />
                <NumField id="qmax" label="Qmax" unit="м³/ч" value={flow.max} onChange={upS(setFlow, "max")} placeholder="= Qном" hint="необязательно" />
              </div>
            ) : (
              <div className="fields" style={{ marginTop: 12 }}>
                <NumField id="tr" label="Рабочих установок УФ" unit="шт." value={flow.trains} onChange={upS(setFlow, "trains")} required />
                <NumField id="pt" label="Подача исходной воды на одну установку" unit="м³/ч" value={flow.perTrain} onChange={upS(setFlow, "perTrain")} required hint="из расчёта УФ (ДЕМО)" />
                <NumField id="qmo" label="Qmin вручную" unit="м³/ч" value={flow.minO} onChange={upS(setFlow, "minO")} placeholder="1 установка" />
                <NumField id="qxo" label="Qmax вручную" unit="м³/ч" value={flow.maxO} onChange={upS(setFlow, "maxO")} placeholder="= Qном" />
              </div>
            )}
            <div className="btns">
              <button type="button" className="btn ghost" onClick={() => {
                const uf = flow.mode === "uf", N = uf ? toNum(flow.trains) : null, per = uf ? toNum(flow.perTrain) : null;
                sendToUf({ N, feedPerUnit: per, totalFeed: uf ? (N != null && per != null ? N * per : null) : toNum(flow.nom) });
                router.push("/uf?from=coag");
              }}>Подобрать модули УФ по этой подаче →</button>
            </div>
            <p className="footnote">{flow.mode === "uf" ? "В UF Calc передаются число рабочих установок и подача исходной воды при фильтрации на одну установку." : "В UF Calc передаётся общий расход; подача на установку = Qном / N (N задаётся в UF Calc)."}</p>
          </div>

          {/* ===== Доза ===== */}
          <div className="panel">
            <h2>Доза коагулянта</h2>
            {isManual ? (
              <div className="fields">
                <Select id="db" label="База дозы" value={manualDose.basis as Basis} options={P.bases.map((b) => [b, basisLabel(coag, b, product?.hydrateN)])} onChange={upS(setManualDose, "basis")} />
                <NumField id="dmin" label="Dmin" unit="мг/л" value={manualDose.min} onChange={upS(setManualDose, "min")} required />
                <NumField id="dnom" label="Dном (расчётная)" unit="мг/л" value={manualDose.nom} onChange={upS(setManualDose, "nom")} required />
                <NumField id="dmax" label="Dmax" unit="мг/л" value={manualDose.max} onChange={upS(setManualDose, "max")} required />
              </div>
            ) : (
              <>
                <p className="small" style={{ marginTop: 0 }}>{builtin ? <>Доза рассчитывается по методике «{builtin.title.split(" — ")[0]}» ({STATUS_LABEL[builtin.status].toLowerCase()}). Результат — расчётная доза, не окончательная проектная: уточняется пробной коагуляцией и при наладке.</> : <>Доза рассчитывается по методике «{method!.name}» из качества воды{method!.inputs.some((i) => !(i.key in WATER_PARAMS)) ? " и данных продукта" : ""}. Результат — предварительная оценка, не подтверждённый оптимум.</>}</p>
                <div className="fields">
                  {builtin && builtin.options.filter((o) => !o.types || o.types.includes(coag)).filter((o) => !(builtin.id.startsWith("snip") && o.key === "bound" && opts.mode === "color")).map((o) => o.kind === "select"
                    ? <Select key={o.key} id={`bo-${o.key}`} label={o.label} value={opts[o.key]} options={o.choices!} onChange={setOpt(o.key)} />
                    : <NumField key={o.key} id={`bo-${o.key}`} label={o.label} unit={o.unit} value={opts[o.key] ?? ""} onChange={setOpt(o.key)} hint={o.hint} />)}
                  <NumField id="acc" label={`Принятая доза, мг/л ${basisLabel(coag, method!.outputBasis)}`} value={accepted} onChange={setAccepted} placeholder="= центральная оценка" hint="необязательно: своя доза вместо центральной оценки" />
                </div>
              </>
            )}
          </div>

          {builtin?.id === JAR_ID && (
            <JarPanel cat={cat} coag={coag} productName={product?.name ?? ""} cPct={al2o3Pct(product, coag)}
              source={Object.fromEntries((["turbidityMg", "color", "permanganate", "al", "fe", "pH", "alkalinity"] as const).map((k) => [k, toNum(water[k] ?? "")]))} onCommit={commit} />
          )}

          {/* ===== Коррекция pH ===== */}
          <div className="panel">
            <h2>Коррекция pH</h2>
            <Seg name="phm" value={ph.mode as "none"} options={[["none", "Без коррекции"], ["acid", "Кислота"], ["base", "Щёлочь"], ["unknown", "Недостаточно данных"]]} onChange={upS(setPh, "mode")} />
            <p className="footnote">Решение о необходимости коррекции показывается в результатах по рабочему диапазону pH методики и балансу щёлочности. Доза реагента — ручная или по титрационной кривой.</p>
            {(ph.mode === "acid" || ph.mode === "base") && (
              <div className="fields" style={{ marginTop: 12 }}>
                <Select id="phr" label="Реагент" value={ph.reagent as "NaOH"} options={ph.mode === "acid" ? [["HCl", "HCl"], ["H2SO4", "H₂SO₄"]] : [["NaOH", "NaOH"]]} onChange={upS(setPh, "reagent")} />
                <Select id="phmeth" label="Способ дозы" value={ph.method as "manual"} options={[["manual", "заданная доза 100 %"], ["curve", "титрационная кривая (ДЕМО)"]]} onChange={upS(setPh, "method")} />
                {ph.method === "manual" ? <NumField id="phd" label="Доза 100 % вещества" unit="мг/л" value={ph.d100} onChange={upS(setPh, "d100")} required /> : <NumField id="pht" label="Целевой pH" value={ph.target} onChange={upS(setPh, "target")} hint="кривая ДЕМО: pH 7,1–7,95" />}
                <NumField id="phw" label="Массовая доля в товарном" unit="доля" value={ph.w} onChange={upS(setPh, "w")} />
                <NumField id="phrho" label="Плотность товарного" unit="кг/л" value={ph.rho} onChange={upS(setPh, "rho")} />
                <NumField id="phwc" label="Рабочий раствор по 100 %" unit="г/л" value={ph.wc} onChange={upS(setPh, "wc")} />
              </div>
            )}
            {coag === "FeSO4" && (
              <div className="fields" style={{ marginTop: 12 }}>
                <Select id="ox" label="Статус проверки окисления Fe²⁺" value={ox} options={[["auto", "по наличию данных"], ["required", "требуется проверка"], ["test", "подтверждено испытанием"]]} onChange={setOx} />
              </div>
            )}
          </div>

          {/* ===== Оборудование ===== */}
          <div className="panel">
            <h2>Камеры, труба, насосы</h2>
            <Seg name="cc" value={contact.calc as "timeToVolume"} options={[["timeToVolume", "время → объём"], ["volumeToTime", "объём → время"]]} onChange={upS(setContact, "calc")} />
            <div className="fields" style={{ marginTop: 12 }}>
              <Select id="cfb" label="Расход подбора камер" value={contact.flowBasis as "max"} options={[["max", "Qmax"], ["nom", "Qном"], ["min", "Qmin"]]} onChange={upS(setContact, "flowBasis")} />
              {contact.calc === "timeToVolume" ? <NumField id="ct" label="Контактное время" unit="с" value={contact.time} onChange={upS(setContact, "time")} required hint="ДЕМО; без значения по умолчанию" /> : <NumField id="cv" label="Эффективный объём камеры" unit="м³" value={contact.volume} onChange={upS(setContact, "volume")} required />}
              <TextField id="ctb" label="Основание контактного времени" value={contact.timeBasis} onChange={upS(setContact, "timeBasis")} />
              <NumField id="ck" label="k использования объёма" value={contact.k} onChange={upS(setContact, "k")} placeholder="не применяется" />
              <Select id="pfb" label="Расход для трубы" value={pipe.flowBasis as "max"} options={[["max", "Qmax"], ["nom", "Qном"], ["min", "Qmin"]]} onChange={upS(setPipe, "flowBasis")} />
              <NumField id="pv" label="Расчётная скорость" unit="м/с" value={pipe.v} onChange={upS(setPipe, "v")} required hint="ДЕМО" />
              <NumField id="pdin" label="Факт. dвн выбранного типоразмера" unit="мм" value={pipe.din} onChange={upS(setPipe, "din")} />
              <NumField id="pup" label="Давление в точке ввода" unit="бар изб." value={pumps.p} onChange={upS(setPumps, "p")} />
              <NumField id="pudp" label="Доп. потери" unit="бар" value={pumps.dp} onChange={upS(setPumps, "dp")} />
              <NumField id="pum" label="Проектный запас подачи" unit="%" value={pumps.margin} onChange={upS(setPumps, "margin")} placeholder="не задан" />
            </div>
          </div>
          <div className="btns"><button className="btn" type="button" onClick={run} disabled={busy || !product}>{busy ? "Расчёт…" : "Рассчитать"}</button>{!product && <span className="small muted">Выберите или добавьте товарный продукт.</span>}</div>
        </div>

        <div className="stack">{err ? <div className="msg bad">{err}</div> : res ? <><Results r={res} coag={coag} /><div className="panel"><h2>Сохранение</h2><SaveCalc me={me} kind="coagulation" input={lastInput} result={res} engine={(res as { engine?: string }).engine ?? "coag-core"} defaultTitle={`Коагуляция · ${typeLabel(coag)}${product ? " · " + product.name : ""}`} returnTo="/coagulation" /></div></> : <div className="panel muted">Нажмите «Рассчитать».</div>}</div>
      </div>
    </div>
  );
}

function ProductSummary({ p }: { p: Product }) {
  const e = productErrors(p);
  return (
    <dl className="kv small" style={{ marginTop: 10 }}>
      <dt>Производитель / марка</dt><dd>{p.manufacturer || "—"} / {p.grade || "—"}</dd>
      <dt>Концентрация</dt><dd>{p.concentration != null && p.concentrationBasis ? `${fmt(p.concentration)} % по ${basisLabel(p.coagulantType, p.concentrationBasis, p.hydrateN)}` : "не задана"}</dd>
      <dt>Плотность</dt><dd>{p.form === "solid" ? "твёрдый" : p.density != null ? `${fmt(p.density)} кг/л` : "не задана"}</dd>
      {PROFILES[p.coagulantType].usesBasicity && <><dt>Основность</dt><dd>{p.basicity != null ? `${fmt(p.basicity)} %` : "—"}</dd></>}
      <dt>Рабочий раствор</dt><dd>{p.workingConcentration != null && p.workingBasis ? `${fmt(p.workingConcentration)} г/л по ${basisLabel(p.coagulantType, p.workingBasis, p.hydrateN)}` : "не задан"}</dd>
      {e.length > 0 && <><dt>Проверка</dt><dd style={{ color: "var(--warn)" }}>{e.length} замеч.</dd></>}
    </dl>
  );
}

function MethodSummary({ m, t: tp }: { m: DoseMethod; t: CoagulantType }) {
  if (m.model === "manual") return <p className="small muted" style={{ marginTop: 10 }}>Доза задаётся пользователем: Dmin, Dном, Dmax с базой. Всегда доступна.</p>;
  return (
    <dl className="kv small" style={{ marginTop: 10 }}>
      <dt>Модель</dt><dd>{m.model === "expression" ? `D = ${m.expression}` : `таблица по «${m.lookup?.key}», ${m.lookup?.rows.length ?? 0} строк`}</dd>
      <dt>Результат</dt><dd>мг/л {basisLabel(tp, m.outputBasis)}</dd>
      <dt>Входы</dt><dd>{m.inputs.map((i) => i.key).join(", ")}</dd>
      <dt>Рабочий pH</dt><dd>{m.phWindow?.min != null && m.phWindow?.max != null ? `${fmt(m.phWindow.min, 2)}–${fmt(m.phWindow.max, 2)}` : "не задан"}</dd>
      <dt>Основание</dt><dd style={{ textAlign: "right", fontFamily: "var(--f-body)" }}>{m.source}</dd>
    </dl>
  );
}

const NEED: Record<string, [string, string]> = {
  none: ["s-balance", "Коррекция pH не требуется по критерию методики"],
  acid: ["s-clarify", "Требуется подкисление"],
  base: ["s-clarify", "Требуется подщелачивание"],
  unknown: ["s-nodata", "Необходимость коррекции не определена"],
};

function Results({ r, coag }: { r: CoagResult; coag: CoagulantType }) {
  const P = PROFILES[coag];
  const QL: Record<string, string> = { min: "Qmin", nom: "Qном", max: "Qmax" };
  const m = r.method;
  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Результаты</h2><StatusPill status={r.status} />
        </div>
        {m && m.status === "ok" && (
          <div className="cards" style={{ marginTop: 12 }}>
            <div className="kcard"><div className="k">ДИАПАЗОН МЕТОДИКИ</div><div className="v" style={{ fontSize: 20 }}>{fmt(m.low)}…{fmt(m.high)}</div><div className="u">мг/л {basisLabel(coag, m.basis)}</div></div>
            <div className="kcard"><div className="k">ЦЕНТРАЛЬНАЯ ОЦЕНКА</div><div className="v" style={{ fontSize: 20 }}>{fmt(m.central)}</div><div className="u">{Number.isFinite(m.central) ? `мг/л ${basisLabel(coag, m.basis)}` : "методика не задаёт"}</div></div>
            <div className="kcard" style={{ borderColor: "var(--accent)" }}><div className="k">ПРИНЯТАЯ ДОЗА</div><div className="v" style={{ fontSize: 20 }}>{fmt(r.doseInput.nom ?? NaN)}</div><div className="u">мг/л {basisLabel(coag, m.basis)}</div></div>
            <div className="kcard"><div className="k">ДОЗА ДЛЯ МАКС. ПОДАЧИ НАСОСА</div><div className="v" style={{ fontSize: 20 }}>{fmt(r.doseInput.max ?? NaN)}</div><div className="u">мг/л · max(верх; принятая)</div></div>
          </div>
        )}
        {m && m.status !== "ok" && (
          <div className="msg bad" style={{ marginTop: 12 }}>
            <b>{m.status === "nodata" ? "Недостаточно данных для методики." : m.status === "outside" ? "Вне области применимости методики." : "Методика некорректна."}</b>{" "}
            {m.status === "nodata" ? `Заполните: ${m.missing.join(", ")}.` : m.status === "outside" ? m.outside.join("; ") + "." : m.errors.join(" ")} Доза по методике не выдаётся; можно выбрать «Доза задаётся пользователем».
          </div>
        )}
        <p className="footnote">Ядро {r.engine}. Пересчёты — материальный баланс.</p>
        {r.flowOk && Number.isFinite(r.doseMetal.nom) && (
          <div className="tw"><table><thead><tr><th></th>{r.product.map((f) => <th key={f.k} className="n">{QL[f.k]}</th>)}</tr></thead><tbody>
            <tr><td>Q, м³/ч</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.q, 1)}</td>)}</tr>
            <tr><td>Доза Dном <span className="basis">мг/л {P.metal}</span></td>{r.product.map((f) => <td key={f.k} className="n">{fmt(r.doseMetal.nom)}</td>)}</tr>
            <tr><td>Доза товарного продукта, мг/л</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.Dp)}</td>)}</tr>
            <tr><td>{P.metal} (100 %), кг/ч</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.Mme)}</td>)}</tr>
            <tr><td>Товарный продукт, кг/ч</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.Mp)}</td>)}</tr>
            <tr><td>Товарный продукт, л/ч</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.Lp)}</td>)}</tr>
            <tr><td>Рабочий раствор, л/ч</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.Lw)}</td>)}</tr>
          </tbody></table></div>
        )}
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}><h3 style={{ margin: 0 }}>Коррекция pH</h3><span className={`pill ${NEED[r.phNeed.need][0]}`}>{NEED[r.phNeed.need][1]}</span></div>
        <ul className="small" style={{ margin: "10px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>{r.phNeed.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <dl className="kv" style={{ marginTop: 10 }}><dt>Теоретический расход щёлочности при Dном / Dmax</dt><dd>{fmt(r.alkalinity.atNom)} / {fmt(r.alkalinity.atMax)} мг-экв/л</dd><dt>Щёлочность воды</dt><dd>{fmt(r.alkalinity.water)} мг-экв/л</dd></dl>
      </div>

      {Number.isFinite(r.doseMetal.nom) && (
        <div className="panel">
          <h3>Пересчёт дозы по базам</h3>
          <div className="tw"><table><thead><tr><th>База</th><th className="n">Dmin</th><th className="n">Dном</th><th className="n">Dmax</th></tr></thead><tbody>
            {r.conversion.map((c) => <tr key={c.basis}><td><span className="basis">мг/л {c.basis}</span></td><td className="n">{fmt(c.min)}</td><td className="n">{fmt(c.nom)}</td><td className="n">{fmt(c.max)}</td></tr>)}
          </tbody></table></div>
        </div>
      )}

      {Number.isFinite(r.doseMetal.nom) && (
        <div className="panel">
          <h3>Оборудование</h3>
          <dl className="kv">
            <dt>CT-101/102: Vэфф одной камеры ({QL[r.chambers.flowBasis]})</dt><dd>{fmt(r.chambers.Veff)} м³</dd>
            <dt>Vгеом одной / двух камер</dt><dd>{fmt(r.chambers.Vgeom)} / {fmt(2 * r.chambers.Vgeom)} м³</dd>
            <dt>Время при Qmin / Qном / Qmax</dt><dd>{r.chambers.times.map((x) => fmt(x.t, 0)).join(" / ")} с</dd>
            <dt>L-101: dвн расчётный ({QL[r.pipe.flowBasis]})</dt><dd>{fmt(r.pipe.dCalcMm, 1)} мм</dd>
            <dt>Скорость при Qmin / Qном / Qmax</dt><dd>{r.pipe.actualMm ? r.pipe.velocities.map((x) => fmt(x.v, 2)).join(" / ") + " м/с" : "нужен факт. dвн"}</dd>
          </dl>
          <div className="tw" style={{ marginTop: 10 }}><table><thead><tr><th>Позиция</th><th className="n">qmin, л/ч</th><th className="n">qном</th><th className="n">qmax</th><th className="n">Кратн.</th><th className="n">P, бар</th></tr></thead><tbody>
            {r.pumps.map((p) => <tr key={p.tag}><td><span className="tag">{p.tag}</span><div className="small muted">{p.name}</div></td><td className="n">{fmt(p.qmin)}</td><td className="n">{fmt(p.qnom)}</td><td className="n">{fmt(p.qmax)}</td><td className="n">{Number.isFinite(p.turndown) ? `1:${fmt(p.turndown, 1)}` : "—"}</td><td className="n">≥ {fmt(p.pressureBar, 1)}</td></tr>)}
          </tbody></table></div>
          <p className="footnote">Требуемые характеристики, а не выбор насоса. qmin = q(Dmin, Qmin), qmax = q(Dmax, Qmax).</p>
        </div>
      )}

      {r.feso4 && <div className="panel"><h3>FeSO₄: окисление Fe²⁺</h3><dl className="kv"><dt>Стехиометрическая потребность O₂ при Dmax</dt><dd>{fmt(r.feso4.o2Need)} мг/л</dd><dt>Растворённый O₂</dt><dd>{fmt(r.feso4.o2)} мг/л</dd><dt>Статус проверки</dt><dd>{{ unchecked: "не проверено", required: "требуется проверка", method: "подтверждено методикой", test: "подтверждено испытанием" }[r.feso4.status]}</dd></dl>{r.feso4.missing.length > 0 && <div className="msg warn small">Не хватает: {r.feso4.missing.join(", ")}.</div>}</div>}

      <div className="panel"><h3>Предупреждения</h3><Messages items={r.warnings} /></div>
      <div className="panel"><h3>Допущения</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul><div className="msg warn small">{r.qualityNote}</div></div>

      <div className="panel"><h3>Протокол расчёта</h3>
        {r.trace.map((s) => <section key={s.stage} className="tstage"><header><b>{s.stage === "IN" ? "ВХОД" : `ЭТАП ${s.stage}`}</b><span>{s.title}</span></header>
          {s.rows.map((x, i) => <div key={i} className="trow"><div>{x.label}</div><div className="sub">{x.formula}</div><div className="res">{x.result}</div></div>)}</section>)}
      </div>
    </>
  );
}
