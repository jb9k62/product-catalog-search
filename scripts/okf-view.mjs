#!/usr/bin/env node
/**
 * OKF v0.2 bundle validator and viewer.
 *
 * Walks a bundle, checks conformance (SPEC §11: every non-reserved .md needs
 * frontmatter with a non-empty `type`), derives trust tier (§5.3) and
 * staleness (§5.5), then writes one self-contained HTML page: a concept graph
 * (Cytoscape) beside a reading pane (marked for markdown, Mermaid for
 * diagrams). The libraries load from a CDN. Based on the viewer in
 * GoogleCloudPlatform/knowledge-catalog.
 *
 * Usage:
 *   node scripts/okf-view.mjs [bundle] [options]
 *     bundle        OKF bundle directory (default: ./okf)
 *     --out <f>     write the viewer here (default: <bundle>/viz.html)
 *     --validate    validate only; do not write the viewer
 *     --strict      exit 1 if any conformance issues are found
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const RESERVED = new Set(["index.md", "log.md"]);
const LINK_RE = /\]\(([^)\s]+\.md)(?:#[A-Za-z0-9_\-]*)?\)/g;

// --- document parsing (mirrors reference_agent/bundle/document.py) ----------

function parseDocument(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { frontmatter: {}, body: text };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) throw new Error("Unterminated YAML frontmatter block");
  const fmText = lines.slice(1, endIdx).join("\n");
  let fm;
  try {
    fm = YAML.parse(fmText) ?? {};
  } catch (e) {
    throw new Error(`Invalid YAML in frontmatter: ${e.message}`);
  }
  if (typeof fm !== "object" || Array.isArray(fm)) {
    throw new Error("Frontmatter must be a YAML mapping");
  }
  let body = lines.slice(endIdx + 1).join("\n");
  if (body.startsWith("\n")) body = body.slice(1);
  return { frontmatter: fm, body };
}

function normalizeVerified(fm) {
  const v = fm.verified;
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object");
  if (typeof v === "object") return [v];
  return [];
}

function trustTier(fm) {
  const ev = normalizeVerified(fm);
  if (ev.length === 0) return "unverified";
  if (ev.some((e) => String(e.by || "").startsWith("human:")))
    return "human-reviewed";
  return "machine-confirmed";
}

function isStale(fm, today) {
  const raw = fm.stale_after;
  if (!raw) return false;
  const d = new Date(String(raw).slice(0, 10));
  if (Number.isNaN(d.getTime())) return false;
  return (today || new Date()) >= d;
}

// --- link extraction (mirrors reference viewer _extract_links) --------------

function extractLinks(body, docDir, bundleRoot) {
  const out = new Set();
  const rootResolved = path.resolve(bundleRoot);
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[1];
    if (/^[a-z]+:\/\//i.test(target)) continue; // external URL
    // Absolute bundle-relative form (OKF §6.1, recommended) resolves against
    // the bundle root.
    const base = target.startsWith("/") ? rootResolved : docDir;
    const relTarget = target.replace(/^\/+/, "");
    let resolved;
    try {
      resolved = path.relative(rootResolved, path.resolve(base, relTarget));
    } catch {
      continue;
    }
    if (resolved.startsWith("..") || path.isAbsolute(resolved)) continue;
    const rel = resolved.split(path.sep).join("/");
    out.add(rel.endsWith(".md") ? rel.slice(0, -3) : rel);
  }
  return [...out];
}

// --- walk + validate the bundle ---------------------------------------------

function listMarkdown(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

function walkBundle(bundleRoot, today) {
  const concepts = [];
  const issues = [];
  const reserved = [];
  for (const rel of listMarkdown(bundleRoot)) {
    const name = path.basename(rel);
    const full = path.join(bundleRoot, rel);
    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch (e) {
      issues.push({ file: rel, kind: "read", message: e.message });
      continue;
    }
    if (RESERVED.has(name)) {
      reserved.push(rel);
      continue;
    }

    let doc;
    try {
      doc = parseDocument(text);
    } catch (e) {
      issues.push({ file: rel, kind: "parse", message: e.message });
      continue;
    }
    const fm = doc.frontmatter;
    if (fm.type == null || String(fm.type).trim() === "") {
      issues.push({
        file: rel,
        kind: "missing-type",
        message: "No non-empty `type` in frontmatter (OKF v0.2 §11)",
      });
      continue;
    }

    const tags = Array.isArray(fm.tags)
      ? fm.tags.map(String)
      : fm.tags
        ? [String(fm.tags)]
        : [];
    const sources = Array.isArray(fm.sources)
      ? fm.sources.filter((s) => s && typeof s === "object")
      : fm.sources && typeof fm.sources === "object"
        ? [fm.sources]
        : [];
    concepts.push({
      id: rel.replace(/\.md$/, ""),
      type: String(fm.type),
      title: String(fm.title ?? rel.replace(/\.md$/, "")),
      description: String(fm.description ?? ""),
      resource: String(fm.resource ?? ""),
      tags,
      status: String(fm.status ?? "stable"),
      generated:
        fm.generated && typeof fm.generated === "object" ? fm.generated : {},
      verified: normalizeVerified(fm),
      stale_after: String(fm.stale_after ?? ""),
      sources,
      trust_tier: trustTier(fm),
      stale: isStale(fm, today),
      body: doc.body,
      links_to: extractLinks(doc.body, path.dirname(full), bundleRoot),
    });
  }
  return { concepts, issues, reserved };
}

// --- graph construction ------------------------------------------------------

const TYPE_PALETTE = {
  Application: "#2563eb",
  Architecture: "#0891b2",
  "API Reference": "#7c3aed",
  "Data Model": "#d97706",
  Process: "#059669",
  "Architectural Decision": "#e11d48",
  Reference: "#64748b",
  Metric: "#ca8a04",
  Playbook: "#ea580c",
  "BigQuery Dataset": "#8b5cf6",
  "BigQuery Table": "#3b82f6",
};
const DEFAULT_NODE_COLOR = "#94a3b8";

function buildGraph(concepts) {
  const ids = new Set(concepts.map((c) => c.id));
  const edges = [];
  const seen = new Set();
  const inDegree = new Map();
  for (const c of concepts) {
    for (const target of c.links_to) {
      if (target === c.id || !ids.has(target)) continue;
      const key = `${c.id}\u0000${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      edges.push({ data: { id: `${c.id}__${target}`, source: c.id, target } });
    }
  }
  const nodes = concepts.map((c) => ({
    data: {
      id: c.id,
      label: c.title,
      type: c.type,
      description: c.description,
      resource: c.resource,
      tags: c.tags,
      status: c.status,
      generated: c.generated,
      verified: c.verified,
      stale_after: c.stale_after,
      sources: c.sources,
      trust_tier: c.trust_tier,
      stale: c.stale,
      color: TYPE_PALETTE[c.type] ?? DEFAULT_NODE_COLOR,
      // Sized by how many concepts link here, so hubs stand out.
      size: Math.min(56, 24 + 6 * (inDegree.get(c.id) ?? 0)),
    },
  }));
  const bodies = Object.fromEntries(concepts.map((c) => [c.id, c.body]));
  const types = [...new Set(concepts.map((c) => c.type))].sort();
  return {
    nodes,
    edges,
    bodies,
    types,
    palette: TYPE_PALETTE,
    defaultColor: DEFAULT_NODE_COLOR,
  };
}

// The page title comes from the root index.md's H1, falling back to the folder name.
function readBundleTitle(bundleRoot) {
  try {
    const { body } = parseDocument(
      fs.readFileSync(path.join(bundleRoot, "index.md"), "utf8"),
    );
    const h1 = body.match(/^# (.+)$/m);
    if (h1) return h1[1].trim();
  } catch {
    // no readable index.md
  }
  return path.basename(bundleRoot) || "okf";
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// JSON inside <script>: escaping "<" stops a body containing "</script>" ending the block early.
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// --- HTML template ----------------------------------------------------------

function buildHTML(title, graph) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<script>
  // Set the theme before first paint, so a dark-theme reader never sees a light flash.
  let okfTheme = null;
  try { okfTheme = localStorage.getItem("okf-theme"); } catch {}
  document.documentElement.dataset.theme = okfTheme === "dark" || okfTheme === "light"
    ? okfTheme
    : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
</script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape@3.28.1/dist/cytoscape.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.2/highlight.min.js"></script>
<style>
${CSS}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <strong id="bundle-name"></strong>
    <span>OKF bundle</span>
  </div>
  <div class="controls">
    <input id="search" type="search" placeholder="Filter by title, path or tag" aria-label="Filter the graph">
    <select id="filter-type" aria-label="Filter by type"><option value="">All types</option></select>
    <button id="reset" type="button">Reset</button>
    <button id="reading-toggle" type="button" aria-pressed="false">Reading view</button>
    <button id="theme-toggle" type="button">Dark theme</button>
  </div>
</header>

<main>
  <section id="graph-pane" aria-label="Concept graph">
    <div id="graph"></div>
    <ul id="legend" aria-label="Concept types"></ul>
  </section>
  <section id="detail">
    <p id="detail-empty">Select a concept in the graph.</p>
    <article id="detail-content" hidden>
      <header class="concept-header">
        <span id="detail-type" class="type-chip"></span>
        <h1 id="detail-title"></h1>
        <p id="detail-description" class="lead"></p>
        <div id="detail-badges" class="badges"></div>
        <details class="provenance">
          <summary>Sources and review</summary>
          <dl id="detail-meta"></dl>
        </details>
      </header>
      <div id="detail-body" class="prose"></div>
      <nav id="detail-backlinks" hidden>
        <h2>Linked from</h2>
        <ul id="backlinks-list"></ul>
      </nav>
    </article>
  </section>
</main>

<script>
window.BUNDLE_NAME = ${scriptJson(title)};
window.BUNDLE = ${scriptJson(graph)};
</script>
<script>
${JS}
</script>
</body>
</html>
`;
}

const CSS = `
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-2: #f1f5f9;
  --border: #e2e8f0;
  --border-strong: #cbd5e1;
  --text: #334155;
  --text-muted: #64748b;
  --heading: #0f172a;
  --accent: #2563eb;
  --code-bg: #eef2f7;
  --pre-bg: #f8fafc;
  --code-keyword: #be185d;
  --code-string: #15803d;
  --code-number: #b45309;
  --code-title: #1d4ed8;
  --code-attr: #b45309;
  --code-builtin: #0e7490;
  --code-comment: #64748b;
  --code-meta: #7c3aed;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --bg: #0b1120;
  --surface: #0f172a;
  --surface-2: #1e293b;
  --border: #1e293b;
  --border-strong: #334155;
  --text: #cbd5e1;
  --text-muted: #94a3b8;
  --heading: #f1f5f9;
  --accent: #60a5fa;
  --code-bg: #1e293b;
  --pre-bg: #111827;
  --code-keyword: #f472b6;
  --code-string: #4ade80;
  --code-number: #fbbf24;
  --code-title: #60a5fa;
  --code-attr: #fbbf24;
  --code-builtin: #22d3ee;
  --code-comment: #94a3b8;
  --code-meta: #c4b5fd;
  color-scheme: dark;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; }
body {
  margin: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.7 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
button, input, select {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 5px 10px;
}
button, select { cursor: pointer; }
button:hover { background: var(--surface-2); }
button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Top bar */
.topbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: baseline; gap: 10px; }
.brand strong { font-size: 15px; color: var(--heading); }
.brand span { font-size: 12px; color: var(--text-muted); }
.controls { display: flex; flex-wrap: wrap; gap: 8px; }
.controls input { width: 220px; }

