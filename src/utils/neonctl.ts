import { execa } from 'execa';
import which from 'which';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs-extra';
import os from 'os';
import { logger } from './logger.js';

// Get the directory of this package (create-volo-app)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '../../'); // Go up from dist/utils to package root

interface ExecResult {
  stdout: string;
  stderr: string;
}

interface CliOptions {
  stdio?: 'pipe' | 'inherit';
  timeout?: number;
  cwd?: string;
}

/**
 * Get a working directory that has a package.json file
 * This prevents neonctl from hanging when no package.json is present
 */
async function getWorkingDirectoryWithPackageJson(): Promise<string> {
  // First, try to use the create-volo-app package root
  const packageJsonPath = join(packageRoot, 'package.json');
  if (await fs.pathExists(packageJsonPath)) {
    logger.debug(`Using package root as working directory: ${packageRoot}`);
    return packageRoot;
  }
  
  // Fallback: create a temporary directory with minimal package.json
  const tempDir = join(os.tmpdir(), 'create-volo-app-neonctl');
  await fs.ensureDir(tempDir);
  
  const tempPackageJson = join(tempDir, 'package.json');
  if (!(await fs.pathExists(tempPackageJson))) {
    await fs.writeJson(tempPackageJson, {
      name: 'temp-neonctl-context',
      version: '1.0.0',
      private: true
    });
    logger.debug(`Created temporary package.json at: ${tempDir}`);
  }
  
  return tempDir;
}

/**
 * Execute neonctl command with the given arguments
 * Uses the same pattern as execCli with global/npx fallback
 * @param args Command arguments to pass to neonctl
 * @param options Execution options
 */
export async function execNeonctl(args: string[], options: CliOptions = {}): Promise<ExecResult> {
  // Get a working directory with package.json to prevent hanging
  const workingDir = await getWorkingDirectoryWithPackageJson();
  
  const defaultOptions = {
    stdio: 'pipe' as const,
    timeout: 300000, // 5 minutes
    cwd: workingDir,
    killSignal: 'SIGTERM', // Ensure process can be killed on timeout
    ...options
  };

  logger.debug(`Executing neonctl with args: ${args.join(' ')} from directory: ${workingDir}`);

  // First try global installation
  try {
    await which('neonctl');
    logger.debug(`Using global neonctl`);
    return await execa('neonctl', args, defaultOptions);
  } catch (globalError) {
    logger.debug(`Global neonctl not found, trying local installation`);
    
    // Try local installation via npx
    try {
      return await execa('npx', ['neonctl', ...args], defaultOptions);
    } catch (localError) {
      logger.debug(`Local neonctl via npx also failed`);
      
      // Enhanced error handling to capture stderr
      let errorMessage = `Failed to execute neonctl`;
      if (localError instanceof Error) {
        errorMessage += `: ${localError.message}`;
        
        // If it's an execa error, it might have stdout/stderr
        if ('stderr' in localError && localError.stderr) {
          errorMessage += `\nStderr: ${localError.stderr}`;
        }
        if ('stdout' in localError && localError.stdout) {
          errorMessage += `\nStdout: ${localError.stdout}`;
        }
      }
      
      const enhancedError = new Error(errorMessage);
      // Preserve original error properties
      if (localError instanceof Error && 'stderr' in localError) {
        (enhancedError as any).stderr = localError.stderr;
      }
      if (localError instanceof Error && 'stdout' in localError) {
        (enhancedError as any).stdout = localError.stdout;
      }
      
      throw enhancedError;
    }
  }
} 