# Oboe starter

This starter is copied by `create-oboe-app`.

Add `@oboe/core`, `@oboe/http`, `@oboe/graphql`, `@oboe/admin-next`, one of
`@oboe/db-postgres` / `@oboe/db-mysql` / `@oboe/db-sqlite`, and `@oboe/cli`.

Keep `oboe.config.ts` as the only schema source of truth, then use:

```bash
pnpm exec oboe migrate:generate --dialect postgres --config ./oboe.config.ts
pnpm exec oboe migrate --dialect postgres --config ./oboe.config.ts --url "$DATABASE_URL"
```
