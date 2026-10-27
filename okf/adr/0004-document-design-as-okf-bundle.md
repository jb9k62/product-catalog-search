---
type: Architectural Decision
title: "ADR-0004: Document the design as an OKF bundle"
description: Why design depth lives in an Open Knowledge Format bundle, with SOLUTION.md as a short summary.
tags: [documentation, okf, adr]
generated: { by: claude-opus-5, at: 2026-09-13 }
sources:
  - resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: OKF v0.2 specification
  - resource: scripts/okf-view.mjs
---

# ADR-0004: Document the design as an OKF bundle

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Jordan Hunt

## Context

`SOLUTION.md` had grown to over 300 lines of diagrams, code, and trade-offs. One long file is
hard to scan and link into, and it can't say where each claim came from or whether anyone
checked it.

## Decision

We will keep design depth in `okf/`, an
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
(OKF) v0.2 bundle, and keep `SOLUTION.md` as a short summary that links in. OKF is a small spec
for knowledge as markdown: one concept per file, linked by bundle-relative paths, with YAML
frontmatter recording each concept's `type`, `sources`, who wrote it (`generated`), whether a
person checked it (`verified`), and its `status`.

## Consequences

### Positive

- Structured frontmatter lets tools work with the docs. `npm run okf:validate` checks the
  bundle against the spec. `npm run okf:view` generates one self-contained HTML file: a
  clickable concept graph beside a reading pane that renders every Mermaid diagram.
- Each concept names its sources and who generated or verified it, which matters in a
  codebase written largely with AI assistance ([AI assistance](/app/ai-assistance.md)).
- Readers choose their depth: the summary, one concept, or the code.

### Trade-offs

- More files than one document.
- Bundle-root links such as `/app/api.md` don't resolve when browsing the markdown on GitHub.
  The viewer resolves them.
- `viz.html` is generated and gitignored, so it needs regenerating after edits.

## Alternatives considered

| Option                                        | Why rejected                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| One long `SOLUTION.md`                        | Hard to scan and link into, with no per-section sources or review status. |
| A docs site generator (VitePress, Docusaurus) | A build, dependencies, and configuration for about a dozen pages.         |
