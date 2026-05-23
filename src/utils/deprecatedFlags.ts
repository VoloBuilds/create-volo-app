const DEPRECATED_CLI_FLAGS: Readonly<Record<string, string>> = {
  '--status':
    'Run from your project directory instead: npx create-volo-app --connect',
  '--path':
    'Connect mode uses the current working directory — cd into your project first.',
  '--branch':
    'Pass the branch on --template instead: --template <url>#branch',
  '--db':
    'Use --database instead (e.g. --database neon).',
  '--skip-prereqs':
    'Set "options": { "skipPrereqs": true } in volo-config.json.',
  '--install-deps':
    'Use --fast or --config; missing CLI tools are installed automatically.',
  '--local-template':
    'Use --template with a local path.',
  '--non-interactive':
    'Use --fast or --config ./volo-config.json.',
  '--no-start':
    'This flag was removed. After scaffolding, run pnpm run dev in your project.',
};

/**
 * Fail fast when argv contains removed CLI flags (Commander would ignore them).
 */
export function assertNoDeprecatedCliFlags(argv: string[] = process.argv): void {
  const args = argv.slice(2);

  for (const arg of args) {
    for (const [flag, replacement] of Object.entries(DEPRECATED_CLI_FLAGS)) {
      if (arg === flag || arg.startsWith(`${flag}=`)) {
        throw new Error(`The ${flag} flag was removed. ${replacement}`);
      }
    }
  }
}
