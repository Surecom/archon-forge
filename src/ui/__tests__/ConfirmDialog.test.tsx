import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ConfirmDialog from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  it('highlights what will be done and where, with an "I confirm" button', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        title="Run auto layout?"
        body="Every element on this layer will be moved."
        tone="primary"
        subject={[
          { label: 'Layer', value: 'Payments flow', color: '#10b981' },
          { label: 'Algorithm', value: 'Compact grid' },
        ]}
        warning="This layer is not the one currently open in ArchON."
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('<strong>Payments flow</strong>');
    expect(html).toContain('--af-subject-color:#10b981');
    expect(html).toContain('<strong>Compact grid</strong>');
    expect(html).toContain('not the one currently open');
    expect(html).toContain('>I confirm</button>');
    expect(html).toContain('af-btn--primary');
  });
});
