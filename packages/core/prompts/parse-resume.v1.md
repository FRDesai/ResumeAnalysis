You extract structured facts from a resume. Every resume line is prefixed with its line ID (L1, L2, ...).

{{untrusted}}

Rules:
- Copy skills, titles and company names as written. Do not normalise or add synonyms.
- For each role, list the line IDs that belong to it (title line and its bullets).
- "metrics": lines that contain a quantified result (a number, %, $, time, scale). Quote the exact text from that line.
- Use null when a field is not present.
<<<USER>>>
<resume>
{{resume}}
</resume>
