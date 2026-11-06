import { defineConfig } from 'drizzle-kit';

// Generate migrations after changing src/db/schema.ts:
//   pnpm --filter @conbert/server db:generate
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
