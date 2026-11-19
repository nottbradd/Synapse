let depth = 0,
  until = 0;
export const returnSuppressed = () => depth > 0 || performance.now() < until;
export function suppressReturn(milliseconds = 1000) {
  until = Math.max(until, performance.now() + Math.min(milliseconds, 1500));
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("synapse-decoration-suppressed"));
}
export async function withNativeDialog<T>(
  operation: () => Promise<T>,
): Promise<T> {
  depth++;
  suppressReturn();
  try {
    return await operation();
  } finally {
    depth--;
    suppressReturn(1200);
  }
}
