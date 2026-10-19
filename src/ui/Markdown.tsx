/**
 * Renders a model reply as Markdown (GFM: tables, task lists, strikethrough,
 * autolinks). Raw HTML in the reply is NOT rendered — react-markdown escapes
 * it — and its default URL transform drops `javascript:` and similar schemes.
 * Partial Markdown while a reply streams in renders as-is and settles once
 * the closing markers arrive.
 */
import React, { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} className="af-link" target="_blank" rel="noopener noreferrer" />,
  table: ({ node: _node, ...props }) => (
    <div className="af-md__table">
      <table {...props} />
    </div>
  ),
  input: ({ node: _node, ...props }) => <input {...props} disabled />,
};

const PLUGINS = [remarkGfm];

const Markdown: React.FC<{ text: string }> = ({ text }) => (
  <div className="af-md">
    <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  </div>
);

export default memo(Markdown);
