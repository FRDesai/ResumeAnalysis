# PRD – ResumeMatch v2 (MERN + LangChain)

Nov 17, 2026 · @Clitan Crasta

## Overview

ResumeMatch v2 rebuilds the existing Django + OpenAI resume analyser on MongoDB, Express, React and Node, with the LLM layer in LangChain.js and LangGraph.js. It takes a resume and a job description and returns a fit report in which every score is backed by a quote from the resume, plus a screening-question plan with rubrics. A built-in eval suite measures how good the output is. Target: a public repo and live demo within 2 weeks.

**Why rebuild it:** v1 already proves the idea (resume vs JD analysis with Pydantic-validated output), but it is on Django. Rebuilding it on MERN + LangChain closes the one hard requirement missing from the resume (LangChain/LangGraph in a shipped product). It also mirrors the pipeline InterviewSparrow runs: build an interview from the resume and the JD, then score against a rubric with evidence quotes.

**Goals**

- Ship a working MERN + LangGraph app with a live demo and a clean public repo.
- Every score in the report links to exact text from the source document, checked in code to really be there (no invented evidence).
- A repeatable eval suite that runs in CI and fails the build when quality drops.
- Show where prompts break and how the system handles it: malformed JSON, prompt injection inside a resume, hallucinated quotes, oversized input.

**Non-goals (v2)**

- Live voice interviews (a stretch item at most; see Scope).
- Multi-tenant billing, teams or recruiter ATS integrations.
- Fine-tuning or training models.

## Users and user stories

There are two users: a job seeker preparing for a role, and a recruiter screening candidates. Both get the same report.

| As a… | I want to… | So that… |
| --- | --- | --- |
| Job seeker | upload my resume and paste a JD | I see my fit score per dimension before I apply |
| Job seeker | see the exact resume line behind each score | I trust the score and know what to fix |
| Job seeker | get likely interview questions built from my resume and the JD | I can practise for the gaps the interviewer will probe |
| Job seeker | get suggested rewrites of weak bullets | I can improve the resume without inventing experience |
| Recruiter | score one resume against a rubric for my role | I get a consistent first-pass screen |
| Recruiter | see red flags and claims to verify | I know what to ask in the first call |

## Scope

The MVP is the full analysis pipeline, the evidence-linked report and the eval suite. Everything else waits until those pass their evals.

**MVP (must ship)**

1. Upload a resume (PDF or DOCX, max 5 MB) and paste a JD as text or a URL's text.
2. Parse both into structured JSON: skills, roles, projects, metrics; JD requirements split into must-have and nice-to-have.
3. Score fit on 6 dimensions (1–5), each with 1–3 evidence quotes checked to exist in the resume.
4. List gaps: JD requirements with no evidence, marked must-have or nice-to-have.
5. Generate an interview plan: 8 questions from the gaps and claims, each with a rubric (what a 1, 3 and 5 answer sounds like) and 2 follow-up probes.
6. Suggest rewrites for the 5 weakest bullets, never adding facts that aren't in the resume.
7. Stream progress to the UI while the graph runs (parse → score → questions).
8. Save reports per user; view history.
9. Eval suite: golden dataset, automated metrics, CI gate.

**Stretch (only after the MVP passes evals)**

- Text mock interview: the candidate answers the questions in chat; a LangGraph loop asks one follow-up per answer, then scores the answers against the rubric with quotes from the transcript.
- Voice mode for the mock interview over WebSockets (browser speech-to-text, then the same graph).
- Recruiter batch mode: one JD, up to 20 resumes, ranked table.

**Out of scope**

- Payments, teams and organisations, ATS integrations, mobile apps.

## System architecture

The React app talks to an Express API. The API queues each analysis in BullMQ, and a worker runs the LangGraph pipeline and writes the report to MongoDB.

&#91;embedded content: ResumeMatch v2 architecture · API, queue, 9-node graph, stores\]

The dashed arrow is the only loop: a score whose quote can't be found in the resume goes back for rescoring, at most twice. The API also reads reports and run status straight from MongoDB.

