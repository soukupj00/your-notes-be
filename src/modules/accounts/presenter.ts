import type { Account, AccountsResponse } from '../../contract/index.ts';
import { hal, link } from '../../http/hal.ts';
import type { AccountRow } from './service.ts';

export function accountBody(row: AccountRow): Account {
  return hal(row, {
    self: link(`/api/accounts/${row.id}`),
    password: link(`/api/accounts/${row.id}/password`),
  });
}

export function accountsBody(rows: AccountRow[]): AccountsResponse {
  return hal({}, { self: link('/api/accounts') }, { accounts: rows.map(accountBody) });
}
