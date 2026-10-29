/**
 * Lightweight RAG retriever over company policy documents (srv/knowledge/*.md).
 * Documents are chunked by heading and ranked with BM25 - no vector DB needed for
 * a corpus this size, and results are fully deterministic/explainable.
 * (Swap in SAP HANA Cloud Vector Engine + embeddings for large corpora.)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'knowledge');
const STOP = new Set('a an and are as at be by for from has in is it its of on or that the to was were will with must may can this these those not any all our your'.split(' '));
const tokenize = (s) => s.toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)).map((t) => t.replace(/(ing|ed|es|s)$/, ''));

let INDEX = null;

function build() {
  const chunks = [];
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(DIR, file), 'utf8');
    const docTitle = (/^# (.+)$/m.exec(text) || [, file])[1];
    const parts = text.split(/^## /m).slice(1);
    for (const p of parts) {
      const [heading, ...body] = p.split('\n');
      const content = body.join('\n').trim();
      chunks.push({ id: `${file}#${heading.trim().toLowerCase().replace(/\W+/g, '-')}`, file, docTitle, heading: heading.trim(), content, tokens: tokenize(heading + ' ' + heading + ' ' + content) });
    }
  }
  const df = {};
  chunks.forEach((c) => new Set(c.tokens).forEach((t) => (df[t] = (df[t] || 0) + 1)));
  const avgdl = chunks.reduce((s, c) => s + c.tokens.length, 0) / chunks.length;
  INDEX = { chunks, df, avgdl, N: chunks.length };
}

function search(query, k = 3) {
  if (!INDEX) build();
  const { chunks, df, avgdl, N } = INDEX;
  const q = tokenize(query);
  const k1 = 1.4, b = 0.75;
  return chunks
    .map((c) => {
      const tf = {};
      c.tokens.forEach((t) => (tf[t] = (tf[t] || 0) + 1));
      let score = 0;
      for (const t of q) {
        if (!tf[t]) continue;
        const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
        score += idf * ((tf[t] * (k1 + 1)) / (tf[t] + k1 * (1 - b + (b * c.tokens.length) / avgdl)));
      }
      return { id: c.id, title: `${c.docTitle} › ${c.heading}`, content: c.content, score: Math.round(score * 100) / 100 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k);
}

module.exports = { search };
