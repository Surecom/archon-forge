import type { LLMProvider } from './types';
import { cursorProvider } from './cursor/CursorProvider';
import { chatGptProvider, claudeCodeProvider, deepSeekProvider, onPremProvider } from './comingSoon';

/** Registration order = display order in the wizard. */
const PROVIDERS: readonly LLMProvider[] = [
  cursorProvider,
  deepSeekProvider,
  chatGptProvider,
  claudeCodeProvider,
  onPremProvider,
];

export const listProviders = (): readonly LLMProvider[] => PROVIDERS;

export const getProvider = (id: string | undefined): LLMProvider | undefined =>
  PROVIDERS.find(p => p.id === id);

export const defaultProvider = (): LLMProvider =>
  PROVIDERS.find(p => p.availability === 'available') ?? PROVIDERS[0];
