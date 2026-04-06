import { createOboeRuntime } from "./runtime.js";
import type {
  DatabaseAdapter,
  EventBus,
  JobDispatcher,
  OboeConfig,
  OboeRuntime,
} from "./types.js";

export async function getOboe(args: {
  config: OboeConfig;
  db: DatabaseAdapter;
  events?: EventBus;
  jobs?: JobDispatcher;
}): Promise<OboeRuntime> {
  const oboe = createOboeRuntime(args);
  await oboe.initialize();
  return oboe;
}
