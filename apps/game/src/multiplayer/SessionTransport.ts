export type SessionEvent = {
  type: string;
  payload: unknown;
};

export type SessionTransport = {
  readonly authoritative: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(event: SessionEvent): Promise<void>;
  subscribe(listener: (event: SessionEvent) => void): () => void;
};

export class LocalSessionTransport implements SessionTransport {
  readonly authoritative = false;
  private readonly listeners = new Set<(event: SessionEvent) => void>();

  async connect() {}

  async disconnect() {
    this.listeners.clear();
  }

  async send(event: SessionEvent) {
    for (const listener of this.listeners) listener(structuredClone(event));
  }

  subscribe(listener: (event: SessionEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
