import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/infra/sqlite/schema.ts',
  out: './drizzle/sqlite',
});
