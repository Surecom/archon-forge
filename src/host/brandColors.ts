/**
 * Mirror of the host's brand color tokens (client/src/theme/brandColors.ts).
 *
 * Elements and layers store either a TOKEN (`'archon-blue'`, picked from the
 * palette) or a raw custom color. A token is not a CSS color — it resolves to
 * a different hex per theme mode, so it must be resolved before painting.
 * Keep this table in sync with the host when a token is added or retuned.
 */
export type ThemeMode = 'dark' | 'light';

const BRAND_COLORS: Record<string, { dark: string; light: string }> = {
  'archon-blue':    { dark: '#3b82f6', light: '#2563eb' },
  'archon-indigo':  { dark: '#6366f1', light: '#4f46e5' },
  'archon-purple':  { dark: '#a855f7', light: '#9333ea' },
  'archon-emerald': { dark: '#10b981', light: '#059669' },
  'archon-yellow':  { dark: '#facc15', light: '#a16207' },
  'archon-amber':   { dark: '#f59e0b', light: '#b45309' },
  'archon-rose':    { dark: '#f43f5e', light: '#e11d48' },
  'archon-slate':   { dark: '#94a3b8', light: '#64748b' },
};

/** Token → hex for the theme; custom colors pass through; empty → `''` (caller decides). */
export function resolveBrandColor(value: string | null | undefined, mode: ThemeMode): string {
  if (!value) return '';
  const pair = Object.prototype.hasOwnProperty.call(BRAND_COLORS, value) ? BRAND_COLORS[value] : undefined;
  return pair ? pair[mode] : value;
}
