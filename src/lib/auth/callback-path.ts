const DEFAULT_CALLBACK_PATH = "/client";
const CALLBACK_BASE = "https://callback.invalid";

/** Return a same-origin absolute path or a safe application default. */
export function normalizeCallbackPath(value: string | null): string {
  let decoded = value;
  try {
    for (let pass = 0; decoded && pass < 3; pass += 1) {
      const nextDecoded = decodeURIComponent(decoded);
      if (nextDecoded === decoded) break;
      decoded = nextDecoded;
    }
  } catch {
    return DEFAULT_CALLBACK_PATH;
  }

  if (
    !value ||
    !decoded ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(decoded)
  ) {
    return DEFAULT_CALLBACK_PATH;
  }

  try {
    const parsed = new URL(value, CALLBACK_BASE);
    if (parsed.origin !== CALLBACK_BASE) {
      return DEFAULT_CALLBACK_PATH;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_CALLBACK_PATH;
  }
}
