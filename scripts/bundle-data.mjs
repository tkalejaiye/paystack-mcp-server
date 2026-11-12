// Converts the files in src/data into JSON modules under src/generated so the
// server can import them instead of reading from disk at runtime. This keeps the
// core runtime-agnostic (Node stdio, Cloudflare Workers, etc.).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src', 'data');
const outDir = path.join(root, 'src', 'generated');

mkdirSync(outDir, { recursive: true });

const spec = yaml.load(readFileSync(path.join(dataDir, 'paystack.openapi.yaml'), 'utf-8'));
writeFileSync(path.join(outDir, 'paystack-openapi.json'), JSON.stringify(spec));

// A top-level JSON string, so `import skill from './paystack-skill.json'` yields the raw markdown
const skill = readFileSync(path.join(dataDir, 'paystack-skill.md'), 'utf-8');
writeFileSync(path.join(outDir, 'paystack-skill.json'), JSON.stringify(skill));

// Workflows: one markdown file per workflow with YAML frontmatter. They're checked
// against the spec by test/workflows.spec.ts; see src/data/workflows/README.md.
const workflowsDir = path.join(dataDir, 'workflows');
const workflows = readdirSync(workflowsDir)
  .filter((file) => file.endsWith('.md') && file !== 'README.md')
  .sort()
  .map((file) => {
    const text = readFileSync(path.join(workflowsDir, file), 'utf-8');
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error(`${file}: missing YAML frontmatter`);
    return { file, ...yaml.load(match[1]), body: match[2].trim() };
  });
writeFileSync(path.join(outDir, 'paystack-workflows.json'), JSON.stringify(workflows));
