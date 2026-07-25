type StorageWriter = {
  getItem?(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function getStorageItem(
  storage: StorageWriter | null | undefined,
  key: string,
) {
  if (!storage?.getItem || !key) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function setStorageJson(
  storage: StorageWriter | null | undefined,
  key: string,
  value: unknown,
) {
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStorageItem(
  storage: StorageWriter | null | undefined,
  key: string,
) {
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
