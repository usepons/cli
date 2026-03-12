/**
 * Module registry — fetches available modules from the Pons registry.
 */

const REGISTRY_URL =
  "https://raw.githubusercontent.com/usepons/registry/main/modules.json";

export interface RegistryModule {
  id: string;
  name: string;
  description: string;
  category: string;
  essential: boolean;
}

/**
 * Fetch the module registry from GitHub.
 * Returns the module list, or null if the fetch fails.
 */
export async function fetchRegistry(): Promise<RegistryModule[] | null> {
  try {
    const res = await fetch(REGISTRY_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as RegistryModule[];
    if (!Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Group modules by category, preserving insertion order.
 */
export function groupByCategory(
  modules: RegistryModule[],
): Record<string, RegistryModule[]> {
  const groups: Record<string, RegistryModule[]> = {};
  for (const mod of modules) {
    const cat = mod.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(mod);
  }
  return groups;
}
