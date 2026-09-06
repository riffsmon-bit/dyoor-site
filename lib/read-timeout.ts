// Bound optional or remote reads without turning a timeout into a zero balance.
export async function withReadTimeout<T>(read: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Read temporarily unavailable.")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
