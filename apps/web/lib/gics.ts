import { canonicalIndustry, GICS_INDUSTRIES } from "@mailqivo/shared";

export function industryOptions(label: (key: (typeof GICS_INDUSTRIES)[number]["key"]) => string, current = "") {
  const options: { value: string; label: string }[] = GICS_INDUSTRIES.map(({ key, value }) => ({ value, label: label(key) }));
  const value = canonicalIndustry(current);
  return value && !options.some((option) => option.value === value) ? [{ value, label: value }, ...options] : options;
}
