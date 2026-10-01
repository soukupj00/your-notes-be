// Setup file of the `pglite` Vitest project, whose every test file uses PGlite: boots the file's
// PGlite before its first test, so tests time only themselves. A boot takes about a second
// alone, and three to four while the other test files boot theirs.
import { beforeAll } from 'vitest';
import { pgliteTestStore } from '../infra/postgres/testing.ts';

beforeAll(async () => {
  await pgliteTestStore();
});
