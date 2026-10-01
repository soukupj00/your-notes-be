import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infra/postgres/schema.ts',
  out: './drizzle/postgres',
});
