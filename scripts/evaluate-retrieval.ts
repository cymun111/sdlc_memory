import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluateRetrieval } from './retrieval-evaluation.js';

const args = process.argv.slice(2);
if (args.some((arg, index) => index % 2 === 0 && !['--output', '--fixture'].includes(arg)) || args.length % 2) throw new Error('Usage: evaluate-retrieval [--output file] [--fixture file]');
const options = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  if (options.has(args[index]!)) throw new Error('Duplicate evaluator option');
  options.set(args[index]!, args[index + 1]!);
}
const output = path.resolve(options.get('--output') ?? '.runtime/retrieval-evaluation/v1.json');
const report = await evaluateRetrieval(options.get('--fixture'));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, fixture_version: report.fixture_version, tasks: report.cases.length, safety: report.safety, targets: report.targets, totals: report.totals }, null, 2));
// Quality targets are observations until AEF-009/010. Safety and contract failures are CI gates.
if (!report.safety.passed) process.exitCode = 1;
