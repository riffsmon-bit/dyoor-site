"use client";

export const DYOOR_WORLD_SESSION_EXPIRED_EVENT = "dyoor-world:session-expired";

export class DyoorWorldRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DyoorWorldRequestError";
    this.status = status;
  }
}

export async function readDyoorWorldResponse<T>(
  response: Response,
  fallbackMessage = "dYOOR World request failed.",
): Promise<T> {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event(DYOOR_WORLD_SESSION_EXPIRED_EVENT));
    }
    throw new DyoorWorldRequestError(
      typeof data.error === "string" && data.error.trim()
        ? data.error
        : fallbackMessage,
      response.status,
    );
  }
  return data as T;
}

export function isDyoorWorldAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
