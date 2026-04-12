import type { SendEmailOptions } from "../types.js";

export function normalizeEmailMessage(args: {
  defaultFromAddress: string;
  defaultFromName: string;
  message: SendEmailOptions;
}): SendEmailOptions {
  if (args.message.from) {
    return args.message;
  }

  return {
    ...args.message,
    from: {
      address: args.defaultFromAddress,
      name: args.defaultFromName,
    },
  };
}
