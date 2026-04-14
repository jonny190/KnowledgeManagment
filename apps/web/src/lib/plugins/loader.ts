import { pluginDefinitionSchema, type PluginDefinition } from "@km/shared";
import { makePluginContext } from "./context";

export interface LoadedPlugin {
  url: string;
  definition: PluginDefinition;
}
export interface LoadError {
  url: string;
  error: string;
}
export interface LoadResult {
  loaded: LoadedPlugin[];
  errors: LoadError[];
}

function isAllowed(url: string, origin: string, allowList: string[]): boolean {
  try {
    const u = new URL(url);
    if (u.origin === origin) return true;
    return allowList.some((entry) => url.startsWith(entry));
  } catch {
    return false;
  }
}

export async function loadPlugins(args: {
  urls: string[];
  allowList: string[];
  origin: string;
  vaultId: string;
  userId: string;
  importer?: (url: string) => Promise<Record<string, unknown>>;
}): Promise<LoadResult> {
  const loaded: LoadedPlugin[] = [];
  const errors: LoadError[] = [];
  const importer = args.importer ?? ((u: string) => import(/* @vite-ignore */ u) as Promise<Record<string, unknown>>);

  for (const url of args.urls) {
    if (!isAllowed(url, args.origin, args.allowList)) {
      errors.push({ url, error: "not-allow-listed" });
      continue;
    }
    try {
      const mod = await importer(url);
      const parsed = pluginDefinitionSchema.parse(mod.plugin);
      const ctx = makePluginContext(parsed as PluginDefinition, {
        vaultId: args.vaultId,
        userId: args.userId,
      });
      await parsed.activate(ctx);
      loaded.push({ url, definition: parsed as PluginDefinition });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "load-failed";
      errors.push({ url, error: msg });
    }
  }

  return { loaded, errors };
}
