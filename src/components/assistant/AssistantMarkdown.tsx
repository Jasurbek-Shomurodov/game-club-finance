'use client';

import { cloneElement, Fragment, isValidElement, useMemo, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AssistantMarkdown as SafeMarkdown, type MarkdownComponents } from 'hoggish-assistant/react';
import { Skeleton } from '@/components/PresentationFoundation';
import { isChartLanguage, parseChartSpec, withoutOpenChartFence } from '@/lib/assistant/chartSpec';
import { splitMarkdownLinks, type CanOpenPath } from '@/lib/assistant/markdownLinks';

// Recharts loads only when an answer has a chart; the placeholder keeps the chart's footprint.
const AssistantChart = dynamic(() => import('./AssistantChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-48 w-full rounded-xl sm:h-56" />,
});

/** A ```chart block: drawn when its spec is valid, otherwise nothing (never raw JSON or an error). */
function ChartBlock({ text }: { text: string }) {
  const spec = useMemo(() => parseChartSpec(text), [text]);
  return spec ? <AssistantChart spec={spec} /> : null;
}

/** Text with its `[label](/path)` links to pages the member may open made clickable; see splitMarkdownLinks. */
function linkText(text: string, canOpen: CanOpenPath): ReactNode {
  const segments = splitMarkdownLinks(text, canOpen);
  if (segments.length === 1 && segments[0].type === 'text') return segments[0].text;
  return segments.map((segment, index) => (segment.type === 'text'
    ? <Fragment key={index}>{segment.text}</Fragment>
    : (
      <Link key={index} href={segment.href} prefetch={false} className="font-medium text-primary-700 underline decoration-primary-300 underline-offset-2 hover:decoration-primary-700">
        {segment.label}
      </Link>
    )));
}

/** Applies linkText to the text inside the inline nodes the Markdown package renders. */
function withLinks(node: ReactNode, canOpen: CanOpenPath): ReactNode {
  if (typeof node === 'string') return linkText(node, canOpen);
  if (Array.isArray(node)) return node.map((child, index) => <Fragment key={index}>{withLinks(child, canOpen)}</Fragment>);
  if (isValidElement(node) && node.type === Fragment) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    return cloneElement(element, undefined, withLinks(element.props.children, canOpen));
  }
  return node;
}

function markdownComponents(canOpen: CanOpenPath): MarkdownComponents {
  const linked = (node: ReactNode) => withLinks(node, canOpen);
  return {
    heading: ({ children }) => <p className="font-semibold text-gray-950">{linked(children)}</p>,
    paragraph: ({ children }) => <p className="whitespace-pre-wrap">{linked(children)}</p>,
    list: ({ ordered, children }) => (ordered
      ? <ol className="list-decimal space-y-1 pl-5">{children}</ol>
      : <ul className="list-disc space-y-1 pl-5">{children}</ul>),
    listItem: ({ children }) => <li>{linked(children)}</li>,
    table: ({ header, rows }) => (
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              {header.map((cell, index) => (
                <th key={index} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{linked(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="whitespace-nowrap px-3 py-2 tabular-nums">{linked(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    code: ({ language, text }) => (isChartLanguage(language) ? <ChartBlock text={text} /> : <pre className="overflow-x-auto rounded-xl bg-gray-100 p-3 text-[13px]"><code>{text}</code></pre>),
    bold: ({ children }) => <strong className="font-semibold text-gray-950">{linked(children)}</strong>,
    inlineCode: ({ children }) => <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em]">{children}</code>,
  };
}

/**
 * Renders an assistant reply with the app's styles. Text is never injected as
 * HTML, and only links to the assistant's listed pages that the member may
 * open (`canOpen`, the member's own canAccessPath) become clickable. A valid
 * ```chart block is drawn as a chart; one still streaming is held back.
 */
export function AssistantMarkdown({ source, canOpen }: { source: string; canOpen: CanOpenPath }) {
  const components = useMemo(() => markdownComponents(canOpen), [canOpen]);
  const text = useMemo(() => withoutOpenChartFence(source), [source]);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-800">
      <SafeMarkdown text={text} components={components} />
    </div>
  );
}
