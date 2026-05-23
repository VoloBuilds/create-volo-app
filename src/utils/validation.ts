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

/**
 * Derive a cloud-safe service slug from a display name (e.g. folder basename).
 * Use for NEW / auto-generated cloud resource names only — never for
 * `database.action: "existing"` lookups or explicit config IDs, which must
 * remain as literal values.
 */
export function deriveServiceSlug(displayName: string): string {
  return sanitizeProjectName(displayName) || 'volo-app';
}

export function sanitizeFirebaseProjectId(projectId: string): string {
  // Remove invalid characters and ensure it starts with a letter
  let sanitized = projectId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');

  // Ensure it starts with a letter
  if (sanitized && !/^[a-z]/.test(sanitized)) {
    sanitized = 'app-' + sanitized;
  }

  // Firebase project IDs must be at least 6 characters
  if (!sanitized || sanitized.length < 6) {
    sanitized = sanitized ? `app-${sanitized}` : 'app-volo';
  }
  while (sanitized.length < 6) {
    sanitized += 'o';
  }

  // Ensure reasonable length (may shorten padded IDs)
  if (sanitized.length > 30) {
    sanitized = sanitized.substring(0, 30).replace(/-+$/, '');
    while (sanitized.length < 6) {
      sanitized = sanitized.replace(/-+$/, '') + 'o';
      if (sanitized.length > 30) {
        sanitized = sanitized.substring(0, 30).replace(/-+$/, '');
      }
    }
  }

  return sanitized;
}

export function sanitizeWorkerName(name: string): string {
  return sanitizeProjectName(name);
}

export function sanitizeInput(input: string): string {
  // General input sanitization - remove potentially dangerous characters
  return input.trim().replace(/[<>\"'&]/g, '');
}

/** Resolve a cloud DB project from volo-config `database.projectName` (name or id). */
export function resolveExistingDatabaseProject<T extends { id: string; name: string }>(
  projects: T[],
  configProjectName: string | undefined,
  providerLabel: string
): T {
  if (!configProjectName?.trim()) {
    throw new Error(
      `database.action is "existing" but database.projectName is required in volo-config.json to select a ${providerLabel} project non-interactively.`
    );
  }

  const needle = configProjectName.trim();
  const byId = projects.find((p) => p.id === needle);
  if (byId) {
    return byId;
  }

  const byExactName = projects.find((p) => p.name === needle);
  if (byExactName) {
    return byExactName;
  }

  const byInsensitiveName = projects.find((p) => p.name.toLowerCase() === needle.toLowerCase());
  if (byInsensitiveName) {
    return byInsensitiveName;
  }

  const available = projects.map((p) => `"${p.name}" (${p.id})`).join(', ');
  throw new Error(
    `No ${providerLabel} project matched database.projectName "${needle}". Available: ${available || '(none)'}`
  );
} 