import type { VoloConfig } from '../../utils/config.js';

export interface CreateOptions {
  template: string;
  fast?: boolean;
  verbose: boolean;
  full?: boolean;
  auth?: boolean | string;
  database?: boolean | string;
  deploy?: boolean | string;
  config?: string;
  initConfig?: boolean;
  configData?: VoloConfig;
}

export interface ProjectConfig {
  name: string;
  directory: string;
  firebase: {
    projectId: string;
    apiKey: string;
    messagingSenderId: string;
    appId: string;
    measurementId: string;
    allowAnonymous: boolean;
  };
  database: {
    url: string;
    provider: 'neon' | 'supabase' | 'other';
  };
  cloudflare: {
    workerName: string;
  };
}

export interface AuthStatus {
  firebase: boolean;
  neon: boolean;
  supabase: boolean;
  cloudflare: boolean;
} 