/* Layout: graph on the left, reading pane on the right */
main { flex: 1; min-height: 0; display: flex; }
#graph-pane {
  position: relative;
  flex: 0 0 40%;
  min-width: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
}
#graph { position: absolute; inset: 0; }
#legend {
  position: absolute;
  left: 12px;
  bottom: 12px;
  margin: 0;
  padding: 8px 12px;
  list-style: none;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
#legend li { display: flex; align-items: center; gap: 8px; }
#legend .dot { width: 9px; height: 9px; border-radius: 50%; }
#detail { flex: 1; min-width: 0; overflow-y: auto; }
#detail-content, #detail-empty { max-width: 46rem; margin: 0 auto; padding: 36px 36px 72px; }
#detail-empty { color: var(--text-muted); text-align: center; }
body.reading #graph-pane { display: none; }

/* Concept header */
.concept-header { margin-bottom: 32px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
.type-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.type-chip::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--chip); }
.concept-header h1 {
  margin: 6px 0 8px;
  font-size: 30px;
  line-height: 1.25;
  letter-spacing: -0.015em;
  color: var(--heading);
}
.lead { margin: 0 0 14px; font-size: 17px; line-height: 1.6; color: var(--text-muted); }
.badges { display: flex; flex-wrap: wrap; gap: 6px; }
.badge {
  font-size: 12px;
  line-height: 1;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
}
.badge.tag::before { content: "#"; opacity: 0.6; }
.badge.trust-human-reviewed { background: #ede9fe; color: #5b21b6; }
.badge.trust-machine-confirmed { background: #dbeafe; color: #1e40af; }
.badge.trust-unverified { background: #fef3c7; color: #92400e; }
.badge.status-draft { background: #fef3c7; color: #92400e; }
.badge.status-deprecated, .badge.stale { background: #fee2e2; color: #991b1b; }
:root[data-theme="dark"] .badge.trust-human-reviewed { background: #2e1065; color: #c4b5fd; }
:root[data-theme="dark"] .badge.trust-machine-confirmed { background: #172554; color: #93c5fd; }
:root[data-theme="dark"] .badge.trust-unverified,
:root[data-theme="dark"] .badge.status-draft { background: #422006; color: #fcd34d; }
:root[data-theme="dark"] .badge.status-deprecated,
:root[data-theme="dark"] .badge.stale { background: #450a0a; color: #fca5a5; }
.provenance { margin-top: 14px; font-size: 13px; }
.provenance summary { cursor: pointer; color: var(--text-muted); }
#detail-meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 10px 0 0; }
#detail-meta dt { color: var(--text-muted); }
#detail-meta dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
#detail-meta ul { margin: 0; padding-left: 18px; }
#detail-meta code { font-size: 12px; }

/* Rendered markdown */
.prose > :first-child { margin-top: 0; }
.prose h2 { margin: 2.2em 0 0.6em; font-size: 22px; line-height: 1.3; color: var(--heading); }
.prose h3 { margin: 1.8em 0 0.5em; font-size: 17px; color: var(--heading); }
.prose p, .prose ul, .prose ol { margin: 0 0 1em; }
.prose ul, .prose ol { padding-left: 1.4em; }
.prose li + li { margin-top: 0.35em; }
.prose strong { color: var(--heading); }
.prose a { color: var(--accent); text-decoration: none; }
.prose a:hover { text-decoration: underline; }
code { font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; }
.prose code { font-size: 0.85em; padding: 0.15em 0.4em; border-radius: 4px; background: var(--code-bg); }
.prose pre {
  margin: 0 0 1.3em;
  padding: 14px 18px;
  overflow-x: auto;
  background: var(--pre-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.prose pre code { padding: 0; background: none; font-size: 13px; line-height: 1.6; }
.hljs { background: none; color: var(--text); }
.hljs-comment, .hljs-quote { color: var(--code-comment); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type, .hljs-tag, .hljs-operator { color: var(--code-keyword); }
.hljs-string, .hljs-doctag, .hljs-regexp, .hljs-addition { color: var(--code-string); }
.hljs-number { color: var(--code-number); }
.hljs-title, .hljs-title.function_, .hljs-title.class_, .hljs-section, .hljs-selector-id { color: var(--code-title); font-weight: 600; }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable, .hljs-property, .hljs-params { color: var(--code-attr); }
.hljs-built_in, .hljs-builtin-name, .hljs-name, .hljs-class { color: var(--code-builtin); }
.hljs-symbol, .hljs-bullet, .hljs-link, .hljs-meta { color: var(--code-meta); }
.hljs-deletion { color: #b91c1c; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 700; }
.table-wrap { margin: 0 0 1.3em; overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
.prose table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.55; }
.prose th, .prose td { padding: 9px 14px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); }
.prose th { background: var(--surface-2); font-weight: 600; color: var(--heading); white-space: nowrap; }
.prose tr:last-child td { border-bottom: 0; }
.prose blockquote { margin: 0 0 1em; padding: 2px 16px; border-left: 3px solid var(--border-strong); color: var(--text-muted); }
.prose hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
.prose .mermaid {
  margin: 0 0 1.3em;
  padding: 20px;
  overflow-x: auto;
  text-align: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.prose .mermaid svg { max-width: 100%; height: auto; }
.prose .mermaid[data-state="error"] { text-align: left; border-color: #fca5a5; }
.prose .mermaid[data-state="error"] p { color: #b91c1c; font-size: 14px; }

/* Backlinks */
#detail-backlinks { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 15px; }
#detail-backlinks h2 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}
#detail-backlinks ul { margin: 0; padding-left: 1.2em; }
#detail-backlinks a { color: var(--accent); text-decoration: none; }
#detail-backlinks a:hover { text-decoration: underline; }

@media (max-width: 820px) {
  main { flex-direction: column; }
  #graph-pane { flex: 0 0 40vh; border-right: 0; border-bottom: 1px solid var(--border); }
  #detail-content, #detail-empty { padding: 24px 18px 56px; }
  .controls input { width: 100%; }
}
`;

// Client script. It sits inside a template literal, so it avoids backticks,
// "\${", and backslashes.
const JS = `
(() => {
  const bundle = window.BUNDLE;
  const $ = (id) => document.getElementById(id);
  const byId = Object.fromEntries(bundle.nodes.map((node) => [node.data.id, node.data]));
  const THEME_KEY = "okf-theme";
  let theme = document.documentElement.dataset.theme;
  let current = null;
  let renderToken = 0;
  let diagramCount = 0;

  $("bundle-name").textContent = window.BUNDLE_NAME;

  const backlinks = {};
  for (const edge of bundle.edges) (backlinks[edge.data.target] ||= []).push(edge.data.source);

  for (const type of bundle.types) {
    $("filter-type").append(new Option(type, type));
    const item = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = bundle.palette[type] || bundle.defaultColor;
    item.append(dot, type);
    $("legend").append(item);
  }

  // Cytoscape styles can't read CSS variables, so each theme's graph colours live here.
  function graphStyle() {
    const dark = theme === "dark";
    const label = dark ? "#e2e8f0" : "#1e293b";
    const labelBg = dark ? "#0f172a" : "#ffffff";
    const edge = dark ? "#475569" : "#cbd5e1";
    return [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "width": "data(size)",
          "height": "data(size)",
          "border-width": 2,
          "border-color": labelBg,
          "label": "data(label)",
          "color": label,
          "font-size": 13,
          "font-weight": 500,
          "text-valign": "bottom",
          "text-margin-y": 5,
          "text-wrap": "wrap",
          "text-max-width": 150,
          "text-background-color": labelBg,
          "text-background-opacity": 0.85,
          "text-background-padding": 2,
          "text-background-shape": "roundrectangle",
        },
      },
      { selector: "node[?stale]", style: { "border-color": "#dc2626", "border-style": "dashed" } },
      { selector: 'node[status = "deprecated"]', style: { "opacity": 0.5 } },
      { selector: "node:selected", style: { "border-width": 4, "border-color": "#f59e0b" } },
      {
        selector: "edge",
        style: {
          "width": 1.2,
          "curve-style": "bezier",
          "line-color": edge,
          "target-arrow-color": edge,
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.8,
        },
      },
      { selector: "edge.focus", style: { "width": 2, "line-color": "#f59e0b", "target-arrow-color": "#f59e0b" } },
      { selector: ".faded", style: { "opacity": 0.25 } },
      { selector: ".dim", style: { "opacity": 0.1 } },
    ];
  }

  const cy = cytoscape({
    container: $("graph"),
    elements: [...bundle.nodes, ...bundle.edges],
    style: graphStyle(),
    layout: { name: "cose", animate: false, padding: 40, nodeDimensionsIncludeLabels: true, nodeRepulsion: () => 60000, idealEdgeLength: () => 70, nodeOverlap: 20, randomize: false },
    minZoom: 0.3,
    maxZoom: 2.5,
  });

  cy.on("tap", "node", (event) => navigate(event.target.id()));
  cy.on("tap", (event) => { if (event.target === cy) clearFocus(); });

  function clearFocus() {
    cy.elements().removeClass("faded focus").unselect();
  }

  // Selecting a concept fades everything outside its immediate neighbourhood.
  function focusNode(id) {
    clearFocus();
    const node = cy.getElementById(id);
    if (node.empty()) return;
    node.select();
    cy.elements().not(node.closedNeighborhood()).addClass("faded");
    node.connectedEdges().addClass("focus");
    const box = node.renderedBoundingBox();
    const offscreen = box.x1 < 0 || box.y1 < 0 || box.x2 > cy.width() || box.y2 > cy.height();
    if (offscreen && cy.width() > 0) cy.animate({ center: { eles: node } }, { duration: 250 });
  }

  // The URL hash names the open concept, so links, Back/Forward, and reloads all work.
  function navigate(id) {
    if (location.hash.slice(1) === id) show(id);
    else location.hash = id;
  }
  window.addEventListener("hashchange", () => show(decodeURIComponent(location.hash.slice(1))));

  function show(id) {
    const data = byId[id];
    if (!data) return;
    current = id;
    focusNode(id);
    document.title = data.label + " | " + window.BUNDLE_NAME;

    $("detail-empty").hidden = true;
    $("detail-content").hidden = false;
    $("detail-type").textContent = data.type;
    $("detail-type").style.setProperty("--chip", data.color);
    $("detail-title").textContent = data.label;
    $("detail-description").textContent = data.description;
    $("detail-description").hidden = !data.description;

    const badges = [];
    if (data.status !== "stable") badges.push(badge(data.status, "status-" + data.status));
    badges.push(badge(data.trust_tier.replaceAll("-", " "), "trust-" + data.trust_tier));
    if (data.stale) badges.push(badge("stale since " + data.stale_after.slice(0, 10), "stale"));
    for (const tag of data.tags) badges.push(badge(tag, "tag"));
    $("detail-badges").replaceChildren(...badges);

    renderProvenance(data, id);
    renderBody(id);
    renderBacklinks(id);
    $("detail").scrollTop = 0;
  }

  function renderProvenance(data, id) {
    const rows = [["File", code(id + ".md")]];
    if (data.generated && data.generated.by) rows.push(["Generated", actor(data.generated)]);
    rows.push(["Verified", data.verified.length ? data.verified.map(actor).join("; ") : "Not yet"]);
    if (data.resource) rows.push(["Resource", code(data.resource)]);
    if (data.sources.length) {
      const list = document.createElement("ul");
      for (const source of data.sources) {
        const item = document.createElement("li");
        if (source.title) item.append(source.title, " ");
        item.append(code(source.resource || source.id || ""));
        list.append(item);
      }
      rows.push(["Sources", list]);
    }
    $("detail-meta").replaceChildren(...rows.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.append(value);
      return [dt, dd];
    }));
  }

  function renderBody(id) {
    const body = $("detail-body");
    body.innerHTML = marked.parse(bundle.bodies[id] || "", { gfm: true });

    // The header already shows the title, so drop the body's own H1.
    const first = body.firstElementChild;
    if (first && first.tagName === "H1") first.remove();

    for (const table of body.querySelectorAll("table")) {
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      table.replaceWith(wrap);
      wrap.append(table);
    }

    for (const link of body.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href");
      const target = href.startsWith("/") ? href.slice(1).split("#")[0].replace(/[.]md$/, "") : null;
      if (target && byId[target]) {
        if (link.textContent === href) link.textContent = byId[target].label;
        link.setAttribute("href", "#" + target);
      } else {
        link.target = "_blank";
        link.rel = "noopener";
      }
    }

    highlightCode(body);
    renderMermaid(body, ++renderToken);
  }

  function highlightCode(root) {
    if (!window.hljs) return;
    for (const block of root.querySelectorAll("pre > code:not(.language-mermaid)")) {
      hljs.highlightElement(block);
    }
  }

  // Diagrams render one at a time, each in its own try, so a broken diagram shows
  // its error and source instead of stopping the others.
  async function renderMermaid(root, token) {
    const figures = [...root.querySelectorAll("pre > code.language-mermaid")].map((block) => {
      const figure = document.createElement("div");
      figure.className = "mermaid";
      figure.dataset.state = "pending";
      block.parentElement.replaceWith(figure);
      return { figure, source: block.textContent };
    });
    if (figures.length === 0) return;

    if (!window.mermaid) {
      for (const { figure, source } of figures) showDiagramError(figure, source, "Mermaid did not load");
      return;
    }
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme === "dark" ? "dark" : "neutral" });

    for (const { figure, source } of figures) {
      const diagramId = "okf-diagram-" + ++diagramCount;
      try {
        const { svg } = await mermaid.render(diagramId, source);
        if (token !== renderToken) return; // another concept was opened meanwhile
        figure.innerHTML = svg;
        figure.dataset.state = "rendered";
      } catch (error) {
        document.getElementById("d" + diagramId)?.remove(); // Mermaid leaves its error graphic in <body>
        if (token !== renderToken) return;
        showDiagramError(figure, source, error && error.message ? error.message : String(error));
      }
    }
  }

  function showDiagramError(figure, source, message) {
    figure.dataset.state = "error";
    const note = document.createElement("p");
    note.textContent = "Diagram failed to render: " + message;
    const pre = document.createElement("pre");
    pre.textContent = source;
    figure.replaceChildren(note, pre);
    console.error("Mermaid diagram failed:", message);
  }

  function renderBacklinks(id) {
    const sources = backlinks[id] || [];
    $("detail-backlinks").hidden = sources.length === 0;
    $("backlinks-list").replaceChildren(...sources.map((source) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#" + source;
      link.textContent = byId[source].label;
      item.append(link);
      return item;
    }));
  }

  function badge(text, className) {
    const el = document.createElement("span");
    el.className = "badge " + className;
    el.textContent = text;
    return el;
  }

  function code(text) {
    const el = document.createElement("code");
    el.textContent = text;
    return el;
  }

  function actor(event) {
    return event.at ? event.by + ", " + String(event.at).slice(0, 10) : String(event.by);
  }

  // Search text and type filter combine: a node must pass both to stay bright.
  function applyFilters() {
    const query = $("search").value.trim().toLowerCase();
    const type = $("filter-type").value;
    cy.nodes().forEach((node) => {
      const d = node.data();
      const text = (d.label + " " + d.id + " " + d.tags.join(" ")).toLowerCase();
      node.toggleClass("dim", (query !== "" && !text.includes(query)) || (type !== "" && d.type !== type));
    });
    cy.edges().forEach((edge) => {
      edge.toggleClass("dim", edge.source().hasClass("dim") || edge.target().hasClass("dim"));
    });
  }
  $("search").addEventListener("input", applyFilters);
  $("filter-type").addEventListener("change", applyFilters);

  $("reset").addEventListener("click", () => {
    $("search").value = "";
    $("filter-type").value = "";
    applyFilters();
    clearFocus();
    cy.fit(undefined, 40);
  });

  $("reading-toggle").addEventListener("click", () => {
    const reading = document.body.classList.toggle("reading");
    $("reading-toggle").setAttribute("aria-pressed", String(reading));
    if (!reading) {
      cy.resize();
      cy.fit(undefined, 40);
    }
  });

  function updateThemeButton() {
    $("theme-toggle").textContent = theme === "dark" ? "Light theme" : "Dark theme";
  }
  $("theme-toggle").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    updateThemeButton();
    cy.style(graphStyle());
    if (current) {
      // Re-render so diagrams pick up the new theme, keeping the reading position.
      const scroll = $("detail").scrollTop;
      show(current);
      $("detail").scrollTop = scroll;
    }
  });

  updateThemeButton();
  cy.fit(undefined, 40);

  // Open the concept named in the URL, else the first Application concept, else the most linked-to one.
  const requested = decodeURIComponent(location.hash.slice(1));
  const byLinks = [...bundle.nodes].sort((a, b) => (backlinks[b.data.id] || []).length - (backlinks[a.data.id] || []).length);
  const start = byId[requested]
    ? requested
    : (bundle.nodes.find((node) => node.data.type === "Application") || byLinks[0] || { data: {} }).data.id;
  if (start) show(start);
})();
`;

// --- CLI -------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { bundle: "okf", out: null, validateOnly: false, strict: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      opts.out = argv[++i];
    } else if (a === "--validate") {
      opts.validateOnly = true;
    } else if (a === "--strict") {
      opts.strict = true;
    } else if (a.startsWith("-")) {
      console.error("Unknown flag: " + a);
      process.exit(2);
    } else positional.push(a);
  }
  if (positional.length) opts.bundle = positional[0];
  return opts;
}

function countBy(concepts, key) {
  const counts = {};
  for (const c of concepts) counts[c[key]] = (counts[c[key]] || 0) + 1;
  return Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const bundleRoot = path.resolve(opts.bundle);
  if (!fs.existsSync(bundleRoot) || !fs.statSync(bundleRoot).isDirectory()) {
    console.error(`Bundle directory not found: ${bundleRoot}`);
    process.exit(2);
  }
  const { concepts, issues, reserved } = walkBundle(bundleRoot, new Date());
  const graph = buildGraph(concepts);
  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.join(bundleRoot, "viz.html");

  console.log(`\nOKF validation: ${bundleRoot}`);
  console.log(`  okf_version          : 0.2`);
  console.log(`  concepts (valid)     : ${concepts.length}`);
  console.log(`  graph edges          : ${graph.edges.length}`);
  console.log(`  reserved (index/log) : ${reserved.length}`);
  console.log(`  issues               : ${issues.length}`);
  if (issues.length) {
    console.log("\nIssues:");
    for (const i of issues)
      console.log(`  ✗ ${i.file}  [${i.kind}] ${i.message}`);
  } else {
    console.log("  ✓ every non-reserved .md has a non-empty type");
  }
  console.log(`  trust tiers: ${countBy(concepts, "trust_tier")}`);
  console.log(`  statuses   : ${countBy(concepts, "status")}`);

  if (!opts.validateOnly) {
    const html = buildHTML(readBundleTitle(bundleRoot), graph);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, "utf8");
    console.log(
      `\nWrote viewer: ${outPath} (${html.length} bytes). Open it in a browser; libraries load from a CDN.`,
    );
  }

  if (opts.strict && issues.length) process.exit(1);
}

main();