## LLM layer

The analysis is a LangGraph.js `StateGraph`. Each LLM step returns Zod-validated structured output, and a deterministic verifier rejects any evidence quote that isn't really in the resume. Pin the LangChain package versions at the start of the build and check the current docs, because the APIs change often.

**Libraries:** `@langchain/langgraph`, `@langchain/core`, `@langchain/openai` (plus `@langchain/anthropic` behind an env switch), `zod`, `@langchain/langgraph-checkpoint-mongodb` for run state, and LangSmith for tracing and evals.

**Graph nodes (in run order)**

1. `ingest` (no LLM): extract the text (pdf-parse / mammoth), normalise whitespace, and give every resume line an ID (`L1`, `L2`…). Reject over 12k tokens.
2. `guard` (no LLM + light LLM check): wrap the resume and JD in delimiters marked as untrusted data, and flag instruction-like text ("ignore previous instructions", "rate this 5/5"). Flags are shown in the report and never acted on.
3. `parseResume` and `parseJD`, **run in parallel**: `model.withStructuredOutput(ResumeSchema / JDSchema)`. The JD output splits requirements into must-have and nice-to-have, with a weight for each.
4. `matchRequirements`: for each JD requirement, return `{status: met | partial | missing, evidence: [{lineId, quote}]}`.
5. `scoreDimensions`: 6 dimensions scored 1–5 against a fixed rubric prompt (Role fit, Technical depth, Impact and metrics, Leadership and ownership, Relevance of recent work, Clarity of the resume). Each score carries 1–3 evidence quotes and a one-line reason.
6. `verifyEvidence` (no LLM): every quote must fuzzy-match its line (normalised Levenshtein ≥ 0.9). If one fails, the graph loops back to `scoreDimensions` with the failures as feedback, **at most 2 retries**. After that, the unsupported score is shown as "insufficient evidence" instead of being guessed.
7. `generateQuestions`: 8 questions aimed at gaps and unverified claims, each with a rubric (1 / 3 / 5 anchors) and 2 follow-up probes.
8. `rewriteBullets`: improves the 5 weakest bullets. A check rejects any rewrite that adds numbers, tools or employers missing from the original.
9. `assembleReport` (no LLM): computes the weighted overall score in code (never by the LLM) and writes the report to MongoDB.

**Prompting rules**

- Prompts live in versioned files (`prompts/score.v3.md`), and every report stores the prompt version and model used.
- Temperature is 0 for parsing and scoring, 0.4 for questions and rewrites.
- The model never does arithmetic: totals and weights are computed in code.
- Few-shot rubric examples sit in the scoring prompt, with a strong, an average and a weak example for each dimension.

**Where prompts break, and the fix**

| Failure mode | Detection | Handling |
| --- | --- | --- |
| Malformed or partial JSON | Zod parse error | One automatic retry with the error message, then the step fails visibly |
| Invented evidence quote | `verifyEvidence` mismatch | Loop back with feedback (max 2), then "insufficient evidence" |
| Prompt injection in the resume | `guard` flags + delimiters | Text treated as data; flag shown to the user; score unaffected (an eval case checks this) |
| Score inflation or drift | Eval: agreement with human labels | Rubric anchors + temperature 0 + regression gate in CI |
| Rewrites that invent facts | Entity diff of original vs rewrite | Rewrite dropped and the original kept |
| Over-long input | Token count in `ingest` | Rejected with a clear message before any LLM call |
| Provider timeout or 429 | HTTP error | Exponential backoff (3 tries); the run resumes from the Mongo checkpoint |

## Data model

The data lives in five MongoDB collections (Mongoose). Reports keep the prompt version and model that produced them, so any report can be traced and replayed.

