import { getStudioRuntime } from "../../lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { graphqlHandler } = await getStudioRuntime();
  return graphqlHandler(request);
}
