export function validateFirebaseProjectId(projectId: string): boolean {
  // Firebase project IDs should be:
  // - 6-30 characters
  // - lowercase letters, numbers, and hyphens only
  // - start with letter
  // - not end with hyphen
  const regex = /^[a-z][a-z0-9-]*[a-z0-9]$/;
  return projectId.length >= 6 && projectId.length <= 30 && regex.test(projectId);
}

export function validateWorkerName(name: string): boolean {
  // Cloudflare Worker names should be:
  // - lowercase
  // - contain only letters, numbers, and hyphens
  // - not start or end with hyphen
  const regex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  return name.length > 0 && name.length <= 63 && regex.test(name);
}

export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function validateEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// Sanitization functions
export function sanitizeProjectName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

export function sanitizeFirebaseProjectId(projectId: string): string {
  // Remove invalid characters and ensure it starts with a letter
  let sanitized = projectId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  
  // Ensure it starts with a letter
  if (sanitized && !/^[a-z]/.test(sanitized)) {
    sanitized = 'app-' + sanitized;
  }
  
  // Ensure reasonable length
  if (sanitized.length > 30) {
    sanitized = sanitized.substring(0, 30).replace(/-+$/, '');
  }
  
  return sanitized;
}

export function sanitizeWorkerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

export function sanitizeInput(input: string): string {
  // General input sanitization - remove potentially dangerous characters
  return input.trim().replace(/[<>\"'&]/g, '');
} 