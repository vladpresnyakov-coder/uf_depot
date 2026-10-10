import { COAG_ENGINE_VERSION } from "@/core/coagulation/calculate";
import { UF_ENGINE_VERSION } from "@/core/uf/engine";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", app: "uf-depot", version: "0.1.0", engines: [COAG_ENGINE_VERSION, UF_ENGINE_VERSION], time: new Date().toISOString() });
}
