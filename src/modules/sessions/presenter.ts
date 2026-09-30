import type { DevicesResponse, SessionResponse } from '../../contract/index.ts';
import { hal, link } from '../../http/hal.ts';
import type { DeviceRow, SessionAccount, SessionDevice } from './service.ts';

export function sessionBody(account: SessionAccount, device: SessionDevice): SessionResponse {
  return hal(
    { account, device },
    {
      self: link('/api/session'),
      devices: link('/api/devices'),
      codes: link('/api/codes'),
      changes: link('/api/changes'),
      blobs: link('/api/blobs/{id}', { templated: true }),
      shares: link('/api/shares'),
    }
  );
}

export function devicesBody(rows: DeviceRow[], currentId: string): DevicesResponse {
  const devices = rows.map((row) =>
    hal(
      {
        id: row.id,
        name: row.deviceName,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        current: row.id === currentId,
      },
      { self: link(`/api/devices/${row.id}`) }
    )
  );
  return hal({}, { self: link('/api/devices') }, { devices });
}
