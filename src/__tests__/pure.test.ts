import { describe, expect, it } from 'vitest';
import { readSse } from '../providers/sse';
import { countChanges } from '../chat/changes';
import { createTranslator } from '../i18n';
import { toModelTools } from '../chat/tools';
import { contextBlock } from '../chat/systemPrompt';

const streamOf = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach(c => controller.enqueue(encoder.encode(c)));
      controller.close();
    },
  });
};

describe('readSse', () => {
  it('parses events split across chunks and skips comments', async () => {
    const out = [];
    for await (const m of readSse(streamOf(['event: text\ndata: {"te', 'xt":"hi"}\n\n: ping\n\n', 'event: done\ndata: {}\n\n']))) out.push(m);
    expect(out).toEqual([{ event: 'text', data: '{"text":"hi"}' }, { event: 'done', data: '{}' }]);
  });
});

describe('countChanges', () => {
  it('ignores layer-visibility and containerIds bookkeeping', () => {
    expect(countChanges([
      { kind: 'addSystem', payload: { id: 's1' } },
      { kind: 'addContainer', payload: { id: 'c1' } },
      { kind: 'updateSystem', payload: { id: 's1', containerIds: ['c1'] } },
      { kind: 'updateLayer', payload: { id: 'L1', visibleElementIds: ['s1', 'c1'] } },
    ])).toBe(2);
  });

  it('counts a layer change that is not just visibility', () => {
    expect(countChanges([{ kind: 'updateLayer', payload: { id: 'L1', name: 'Flows' } }])).toBe(1);
  });
});

describe('translator', () => {
  it('uses all three Russian plural forms', () => {
    const { tp } = createTranslator('ru');
    expect(tp('chat.toolCalls', 1)).toBe('1 вызов инструмента');
    expect(tp('chat.toolCalls', 3)).toBe('3 вызова инструментов');
    expect(tp('chat.toolCalls', 11)).toBe('11 вызовов инструментов');
    expect(tp('chat.toolCalls', 21)).toBe('21 вызов инструмента');
  });

  it('interpolates parameters', () => {
    expect(createTranslator('en').t('wizard.step', { current: 2, total: 3 })).toBe('Step 2 of 3');
  });
});

describe('toModelTools', () => {
  it('hides auto layout and turn plumbing from the model', () => {
    const names = toModelTools(['add_systems', 'auto_layout', 'load_project_state', 'get_operations', 'create_project']
      .map(name => ({ name, description: '', inputSchema: {} }))).map(t => t.name);
    expect(names).toEqual(['add_systems']);
  });
});

describe('contextBlock', () => {
  it('carries the layer and the host UI language on every message', () => {
    const block = contextBlock({ name: 'Payments' }, 'en');
    expect(block).toContain('Current integration layer: "Payments".');
    expect(block).toContain('UI language: English (en).');
  });

  it('names Russian when the host UI is Russian', () => {
    expect(contextBlock(null, 'ru')).toContain('UI language: Russian (ru).');
  });
});
