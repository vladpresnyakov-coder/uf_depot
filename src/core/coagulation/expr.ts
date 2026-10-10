/**
 * Безопасный разбор и вычисление выражений методик (без eval).
 * Поддержка: числа, переменные, + − * / ^, скобки, min max sqrt ln exp abs.
 */
type Node =
  | { n: number }
  | { v: string }
  | { f: string; args: Node[] }
  | { o: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { o: "neg"; a: Node };

const FN: Record<string, (...x: number[]) => number> = {
  min: Math.min, max: Math.max, sqrt: Math.sqrt, ln: Math.log, exp: Math.exp, abs: Math.abs,
};

type Tok = { t: "n"; v: number } | { t: "id"; v: string } | { t: "+" | "-" | "*" | "/" | "^" | "(" | ")" | "," };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.eE]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`Некорректное число «${s.slice(i, j)}»`);
      out.push({ t: "n", v }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      out.push({ t: "id", v: s.slice(i, j) }); i = j; continue;
    }
    if ("+-*/^(),".includes(c)) { out.push({ t: c as "+" }); i++; continue; }
    throw new Error(`Недопустимый символ «${c}»`);
  }
  return out;
}

export function parse(src: string): Node {
  const t = tokenize(src);
  let p = 0;
  const peek = () => t[p];
  const eat = (k: string) => { if (!t[p] || t[p].t !== k) throw new Error(`Ожидалось «${k}»`); return t[p++]; };
  const E = (): Node => { let n = T(); while (peek() && (peek().t === "+" || peek().t === "-")) { const o = t[p++].t as "+" | "-"; n = { o, a: n, b: T() }; } return n; };
  const T = (): Node => { let n = F(); while (peek() && (peek().t === "*" || peek().t === "/")) { const o = t[p++].t as "*" | "/"; n = { o, a: n, b: F() }; } return n; };
  const F = (): Node => { const n = U(); if (peek() && peek().t === "^") { p++; return { o: "^", a: n, b: F() }; } return n; };
  const U = (): Node => { if (peek() && peek().t === "-") { p++; return { o: "neg", a: U() }; } return P(); };
  const P = (): Node => {
    const k = peek();
    if (!k) throw new Error("Неожиданный конец выражения");
    if (k.t === "n") { p++; return { n: k.v }; }
    if (k.t === "id") {
      p++;
      if (peek() && peek().t === "(") {
        p++;
        const args = [E()];
        while (peek() && peek().t === ",") { p++; args.push(E()); }
        eat(")");
        if (!FN[k.v]) throw new Error(`Неизвестная функция ${k.v}`);
        return { f: k.v, args };
      }
      return { v: k.v };
    }
    if (k.t === "(") { p++; const n = E(); eat(")"); return n; }
    throw new Error("Неожиданный символ");
  };
  const ast = E();
  if (p < t.length) throw new Error("Лишние символы в конце выражения");
  return ast;
}

export function evaluate(n: Node, vars: Record<string, number>): number {
  if ("n" in n) return n.n;
  if ("v" in n) { if (!(n.v in vars)) throw new Error(`Не задана переменная ${n.v}`); return vars[n.v]; }
  if ("f" in n) return FN[n.f](...n.args.map((a) => evaluate(a, vars)));
  const a = evaluate(n.a, vars);
  if (n.o === "neg") return -a;
  const b = evaluate(n.b, vars);
  switch (n.o) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return a / b;
    case "^": return Math.pow(a, b);
  }
}

export function identifiers(n: Node, acc = new Set<string>()): Set<string> {
  if ("v" in n) acc.add(n.v);
  if ("f" in n) n.args.forEach((x) => identifiers(x, acc));
  if ("a" in n) identifiers(n.a, acc);
  if ("b" in n) identifiers(n.b, acc);
  return acc;
}
