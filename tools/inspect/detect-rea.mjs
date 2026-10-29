// Feature detection for REA (reverse-engineering assistant) and other local
// analysis tools. Never claims a tool ran; only reports what is reachable.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function which(cmd, args = ['--version']) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    return { available: true, version: out.split('\n')[0].trim().slice(0, 120) };
  } catch (e) {
    if (e.code === 'ENOENT') return { available: false };
    // binary exists but returned non-zero for the version flag
    return { available: true, version: String(e.stdout || e.stderr || '').split('\n')[0].trim().slice(0, 120) || 'unknown' };
  }
}

export function detectRea(root) {
  const found = [];
  const mcp = join(root, '.mcp.json');
  if (existsSync(mcp)) {
    try {
      const cfg = JSON.parse(readFileSync(mcp, 'utf8'));
      for (const name of Object.keys(cfg.mcpServers ?? {})) if (/(^|[-_])rea([-_]|$)/i.test(name)) found.push({ via: 'mcp', name, config: '.mcp.json' });
    } catch {
      /* malformed .mcp.json: ignore, report not found */
    }
  }
  if (process.env.REA_MCP_URL) found.push({ via: 'env', name: 'REA_MCP_URL' });
  const cli = which(process.env.REA_BIN || 'rea');
  if (cli.available) found.push({ via: 'cli', name: process.env.REA_BIN || 'rea', version: cli.version });
  return {
    available: found.length > 0,
    found,
    note: found.length
      ? 'REA appears configured. Confirm the tools are actually callable in this session before relying on them.'
      : 'REA not detected (no .mcp.json server named *rea*, no REA_MCP_URL, no `rea` on PATH). Continue with the deterministic tools below; see .claude/skills/use-rea/SKILL.md for connection steps.',
  };
}

export function detectTools() {
  return {
    ndisasm: which('ndisasm', ['-v']),
    objdump: which('objdump', ['--version']),
    'llvm-objdump': which('llvm-objdump', ['--version']),
    r2: which('r2', ['-v']),
    rizin: which('rizin', ['-v']),
    ghidra_headless: which('analyzeHeadless', ['-help']),
    dosbox: which('dosbox', ['--version']),
    'dosbox-x': which('dosbox-x', ['--version']),
    python3: which('python3', ['--version']),
    zig: which(process.env.ZIG || 'zig', ['version']),
  };
}
