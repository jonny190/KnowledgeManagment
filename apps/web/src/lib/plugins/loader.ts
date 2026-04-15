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
  const importer =
    args.importer ??
    ((u: string) =>
      import(/* @vite-ignore */ /* webpackIgnore: true */ u) as Promise<Record<string, unknown>>);

  for (const url of args.urls) {
    if (!isAllowed(url, args.origin, args.allowList)) {
      console.warn(`[plugins] not allow-listed: ${url}`);
      errors.push({ url, error: "not-allow-listed" });
      continue;
    }
    try {
      const mod = await importer(url);
      // Validate with zod, but invoke the ORIGINAL activate function.
      // z.function() returns a wrapped function that swallows/reformats the
      // callee, which breaks plugins that capture closure state.
      pluginDefinitionSchema.parse(mod.plugin);
      const original = mod.plugin as PluginDefinition;
      const ctx = makePluginContext(original, {
        vaultId: args.vaultId,
        userId: args.userId,
      });
      await original.activate(ctx);
      loaded.push({ url, definition: original });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "load-failed";
      console.error(`[plugins] load error for ${url}:`, msg);
      errors.push({ url, error: msg });
    }
  }

  return { loaded, errors };
}
