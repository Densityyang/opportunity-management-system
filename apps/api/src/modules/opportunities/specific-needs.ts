import { SPECIFIC_NEED_OPTIONS, type SpecificNeedOption } from "@oms/contracts";

const allowed = new Set<string>(SPECIFIC_NEED_OPTIONS);

export function serializeSpecificNeeds(values: readonly string[]): string {
  return JSON.stringify(values);
}

export function deserializeSpecificNeeds(value: string): SpecificNeedOption[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length >= 1 &&
      parsed.length <= 2 &&
      parsed.every((item) => typeof item === "string" && allowed.has(item)) &&
      new Set(parsed).size === parsed.length
    )
      return parsed as SpecificNeedOption[];
  } catch {
    // Compatibility with records written before menu values were JSON encoded.
  }

  if (allowed.has(value)) return [value as SpecificNeedOption];
  for (const first of SPECIFIC_NEED_OPTIONS) {
    for (const second of SPECIFIC_NEED_OPTIONS) {
      if (first !== second && `${first}、${second}` === value)
        return [first, second];
    }
  }
  return [];
}

export function displaySpecificNeeds(value: string): string {
  const parsed = deserializeSpecificNeeds(value);
  return parsed.length ? parsed.join("；") : value;
}
