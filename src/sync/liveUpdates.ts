type Client = { send(seq: number): void; close(): void };

/** The open Live Update streams, one per Device; in process, as the server is one instance (ADR 0006). */
export class LiveUpdates {
  readonly #accounts = new Map<string, Map<string, Client>>();

  /** Ends any earlier stream of the same Device; returns the unsubscribe. */
  add(accountId: string, deviceId: string, client: Client): () => void {
    const devices = this.#accounts.get(accountId) ?? new Map<string, Client>();
    this.#accounts.set(accountId, devices);
    devices.get(deviceId)?.close();
    devices.set(deviceId, client);
    return () => {
      if (devices.get(deviceId) === client) devices.delete(deviceId);
      if (devices.size === 0 && this.#accounts.get(accountId) === devices) {
        this.#accounts.delete(accountId);
      }
    };
  }

  notify(accountId: string, seq: number, exceptDeviceId?: string): void {
    for (const [deviceId, client] of this.#accounts.get(accountId) ?? []) {
      if (deviceId !== exceptDeviceId) client.send(seq);
    }
  }

  closeAll(): void {
    for (const devices of this.#accounts.values())
      for (const client of devices.values()) client.close();
  }
}
