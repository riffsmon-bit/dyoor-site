export function hasFlag(name: string) {
  return process.argv.includes(name);
}

export function argValue(name: string, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return String(process.argv[index + 1] || fallback);
}

export function positiveIntegerArg(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(argValue(name), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function envValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function printReadOnlyBanner(task: string) {
  console.log(`[read-only] ${task}`);
  console.log("No transactions, metadata writes, Blob writes, or deployments are available in this tool.");
}
