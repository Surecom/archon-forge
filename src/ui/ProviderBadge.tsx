import React from 'react';
import type { LLMProvider } from '../providers/types';

/** Monogram on the provider's brand color — brand identity, not themed chrome. */
const ProviderBadge: React.FC<{ provider: LLMProvider; size?: number }> = ({ provider, size = 20 }) => (
  <span
    className="af-badge"
    aria-hidden="true"
    style={{ width: size, height: size, background: provider.brandColor, fontSize: Math.round(size * 0.5) }}
  >
    {provider.monogram}
  </span>
);

export default ProviderBadge;
