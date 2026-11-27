export function generateSyntheticProject(
  dir: string,
  opts?: { modules?: number; layers?: number; fanOut?: number; testRatio?: number; seed?: number; barrels?: boolean },
): { modules: string[]; tests: Record<string, string>; imports: Record<string, string[]> };
