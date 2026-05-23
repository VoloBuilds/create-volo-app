import { readFile } from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { deriveServiceSlug } from '../../utils/validation.js';

/**
 * Create a shared readline interface for user prompts
 */
export function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Promisified question function for readline
 */
export function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

/**
 * Get project name from package.json consistently across all connect scripts
 */
export async function getProjectNameFromPackageJson(projectPath: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(path.join(projectPath, 'package.json'), 'utf-8'));
  return packageJson.name || 'volo-app';
}

/**
 * Read package.json name and derive both display name and cloud service slug.
 * Use `serviceSlug` for cloud resource defaults; `name` for display messages.
 */
export async function getProjectNameAndSlugFromPackageJson(projectPath: string): Promise<{ name: string; serviceSlug: string }> {
  const name = await getProjectNameFromPackageJson(projectPath);
  return { name, serviceSlug: deriveServiceSlug(name) };
}

/**
 * Sanitize connection string for display (hide password)
 */
export function sanitizeConnectionString(connectionString: string): string {
  return connectionString.replace(/:[^:@]*@/, ':****@');
}

/**
 * Common confirmation prompt for production setup
 */
export async function confirmProductionSetup(
  rl: readline.Interface, 
  service: string
): Promise<boolean> {
  const confirm = await question(rl, `\nProceed with ${service} production setup? (Y/n): `);
  return confirm.toLowerCase() !== 'n';
}

/**
 * Common reconfiguration prompt for already configured services
 */
export async function confirmReconfiguration(
  rl: readline.Interface, 
  service: string
): Promise<boolean> {
  const shouldReconfigure = await question(rl, `\nWould you like to reconfigure ${service}? (y/N): `);
  return shouldReconfigure.toLowerCase() === 'y';
} 