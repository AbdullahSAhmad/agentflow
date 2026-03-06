#!/usr/bin/env node

const args = process.argv.slice(2);

// ── hooks subcommand ──────────────────────────────────────────────────────────
if (args[0] === 'hooks') {
  const sub = args[1];
  async function runHooks() {
    const { installHooks, uninstallHooks, checkHookStatus } =
      await import('../packages/server/dist/hooks/hook-installer.js');

    if (sub === 'install') {
      const portIdx = args.indexOf('--port');
      const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3333;
      const result = installHooks(port);
      console.log(result.message);
      console.log(`  Script:   ${result.scriptPath}`);
      console.log(`  Settings: ${result.settingsPath}`);
    } else if (sub === 'uninstall') {
      const result = uninstallHooks();
      console.log(result.message);
    } else if (sub === 'status') {
      const status = checkHookStatus();
      if (status.installed) {
        console.log(`Hooks: installed (${status.events.length} events)`);
        console.log(`Script exists: ${status.scriptExists}`);
        console.log(`Events: ${status.events.join(', ')}`);
      } else {
        console.log('Hooks: not installed');
        console.log('Run `agent-move hooks install` to enable hook-based events.');
      }
    } else {
      console.log('Usage: agent-move hooks <install|uninstall|status> [--port <n>]');
    }
  }
  runHooks().catch((err) => { console.error(err?.message ?? err); process.exit(1); });
} else {
  // ── server (default) ────────────────────────────────────────────────────────
  const preferredPort = (() => {
    const idx = args.indexOf('--port');
    if (idx !== -1 && args[idx + 1]) {
      const p = parseInt(args[idx + 1], 10);
      if (!Number.isNaN(p) && p > 0 && p < 65536) return p;
      console.error(`Invalid port: ${args[idx + 1]}`);
      process.exit(1);
    }
    return 3333;
  })();

  process.env.AGENT_MOVE_PORT = String(preferredPort);
  process.env.__AGENT_MOVE_CLI = '1';

  async function run() {
    const { main } = await import('../packages/server/dist/index.js');
    const { port } = await main();

    if (port !== preferredPort) {
      console.log(`  Port ${preferredPort} was in use, using ${port} instead.`);
    }

    console.log();
    console.log('  ┌──────────────────────────────────────┐');
    console.log('  │                                      │');
    console.log(`  │   AgentMove running on port ${String(port).padEnd(5)}   │`);
    console.log(`  │   http://localhost:${String(port).padEnd(18)}│`);
    console.log('  │                                      │');
    console.log('  └──────────────────────────────────────┘');
    console.log();

    // Auto-open browser
    const url = `http://localhost:${port}`;
    const { exec } = await import('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"`
      : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }

  run().catch((err) => {
    console.error('Failed to start AgentMove:', err);
    process.exit(1);
  });
}
