import { authConfigured, currentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  return Response.json({ user, authConfigured: authConfigured() }, { headers: { "cache-control": "no-store" } });
}
