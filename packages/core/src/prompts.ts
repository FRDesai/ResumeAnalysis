import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Version of the prompt set. Bump it (and add *.vN.md files) whenever a prompt
 * changes; every report stores it so results can be traced and compared in evals.
 */
export const PROMPT_VERSION = process.env.PROMPT_VERSION ?? 'v1';

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
const cache = new Map<string, string>();

function load(name: string, version: string): string {
  const key = `${name}.${version}`;
  let text = cache.get(key);
  if (text === undefined) {
    text = readFileSync(join(PROMPT_DIR, `${key}.md`), 'utf8');
    cache.set(key, text);
  }
  return text;
}

/** Load prompts/<name>.<version>.md, fill {{vars}}, split into system and user parts. */
export function renderPrompt(
  name: string,
  vars: Record<string, string>,
  version = PROMPT_VERSION,
): { system: string; user: string } {
  const all = { untrusted: load('_shared-untrusted', version), feedback: '', ...vars };
  const filled = load(name, version).replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = all[k as keyof typeof all];
    if (v === undefined) throw new Error(`Prompt ${name}: missing variable {{${k}}}`);
    return v;
  });
  const [system, user] = filled.split('<<<USER>>>');
  if (user === undefined) throw new Error(`Prompt ${name} has no <<<USER>>> section`);
  return { system: system!.trim(), user: user.trim() };
}
