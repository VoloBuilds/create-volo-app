export interface CreateOptions {
  template: string;
  branch?: string;
  db?: string;
  fast?: boolean;
  skipPrereqs: boolean;
  verbose: boolean;
  databasePreference?: string;
  full?: boolean;
  auth?: boolean | string;
  database?: boolean | string;
  deploy?: boolean;
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