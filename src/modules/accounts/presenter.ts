import type { Account, AccountsResponse } from '../../contract/index.ts';
import { hal, link } from '../../http/hal.ts';
import type { AccountRecord } from '../../store/records.ts';

export function accountBody(account: AccountRecord): Account {
  return hal(account, {
    self: link(`/api/accounts/${account.id}`),
    password: link(`/api/accounts/${account.id}/password`),
  });
}

export function accountsBody(accounts: AccountRecord[]): AccountsResponse {
  return hal({}, { self: link('/api/accounts') }, { accounts: accounts.map(accountBody) });
}
