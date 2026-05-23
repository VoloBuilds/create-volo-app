import chalk from 'chalk';
import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { setupFirebaseWithRetry } from '../shared/serviceSetup.js';
import { 
  createReadlineInterface, 
  question, 
  getProjectNameAndSlugFromPackageJson,
  confirmProductionSetup,
  confirmReconfiguration 
} from './shared.js';
import { logger } from '../../utils/logger.js';

interface FirebaseConfigResult {
  projectId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

export async function connectAuth(projectPath: string): Promise<void> {
  const rl = createReadlineInterface();
  
  try {
    console.log(chalk.cyan.bold('🔥 Firebase Auth Production Connection'));
    console.log('This will connect your volo-app to production Firebase Auth.\n');
    
    // Check current Firebase configuration
    const currentConfig = await detectCurrentFirebaseConfig(projectPath);
    
    if (currentConfig.isProduction) {
      console.log(chalk.green('✅ Already connected to production Firebase Auth'));
      console.log(chalk.gray(`   Project ID: ${currentConfig.projectId}`));
      
      if (!(await confirmReconfiguration(rl, 'with a different Firebase project'))) {
        console.log(chalk.blue('👋 No changes made'));
        return;
      }
    } else if (currentConfig.isLocal) {
      console.log(chalk.blue('🧪 Currently using Firebase emulator (local development)'));
      await checkLocalUserData(projectPath);
    } else {
      console.log(chalk.yellow('⚠️  No Firebase configuration found'));
    }
    
    // Confirm before proceeding
    if (!(await confirmProductionSetup(rl, 'Firebase Auth'))) {
      console.log(chalk.blue('👋 Operation cancelled'));
      return;
    }
    
    // Backup current configuration
    await backupFirebaseConfig(projectPath);
    
    // Get project name and service slug from package.json for consistent naming
    const { name, serviceSlug } = await getProjectNameAndSlugFromPackageJson(projectPath);
    
    // Use existing Firebase setup with retry logic from services
    console.log(chalk.blue('\n🔐 Setting up Firebase...'));
    const firebaseResult = await setupFirebaseWithRetry(2, false, serviceSlug, name);
    
    // Convert to our expected format
    const config: FirebaseConfigResult = {
      projectId: firebaseResult.projectId,
      apiKey: firebaseResult.apiKey,
      authDomain: `${firebaseResult.projectId}.firebaseapp.com`,
      storageBucket: `${firebaseResult.projectId}.appspot.com`,
      messagingSenderId: firebaseResult.messagingSenderId,
      appId: firebaseResult.appId,
      measurementId: firebaseResult.measurementId
    };
    
    // Update configuration files
    await updateFirebaseConfig(projectPath, config);
    await updateEnvironmentFiles(projectPath, config);
    
    // Clean up Firebase emulator configuration
    await cleanupFirebaseEmulatorConfig(projectPath);
    
    console.log(chalk.green('\n🎉 Successfully connected to production Firebase Auth!'));
    console.log(chalk.cyan('\n📋 Next steps:'));
    console.log('   1. Restart your development server: pnpm dev');
    console.log('   2. Test authentication with your production Firebase project');
    console.log('   3. If you had local test users, consider importing them to production');
    console.log(`      firebase auth:import data/firebase-emulator/auth_export/accounts.json --project ${config.projectId}`);
    console.log('   4. Configure authentication providers in Firebase Console if needed');
    
    console.log(chalk.blue('\n💡 To revert to local development:'));
    console.log('   - Restore backup: cp ui/src/lib/firebase-config.backup.json ui/src/lib/firebase-config.json');
    console.log('   - Update ui/.env.local: VITE_USE_FIREBASE_EMULATOR=true');
    
  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  } finally {
    rl.close();
  }
}

async function detectCurrentFirebaseConfig(projectPath: string) {
  const configPath = path.join(projectPath, 'ui', 'src', 'lib', 'firebase-config.json');
  
  if (!existsSync(configPath)) {
    return { isProduction: false, isLocal: false, projectId: null };
  }
  
  try {
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    const isLocal = config.projectId === 'demo-project';
    
    return {
      isProduction: !isLocal,
      isLocal,
      projectId: config.projectId
    };
  } catch (error) {
    return { isProduction: false, isLocal: false, projectId: null };
  }
}

async function checkLocalUserData(projectPath: string) {
  const firebaseDataPath = path.join(projectPath, 'data', 'firebase-emulator');
  
  if (existsSync(firebaseDataPath)) {
    console.log(chalk.green('✅ Local Firebase emulator data found'));
    logger.newLine();
    console.log(chalk.gray('📋 Local user data is available for manual import:'));
    console.log(chalk.gray(`   Location: ${firebaseDataPath}`));
    logger.newLine();
    console.log(chalk.gray('💡 You can import this data to your production Firebase project using:'));
    console.log(chalk.gray('   firebase auth:import data/firebase-emulator/auth_export/accounts.json --project YOUR_PROJECT_ID'));
  }
}

async function backupFirebaseConfig(projectPath: string) {
  const configPath = path.join(projectPath, 'ui', 'src', 'lib', 'firebase-config.json');
  const backupPath = path.join(projectPath, 'ui', 'src', 'lib', 'firebase-config.backup.json');
  
  if (existsSync(configPath)) {
    const config = await readFile(configPath, 'utf-8');
    await writeFile(backupPath, config);
    logger.newLine();
    console.log(chalk.green('✅ Current configuration backed up to firebase-config.backup.json'));
    logger.newLine();
  }
}

async function updateFirebaseConfig(projectPath: string, config: FirebaseConfigResult) {
  const configPath = path.join(projectPath, 'ui', 'src', 'lib', 'firebase-config.json');
  
  const firebaseConfig = {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
    ...(config.measurementId && { measurementId: config.measurementId })
  };
  
  await writeFile(configPath, JSON.stringify(firebaseConfig, null, 2));
  console.log(chalk.green('✅ Firebase configuration updated'));
}

async function updateEnvironmentFiles(projectPath: string, config: FirebaseConfigResult) {
  // Update UI environment
  const uiEnvPath = path.join(projectPath, 'ui', '.env.local');
  let uiEnvContent = '';
  
  if (existsSync(uiEnvPath)) {
    uiEnvContent = await readFile(uiEnvPath, 'utf-8');
  }
  
  // Remove emulator flag if it exists
  uiEnvContent = uiEnvContent.replace(/VITE_USE_FIREBASE_EMULATOR=.*/g, '');
  
  // Add production flag
  if (!uiEnvContent.includes('VITE_USE_FIREBASE_EMULATOR=')) {
    uiEnvContent += '\n# Production Firebase Auth\nVITE_USE_FIREBASE_EMULATOR=false\n';
  }
  
  await writeFile(uiEnvPath, uiEnvContent.trim() + '\n');
  
  // Update server environment
  const serverEnvPath = path.join(projectPath, 'server', '.env');
  let serverEnvContent = '';
  
  if (existsSync(serverEnvPath)) {
    serverEnvContent = await readFile(serverEnvPath, 'utf-8');
  }
  
  // Update or add Firebase project ID for server-side auth verification
  const projectIdPattern = /FIREBASE_PROJECT_ID=.*/g;
  if (projectIdPattern.test(serverEnvContent)) {
    serverEnvContent = serverEnvContent.replace(projectIdPattern, `FIREBASE_PROJECT_ID=${config.projectId}`);
  } else {
    serverEnvContent += `\n# Production Firebase Auth\nFIREBASE_PROJECT_ID=${config.projectId}\n`;
  }
  
  await writeFile(serverEnvPath, serverEnvContent.trim() + '\n');
  
  console.log(chalk.green('✅ Environment files updated for production Firebase'));
}

async function cleanupFirebaseEmulatorConfig(projectPath: string) {
  // Clean up .env file
  const serverEnvPath = path.join(projectPath, 'server', '.env');
  if (existsSync(serverEnvPath)) {
    let envContent = await readFile(serverEnvPath, 'utf-8');
    let hasChanges = false;

    // Remove FIREBASE_AUTH_EMULATOR_HOST line and associated comment
    const firebaseLineRegex = /^# Firebase Auth Emulator.*\nFIREBASE_AUTH_EMULATOR_HOST=.*$/m;
    const simpleFirebaseLineRegex = /^FIREBASE_AUTH_EMULATOR_HOST=.*$/m;
    
    if (firebaseLineRegex.test(envContent)) {
      envContent = envContent.replace(firebaseLineRegex, '');
      hasChanges = true;
    } else if (simpleFirebaseLineRegex.test(envContent)) {
      envContent = envContent.replace(simpleFirebaseLineRegex, '');
      hasChanges = true;
    }

    if (hasChanges) {
      // Clean up any multiple empty lines left behind
      envContent = envContent.replace(/\n\n+/g, '\n\n').trim() + '\n';
      await writeFile(serverEnvPath, envContent);
      console.log(chalk.green('✅ Removed Firebase emulator configuration from .env'));
    }
  }

  // Clean up wrangler.toml file
  const wranglerPath = path.join(projectPath, 'server', 'wrangler.toml');
  if (existsSync(wranglerPath)) {
    let wranglerContent = await readFile(wranglerPath, 'utf-8');
    let hasChanges = false;

    // Remove FIREBASE_AUTH_EMULATOR_HOST line
    const firebaseLineRegex = /^FIREBASE_AUTH_EMULATOR_HOST\s*=.*$/m;
    if (firebaseLineRegex.test(wranglerContent)) {
      wranglerContent = wranglerContent.replace(firebaseLineRegex, '');
      hasChanges = true;
    }

    if (hasChanges) {
      // Clean up any empty lines left behind
      wranglerContent = wranglerContent.replace(/\n\n+/g, '\n\n');
      await writeFile(wranglerPath, wranglerContent);
      console.log(chalk.green('✅ Removed Firebase emulator configuration from wrangler.toml'));
    }
  }
} 