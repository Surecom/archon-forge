import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Markdown from '../Markdown';

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('Markdown', () => {
  it('renders GFM blocks', () => {
    const html = render('## Done\n\n- **Payments** added\n- `orders-api` updated\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<h2>Done</h2>');
    expect(html).toContain('<strong>Payments</strong>');
    expect(html).toContain('<code>orders-api</code>');
    expect(html).toContain('<div class="af-md__table"><table>');
  });

  it('opens links in a new tab and drops script URLs', () => {
    const html = render('[docs](https://archon.su) [x](javascript:alert(1))');
    expect(html).toContain('href="https://archon.su"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('javascript:');
  });

  it('does not render raw HTML from the model', () => {
    const html = render('<img src=x onerror="alert(1)"> text');
    expect(html).not.toContain('<img');
    expect(html).toContain('text');
  });
});
