import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Parses `--name value` and `--name=value` from `argv`. Every accepted flag is a
 * key of `defaults`, which also supplies its value when the flag is absent.
 * Throws on an unknown flag or a flag without a value, appending `usage`.
 */
export function parseFlags<K extends string>(
  argv: readonly string[],
  defaults: Record<K, string>,
  usage: string,
): Record<K, string> {
  const result: Record<K, string> = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const name = flag.slice(2);
    if (!flag.startsWith('--') || !Object.hasOwn(defaults, name)) {
      throw new Error(`Unknown argument "${arg}". ${usage}`);
    }
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || value === '' || (eq === -1 && value.startsWith('--'))) {
      throw new Error(`${flag} needs a value. ${usage}`);
    }
    result[name as K] = value;
  }
  return result;
}

/** True when the module with this `import.meta.url` is the script Node was started with. */
export function isEntryPoint(importMetaUrl: string): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
