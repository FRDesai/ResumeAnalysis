import type { LlmClient, Models, StructuredRequest, StructuredResult } from './types.js';

/**
 * LLM_PROVIDER=fake: a deterministic, offline stand-in for local development and
 * infrastructure smoke tests without an API key. It reads the line-numbered text
 * from the prompt and answers with simple keyword heuristics, quoting real lines.
 * On the first scoring call it deliberately invents one quote, so the verifier's
 * retry loop is visible in the progress stream. Not for real analysis.
 */
class DemoLlm implements LlmClient {
  readonly model = 'demo-offline';
  private scoreCalls = 0;

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await new Promise((r) => setTimeout(r, 300)); // make progress visible
    const raw = this.answer(req.name, req.user);
    return {
      data: req.schema.parse(raw),
      usage: [{ model: this.model, inputTokens: Math.ceil(req.user.length / 4), outputTokens: 200, costUsd: 0 }],
    };
  }

  private answer(name: string, user: string): unknown {
    const resume = section(user, 'resume');
    const jd = section(user, 'job_description');
    switch (name) {
      case 'parseResume':
        return {
          name: resume[0]?.text ?? null,
          headline: resume[1]?.text ?? null,
          skills: [],
          roles: [],
          projects: [],
          metrics: resume.filter((l) => /\d/.test(l.text)).map((l) => ({ lineId: l.id, quote: l.text })),
        };
      case 'parseJD':
        return {
          title: jd[0]?.text ?? null,
          requirements: jd.slice(1).map((l, i) => ({
            id: `R${i + 1}`,
            text: l.text.replace(/^(must have|required|nice to have|preferred|bonus)\s*:\s*/i, ''),
            kind: /nice|prefer|bonus|plus/i.test(l.text) ? 'nice' : 'must',
            weight: /nice|prefer|bonus|plus/i.test(l.text) ? 1 : 3,
          })),
        };
      case 'matchRequirements': {
        const reqs = [...user.matchAll(/^(R\d+) \[(must|nice)\]: (.+)$/gm)];
        return {
          matches: reqs.map(([, id, , text]) => {
            const words = text!.toLowerCase().split(/[^a-z0-9.+#]+/).filter((w) => w.length > 2);
            const hit = resume.find((l) => words.some((w) => l.text.toLowerCase().includes(w)));
            return hit
              ? { requirementId: id, status: 'met', evidence: [{ lineId: hit.id, quote: firstWords(hit.text, 10) }], note: 'Keyword match (demo)' }
              : { requirementId: id, status: 'missing', evidence: [], note: 'No keyword match (demo)' };
          }),
        };
      }
      case 'scoreDimensions': {
        const call = this.scoreCalls++;
        const dims = (user.match(/^Score these dimensions: (.+)$/m)?.[1] ?? '').split(', ');
        const body = resume.filter((l) => l.text.split(' ').length >= 3);
        return {
          dimensions: dims.map((d, i) => {
            const line = body[i % Math.max(1, body.length)] ?? resume[0]!;
            const invent = call === 0 && d === 'Impact and metrics';
            return {
              name: d,
              score: 3,
              reason: 'Demo score (offline mode)',
              evidence: [invent
                ? { lineId: line.id, quote: 'Grew revenue by 300% across 12 countries' }
                : { lineId: line.id, quote: firstWords(line.text, 8) }],
            };
          }),
        };
      }
      case 'guardCheck':
        return { suspicious: [] };
      case 'generateQuestions': {
        const gaps = [...user.matchAll(/^(missing|partial), (must|nice), (R\d+): (.+)$/gm)];
        const claims = [...user.matchAll(/^(L\d+)(?: \(UNVERIFIED\))?: (.+)$/gm)].filter((m) => /\d/.test(m[2]!));
        const qs: { text: string; target: string; requirementId: string | null; lineId: string | null }[] = [
          ...gaps.map((g) => ({ text: `The role needs ${g[4]}. What is your hands-on experience with it?`, target: 'gap', requirementId: g[3]!, lineId: null })),
          ...claims.map((c) => ({ text: `Walk me through this: "${firstWords(c[2]!, 12)}". What was your part?`, target: 'claim', requirementId: null, lineId: c[1]! })),
        ];
        while (qs.length < 8) qs.push({ text: 'Describe a technical decision you would make differently today.', target: 'claim', requirementId: null, lineId: null });
        return {
          questions: qs.slice(0, 8).map((q) => ({
            ...q,
            rubric: { one: 'Vague, no specifics', three: 'Some specifics, unclear own role', five: 'Concrete details, trade-offs and own role' },
            probes: ['What would you do differently?', 'How did you measure the result?'],
          })),
        };
      }
      case 'rewriteBullets': {
        const bullets = resume.filter((l) => /^[-*\u2022]/.test(l.text)).slice(0, 5);
        return {
          rewrites: bullets.map((l, i) => {
            const body = l.text.replace(/^[-*\u2022]\s*/, '').replace(/^(responsible for|worked on|involved in)\s+/i, '');
            const clean = body.charAt(0).toUpperCase() + body.slice(1);
            // The first rewrite invents a metric on purpose, so the entity check visibly rejects it.
            return { lineId: l.id, suggestion: i === 0 ? `${clean}, improving throughput by 30%` : clean, why: 'Lead with the action (demo)' };
          }),
        };
      }
      default:
        throw new Error(`demo model: no answer for ${name}`);
    }
  }
}

function section(user: string, tag: string): { id: string; text: string }[] {
  const m = user.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`));
  if (!m) return [];
  return m[1]!.split('\n').flatMap((l) => {
    const x = l.match(/^(L\d+): (.*)$/);
    return x ? [{ id: x[1]!, text: x[2]! }] : [];
  });
}

const firstWords = (s: string, n: number) => s.split(' ').slice(0, n).join(' ');

export function createDemoModels(): Models {
  const m = new DemoLlm();
  return { parse: m, score: m };
}
