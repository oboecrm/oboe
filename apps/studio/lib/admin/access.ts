export function withAdminAccess<TArgs extends Record<string, unknown>>(
  args: TArgs
): TArgs & { overrideAccess: true } {
  return {
    ...args,
    overrideAccess: true,
  };
}
