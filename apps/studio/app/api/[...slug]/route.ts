import { getStudioRuntime } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const { httpHandler } = await getStudioRuntime();
  return httpHandler(request);
}

export const DELETE = handle;
export const GET = handle;
export const PATCH = handle;
export const POST = handle;
export const PUT = handle;
