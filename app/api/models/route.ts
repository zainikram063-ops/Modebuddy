import { liveModels } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await liveModels());
}
