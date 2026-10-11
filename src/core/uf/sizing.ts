/**
 * Подбор числа модулей в установке по подаче исходной воды при фильтрации и J (режим B).
 * Подача при фильтрации на установку: Q1 = J · m · a / 1000, м³/ч.
 * Расчётное m = Q1·1000 / (J·a); принимается ⌈m⌉ или значение пользователя (вторая итерация).
 * При принятом m сохраняется либо подача насоса (J пересчитывается), либо J (подача пересчитывается).
 * Собственные нужды (FF, BW, CEB) зависят от площади установки и J, поэтому баланс считается заново.
 */
export type Keep = "feed" | "J";

export interface SizingInput { feedPerUnit: number; J: number; moduleArea: number; modules?: number | null; keep: Keep }
export interface SizingResult {
  mCalc: number;
  mAuto: number;
  m: number;
  userModules: boolean;
  keep: Keep;
  J: number;
  feedPerUnit: number;
  notes: string[];
}

export function sizeModules(s: SizingInput): SizingResult {
  const notes: string[] = [];
  const mCalc = (s.feedPerUnit * 1000) / (s.J * s.moduleArea);
  const mAuto = Math.max(1, Math.ceil(mCalc - 1e-9));
  const user = s.modules != null && Number.isInteger(s.modules) && s.modules > 0;
  const m = user ? (s.modules as number) : mAuto;
  let J = s.J, feed = s.feedPerUnit;
  if (s.keep === "feed") {
    J = (feed * 1000) / (m * s.moduleArea);
    notes.push(`Подача насоса сохранена ${feed} м³/ч; J пересчитан под ${m} модулей.`);
  } else {
    feed = (J * m * s.moduleArea) / 1000;
    notes.push(`J сохранён ${J} л/(м²·ч); подача на установку пересчитана под ${m} модулей.`);
  }
  if (user && m !== mAuto) notes.push(`Число модулей изменено пользователем: ${m} вместо ${mAuto} (расчётное ${mCalc.toFixed(2)}).`);
  if (user && m < mCalc) notes.push("Принято меньше модулей, чем расчётное число: J выше заданного.");
  return { mCalc, mAuto, m, userModules: user, keep: s.keep, J, feedPerUnit: feed, notes };
}
