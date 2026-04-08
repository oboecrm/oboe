import { getStudioRuntime } from "./lib/runtime";
import type { CollectionInputs } from "./oboe-types.generated";

async function assertStudioTypes() {
  const { runtime } = await getStudioRuntime();
  const contacts = await runtime.find({
    collection: "contacts",
  });
  const contact = contacts.docs[0];
  const createInput: CollectionInputs["contacts"] = {
    name: "Ada Lovelace",
  };
  const dealUpdate = {
    stage: "won",
  } satisfies Partial<CollectionInputs["deals"]>;

  const email: string | undefined = contact?.email;

  await runtime.create({
    collection: "contacts",
    data: createInput,
  });
  await runtime.update({
    collection: "deals",
    data: dealUpdate,
    id: "deal-1",
  });

  const invalidStage: CollectionInputs["deals"] = {
    name: "Broken",
    // @ts-expect-error "closed" is not a valid deals.stage option.
    stage: "closed",
  };

  // @ts-expect-error Contacts documents do not expose a stage field.
  const stage = contact?.stage;

  return {
    email,
    invalidStage,
    stage,
  };
}

void assertStudioTypes;
