import type { DevicesResponse, SessionResponse } from '../../contract/index.ts';
import { hal, link } from '../../http/hal.ts';
import type { SessionRecord } from '../../store/records.ts';
import type { SessionAccount } from '../accounts/service.ts';
import type { SessionDevice } from './service.ts';

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

export function devicesBody(sessions: SessionRecord[], currentId: string): DevicesResponse {
  const devices = sessions.map((session) =>
    hal(
      {
        id: session.id,
        name: session.deviceName,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        current: session.id === currentId,
      },
      { self: link(`/api/devices/${session.id}`) }
    )
  );
  return hal({}, { self: link('/api/devices') }, { devices });
}
