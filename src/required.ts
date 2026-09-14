/** Return a required value, failing at the missing value rather than a later access. */
export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error("Expected a value");
  return value;
}
