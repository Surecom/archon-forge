/**
 * Per-user, per-browser settings. Credentials must never enter the project
 * file (it is shared with collaborators), so they live in `localStorage`
 * rather than in `pluginData`.
 */
import { getProvider } from '../providers/registry';
import { isHttpUrl } from '../providers/cursor/CursorProvider';
import { authMethodOf, missingRequiredFields, ProviderCredentials } from '../providers/types';

const KEY = 'archon-forge.settings';
const VERSION = 2;

export interface ForgeSettings {
  version: typeof VERSION;
  providerId: string;
  model?: string;
  credentials: ProviderCredentials;
  savedAt: number;
}

/** v1 settings belonged to the removed GigaChat provider — start over. */
export function loadSettings(): ForgeSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ForgeSettings>;
    return parsed.version === VERSION && parsed.providerId && parsed.credentials ? parsed as ForgeSettings : null;
  } catch {
    return null;
  }
}

export function saveSettings(settings: ForgeSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* quota or disabled storage */ }
}

export function createSettings(providerId: string, credentials: ProviderCredentials, model?: string): ForgeSettings {
  return { version: VERSION, providerId, credentials, model, savedAt: Date.now() };
}

/** Every value of the active auth method that is a URL must parse as http(s). */
const urlFieldsValid = (providerId: string, credentials: ProviderCredentials): boolean => {
  const provider = getProvider(providerId);
  if (!provider) return false;
  return authMethodOf(provider, credentials.authMethod).fields
    .filter(f => f.kind === 'url')
    .every(f => !(credentials.values[f.key] ?? '').trim() || isHttpUrl(credentials.values[f.key].trim()));
};

export function isValid(settings: ForgeSettings | null): settings is ForgeSettings {
  if (!settings) return false;
  const provider = getProvider(settings.providerId);
  if (!provider || provider.availability !== 'available') return false;
  if (provider.modelSelection !== 'none' && !settings.model) return false;
  return missingRequiredFields(provider, settings.credentials).length === 0
    && urlFieldsValid(settings.providerId, settings.credentials);
}
