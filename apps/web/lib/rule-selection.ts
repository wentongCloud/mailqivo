/** Toggle one value without discarding the other selections in the rule. */
export function toggleRuleSelection(
  values: readonly string[],
  value: string,
  checked: boolean,
  limit: number
): string[] {
  const current = [...new Set(values)];
  if (!checked) return current.filter((item) => item !== value);
  if (current.includes(value) || current.length >= limit) return current;
  return [...current, value];
}
