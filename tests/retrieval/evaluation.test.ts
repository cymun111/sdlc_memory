import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('runs the versioned multi-repository baseline through service and MCP and reports honest quality gates', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'retrieval-evaluation-test-'));
  try {
    const output = path.join(temporary, 'report.json');
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/evaluate-retrieval.ts', '--output', output], { encoding: 'utf8', timeout: 120000 });
    const report = JSON.parse(await readFile(output, 'utf8'));
    expect(report.fixture_version).toBe('1.0.0');
    expect(report.cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(report.cases.map((item: any) => item.id)).size).toBe(report.cases.length);
    expect(report.safety.passed).toBe(true);
    expect(report.safety.unauthorized_exposures).toBe(0);
    expect(report.safety.interface_mismatches).toBe(0);
    expect(report.safety.expectation_failures).toEqual([]);
    expect(report.targets.mandatory_policy_recall.target).toBe(1);
    expect(report.targets.relevant_record_coverage.target).toBe(0.9);
    // Annotated synonym tasks intentionally expose the strict-AND baseline's gaps.
    expect(report.targets.relevant_record_coverage.met).toBe(false);
    expect(report.cases.some((item: any) => item.regressions.length > 0)).toBe(true);
    for (const item of report.cases) {
      expect(item.annotation.length).toBeGreaterThan(10);
      expect(item.service.calls).toBe(1);
      expect(item.mcp.calls).toBe(1);
      expect(item.service.bytes).toBeGreaterThan(0);
      expect(item.mcp.latency_ms).toBeGreaterThanOrEqual(0);
      expect(item.full_document.calls).toBeGreaterThanOrEqual(1);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}, 120000);