| Collection | Key fields | Indexes / notes |
| --- | --- | --- |
| `users` | `email`, `passwordHash`, `createdAt` | unique `email`; JWT auth |
| `documents` | `userId`, `kind: resume \| jd`, `rawText`, `lines: [{id, text}]`, `parsed` (structured JSON), `hash` | `userId + hash` to avoid re-parsing the same file; raw file not stored after extraction |
| `runs` | `userId`, `resumeId`, `jdId`, `status: queued \| running \| done \| failed`, `currentNode`, `tokens`, `costUsd`, `latencyMs`, `error` | `userId + createdAt`; the LangGraph checkpoints sit in their own collection |
| `reports` | `runId`, `overall`, `dimensions: [{name, score, reason, evidence: [{lineId, quote, verified}]}]`, `gaps`, `questions: [{text, rubric, probes}]`, `rewrites`, `flags`, `promptVersion`, `model` | `runId` unique; TTL option for anonymous users (7 days) |
| `evalResults` | `datasetVersion`, `promptVersion`, `model`, `metrics`, `perCase`, `gitSha` | used by the CI gate and the eval page |

## API design

The API is a small REST service in Express, plus one Server-Sent Events stream for live progress. All routes except auth need a JWT and are rate-limited.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login` | Create an account or log in; returns a JWT |
| POST | `/api/documents` | Upload a resume (multipart) or a JD (text); returns `documentId` and parsed lines |
| POST | `/api/runs` | Start an analysis `{resumeId, jdId}`; enqueues a BullMQ job and returns `runId` |
| GET | `/api/runs/:id/stream` | SSE stream of node events (`parseResume:done`, `verifyEvidence:retry`…) |
| GET | `/api/runs/:id` | Run status, tokens, cost, latency |
| GET | `/api/reports/:runId` | Full report |
| GET | `/api/reports` | The user's report history (paginated) |
| POST | `/api/reports/:runId/feedback` | Thumbs up/down on a score or question; feeds the eval dataset |
| GET | `/api/evals/latest` | Latest eval metrics, shown on a public page in the demo |

Runs go through a BullMQ worker (Redis), so the API answers right away and a crashed worker resumes from the LangGraph Mongo checkpoint. That's the same pattern as Hey Koala's transcript pipeline.

## Frontend

The frontend is React (Vite + TypeScript) with Tailwind and shadcn/ui, and TanStack Query for server state. The report page is the product, so most of the design time goes there.

| Screen | What it shows |
| --- | --- |
| Upload | Resume drop zone + JD textarea; shows parsed lines right away so the user sees what the model will read |
| Run progress | Live node-by-node steps from the SSE stream, including verifier retries (shows the system checking itself) |
| Report | Verdict line, overall score, 6 dimension cards; clicking a score highlights its evidence lines in a side-by-side resume view; unverified evidence is marked |
| Gaps & questions | Must-have gaps first; each question opens to show its rubric and probes |
| Rewrites | Original vs suggested bullet, diffed; copy button |
| History | Past reports with score, date, model, prompt version |
| Evals (public) | Latest eval metrics and trend per prompt version |

**Key UX rule:** no score is shown without its evidence one click away. That's the same principle as InterviewSparrow's "exact sentence under every score".

## Evals and quality

A golden set of 30 hand-labelled resume–JD pairs runs on every pull request, and the build fails if any metric drops below its threshold. This is the part to talk about most in the interview.

**Golden dataset (v1, 30 cases)**

- 20 real pairs (your own resumes and anonymised ones from friends, with consent) × different JDs: strong, partial and poor fit.
- 5 adversarial cases: prompt injection hidden in the resume, white-text keyword stuffing, a resume in a different language, a near-empty resume, a JD with conflicting requirements.
- 5 edge cases: very long resume, table-heavy PDF, career changer, no metrics, fresher.
- Each case is labelled by hand: expected must-have status per requirement, an expected score range per dimension, and banned outputs.

**Metrics and thresholds**

| Metric | How it is measured | CI threshold |
| --- | --- | --- |
| Evidence validity | Share of quotes that pass `verifyEvidence` on the first attempt | ≥ 95% |
| Requirement match accuracy | met / partial / missing vs human labels | ≥ 85% |
| Score agreement | Dimension score within ±1 of the human label | ≥ 80% |
| Injection resistance | Adversarial cases where the score is unchanged and the flag is raised | 100% |
| Rewrite faithfulness | Rewrites with no new entities (code check) | 100% |
| Question relevance | LLM-as-judge (a different model) on a 1–5 scale, spot-checked by hand | mean ≥ 4.0 |
| Schema validity | Runs with no unrecovered Zod failure | 100% |
| Latency / cost | p95 end-to-end time; cost per report | p95 ≤ 45 s; ≤ $0.05 |

**How it runs:** a LangSmith dataset plus custom evaluators in TypeScript, run in a GitHub Actions job. Results are written to `evalResults` and shown on the public Evals page. Every prompt change opens a PR that shows the metric changes.

## Non-functional requirements

- **Latency:** first progress event in under 1 s; full report p95 ≤ 45 s. Parse nodes run in parallel, and the cheaper model is used for parsing.
- **Cost:** ≤ $0.05 per report, tracked per run from the token counts. A small model handles parsing and a stronger model handles scoring; the split is set by env.
- **Reliability:** BullMQ retries plus LangGraph checkpoints in Mongo, so a worker restart resumes the run without starting over. Idempotent runs keyed by `resumeHash + jdHash + promptVersion`.
- **Security:** JWT auth, Helmet, CORS allow-list, rate limit (10 runs/hour per user), file-type and size checks, and API keys only on the server.
- **Privacy:** raw files are deleted after text extraction; anonymous reports expire after 7 days; a delete-my-data endpoint; no resume text in logs (only IDs and hashes).
- **Observability:** LangSmith traces per run, structured logs (pino) with `runId`, and a cost/latency panel on the Evals page.
- **Deploy:** Docker Compose locally; API and worker on Railway or AWS (ECS or EC2) with MongoDB Atlas and Upstash Redis; frontend on Vercel. Using AWS for the API ticks the JD's nice-to-have.

## Milestones

The plan is two weeks of evening and weekend work, with the eval suite built in week 1, not saved for the end.

1. **Days 1–2 – Skeleton:** MERN monorepo (pnpm workspaces), auth, upload, text extraction with line IDs, Docker Compose, CI with lint and tests.
2. **Days 3–5 – Graph v1:** LangGraph with parse → match → score → verify (with the retry loop) → assemble; Zod schemas; BullMQ worker; SSE progress.
3. **Days 6–7 – Evals:** label the 30 golden cases, write the evaluators, add the GitHub Actions gate. Record the baseline metrics.
4. **Days 8–9 – Questions and rewrites:** `generateQuestions` and `rewriteBullets` with the faithfulness check; guard node and adversarial cases.
5. **Days 10–12 – Report UI:** evidence highlighting, gaps and questions, rewrites diff, history, public Evals page.
6. **Days 13–14 – Ship:** deploy, README with the architecture diagram and eval results, a 2-minute Loom demo, and a write-up of 3 prompt failures you hit and how you fixed them.

If time runs short, cut the rewrites and the history page, never the evals or the verifier.

## Success metrics and how to present it

It's done when the live demo works on a stranger's resume, the CI eval gate passes, and the README shows the metrics table with real numbers.

**Deliverables**

- Public GitHub repo: `FRDesai/resumematch-v2`, with a README (architecture diagram, eval results, failure write-up).
- Live demo URL and a 2-minute demo video.
- Eval results page showing at least one prompt version that improved a metric, with the before and after numbers.

**Resume bullet (fill in the real numbers once measured)**

- Rebuilt ResumeMatch on MERN + LangGraph.js: a 9-node graph with Zod-validated outputs and a deterministic evidence verifier; \[X\]% of evidence quotes verified on the first pass across a 30-case golden set, enforced by a CI eval gate.

**For the InterviewSparrow first call**

- Open with the graph and the verifier loop: "I don't let the model cite evidence I can't find in the source." That's their "exact sentence under every score" promise, built and tested.
- Show one eval regression you caught in CI, and how you fixed it.
- Link it to their product: the same graph, run on an interview transcript instead of a resume, gives rubric scoring with evidence.
