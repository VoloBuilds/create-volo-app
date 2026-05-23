import { execa } from 'execa';
import which from 'which';
import { logger } from './logger.js';

interface CliOptions {
  stdio?: 'pipe' | 'inherit';
  timeout?: number;
  cwd?: string;
}

/**
 * Configures Git user identity if not already set
 */
async function ensureGitIdentity(cwd?: string): Promise<void> {
  const options = { stdio: 'pipe' as const, cwd };
  
  try {
    // Check if user.name is set
    await execa('git', ['config', 'user.name'], options);
  } catch {
    // Set default user.name
    await execa('git', ['config', 'user.name', 'Volo App Creator'], options);
    logger.debug('Set default git user.name');
  }
  
  try {
    // Check if user.email is set
    await execa('git', ['config', 'user.email'], options);
  } catch {
    // Set default user.email
    await execa('git', ['config', 'user.email', 'creator@volo-app.local'], options);
    logger.debug('Set default git user.email');
  }
}

/**
 * Executes a CLI command, trying global installation first, then local via npx
 */
export async function execCli(
  command: string,
  args: string[],
  options: CliOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const defaultOptions = {
    stdio: 'pipe' as const,
    timeout: 300000, // 5 minutes
    ...options
  };

  // First try global installation
  try {
    await which(command);
    logger.debug(`Using global ${command}`);
    return await execa(command, args, defaultOptions);
  } catch (globalError) {
    logger.debug(`Global ${command} not found, trying local installation`);
    
    // Try local installation via npx
    try {
      return await execa('npx', [command, ...args], defaultOptions);
    } catch (localError) {
      logger.debug(`Local ${command} via npx also failed`);
      
      // Enhanced error handling to capture stderr
      let errorMessage = `Failed to execute ${command}`;
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

/**
 * Executes Firebase CLI command
 */
export async function execFirebase(
  args: string[],
  options: CliOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  return execCli('firebase', args, options);
}

/**
 * Executes Wrangler CLI command
 */
export async function execWrangler(
  args: string[],
  options: CliOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  return execCli('wrangler', args, options);
}

/**
 * Executes Git command - Git is a system tool, not an npm package
 */
export async function execGit(
  args: string[],
  options: CliOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const defaultOptions = {
    stdio: 'pipe' as const,
    timeout: 300000, // 5 minutes
    ...options
  };

  try {
    // Git should always be available globally - it's a system tool
    await which('git');
    logger.debug(`Using global git`);
    
    // For commit commands, ensure git identity is configured
    if (args[0] === 'commit') {
      await ensureGitIdentity(defaultOptions.cwd);
    }
    
    return await execa('git', args, defaultOptions);
  } catch (error) {
    logger.debug(`Git command failed: ${error}`);
    
    // Enhanced error message for identity issues
    if (error instanceof Error && error.message.includes('Author identity unknown')) {
      throw new Error('Git identity not configured. This should have been set automatically. Please check git configuration.');
    }
    
    // Git is a system tool, not an npm package, so don't try npx
    let errorMessage = 'Git is not installed or not available in PATH';
    if (error instanceof Error) {
      errorMessage += `: ${error.message}`;
    }
    
    throw new Error(errorMessage);
  }
}

/**
 * Executes Supabase CLI command
 */
export async function execSupabase(
  args: string[],
  options: CliOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  return execCli('supabase', args, options);
}

function isMissingCommand(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Executes pnpm command, installing pnpm if necessary
 */
export async function execPnpm(
  args: string[],
  options: CliOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const defaultOptions = {
    stdio: 'pipe' as const,
    timeout: 300000, // 5 minutes
    ...options
  };

  try {
    const pnpmPath = await which('pnpm');
    logger.debug(`Using pnpm from PATH: ${pnpmPath}`);
    return await execa('pnpm', args, defaultOptions);
  } catch (error) {
    if (!isMissingCommand(error)) {
      throw error;
    }
  }

  logger.debug(`pnpm not found on PATH, trying npx`);

  try {
    return await execa('npx', ['pnpm', ...args], defaultOptions);
  } catch (error) {
    if (!isMissingCommand(error)) {
      throw error;
    }
  }

  logger.debug(`pnpm not available via npx, attempting to install pnpm`);

  // Import the installation utilities
  const { installCliTool } = await import('./prerequisites/installCLIs.js');
  const { corePrerequisites } = await import('./prerequisites/prereqList.js');

  // Find pnpm prerequisite
  const pnpmPrereq = corePrerequisites.find(p => p.command === 'pnpm');
  if (!pnpmPrereq) {
    throw new Error('pnpm prerequisite configuration not found');
  }

  // Try to install pnpm globally first, then locally if that fails
  let pnpmInstalled: 'global' | 'local' | false = false;

  try {
    pnpmInstalled = await installCliTool(pnpmPrereq, true); // Try global install
  } catch (error) {
    logger.debug(`Global pnpm installation failed: ${error}`);
  }

  if (!pnpmInstalled) {
    try {
      pnpmInstalled = await installCliTool(pnpmPrereq, false); // Try local install
    } catch (error) {
      logger.debug(`Local pnpm installation failed: ${error}`);
    }
  }

  if (!pnpmInstalled) {
    throw new Error(
      `Failed to install pnpm. Please install it manually with: npm install -g pnpm\n` +
      `Or visit: https://pnpm.io/installation`
    );
  }

  try {
    const pnpmPath = await which('pnpm');
    logger.debug(`Using newly installed pnpm: ${pnpmPath}`);
    return await execa('pnpm', args, defaultOptions);
  } catch (error) {
    if (!isMissingCommand(error)) {
      throw error;
    }
  }

  logger.debug(`Global pnpm still not found, using npx for locally installed pnpm`);

  try {
    return await execa('npx', ['pnpm', ...args], defaultOptions);
  } catch (error) {
    if (!isMissingCommand(error)) {
      throw error;
    }

    throw new Error(
      `pnpm was installed but couldn't be executed. Please restart your terminal and try again.\n` +
      `Or install pnpm globally with: npm install -g pnpm`
    );
  }
}

/**
 * Executes pnpm command in detached mode (for dev servers)
 * This spawns a process and keeps the CLI alive to handle signals properly
 */
export async function execPnpmDetached(
  args: string[],
  options: CliOptions = {}
): Promise<void> {
  const { spawn } = await import('child_process');
  
  // Determine which command to use
  let command = 'pnpm';
  let commandArgs = args;
  
  try {
    await which('pnpm');
    logger.debug(`Using global pnpm for detached execution`);
  } catch {
    logger.debug(`Global pnpm not found for detached execution`);
    
    // For detached execution, we'll use npx as fallback since we can't easily 
    // install pnpm mid-stream in a detached context
    logger.warning('pnpm not found, using npx fallback (may be slower)');
    logger.info('Consider installing pnpm globally: npm install -g pnpm');
    
    command = 'npx';
    commandArgs = ['pnpm', ...args];
  }

  return new Promise((resolve, reject) => {
    // Spawn process that continues in the same terminal
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',  // Detach on Unix for proper process group handling
      stdio: 'inherit', // Inherit stdio to stay in same terminal
      shell: true
    });

    // Handle immediate startup errors
    child.on('error', (error) => {
      reject(new Error(`Failed to start process: ${error.message}`));
    });

    // Set up signal handling to properly forward signals to child process
    let isShuttingDown = false;
    
    const gracefulShutdown = () => {
      if (child && !child.killed && !isShuttingDown) {
        isShuttingDown = true;
        logger.debug('Gracefully shutting down development server...');
        
        // First try graceful shutdown by forwarding the signal
        if (process.platform === 'win32') {
          child.kill('SIGTERM');
        } else {
          // Forward SIGTERM to the process group to allow cleanup
          try {
            if (child.pid) {
              process.kill(-child.pid, 'SIGTERM');
            } else {
              child.kill('SIGTERM');
            }
          } catch (error) {
            child.kill('SIGTERM');
          }
        }
        
        // If graceful shutdown doesn't work within 5 seconds, force kill
        setTimeout(() => {
          if (child && !child.killed) {
            logger.debug('Force killing development server...');
            if (process.platform === 'win32') {
              child.kill('SIGKILL');
            } else {
              try {
                if (child.pid) {
                  process.kill(-child.pid, 'SIGKILL');
                } else {
                  child.kill('SIGKILL');
                }
              } catch (error) {
                child.kill('SIGKILL');
              }
            }
            process.exit(1);
          }
        }, 5000);
      }
    };

    // Handle signals - keep CLI alive to properly forward them
    const signals = process.platform === 'win32' 
      ? ['SIGINT', 'SIGTERM', 'SIGBREAK']
      : ['SIGINT', 'SIGTERM'];
    
    signals.forEach(signal => {
      process.on(signal, gracefulShutdown);
    });

    // Handle child process exit
    child.on('exit', (code, signal) => {
      if (isShuttingDown) {
        // This is expected during shutdown
        logger.debug(`Development server stopped gracefully`);
        process.exit(0);
      } else if (code !== 0 && signal !== 'SIGKILL' && signal !== 'SIGTERM') {
        reject(new Error(`Process exited with code ${code}`));
      } else {
        logger.debug(`Development server stopped`);
        process.exit(code || 0);
      }
    });

    // Give the process a moment to start up, then resolve
    setTimeout(() => {
      if (!child.killed) {
        logger.debug(`Process started successfully with PID: ${child.pid}`);
        resolve();
        // Don't exit the CLI - keep it alive to handle signals
      } else {
        reject(new Error('Process failed to start'));
      }
    }, 1000);
  });
} 