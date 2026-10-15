'use client';

import { AssistantMarkdown as SafeMarkdown, type MarkdownComponents } from 'hoggish-assistant/react';

const components: MarkdownComponents = {
  heading: ({ children }) => <p className="font-semibold text-gray-950">{children}</p>,
  paragraph: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
  list: ({ ordered, children }) => (ordered
    ? <ol className="list-decimal space-y-1 pl-5">{children}</ol>
    : <ul className="list-disc space-y-1 pl-5">{children}</ul>),
  listItem: ({ children }) => <li>{children}</li>,
  table: ({ header, rows }) => (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            {header.map((cell, index) => (
              <th key={index} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="whitespace-nowrap px-3 py-2 tabular-nums">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
  code: ({ text }) => <pre className="overflow-x-auto rounded-xl bg-gray-100 p-3 text-[13px]"><code>{text}</code></pre>,
  bold: ({ children }) => <strong className="font-semibold text-gray-950">{children}</strong>,
  inlineCode: ({ children }) => <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em]">{children}</code>,
};

/** Renders an assistant reply with the app's styles. Text is never injected as HTML. */
export function AssistantMarkdown({ source }: { source: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-800">
      <SafeMarkdown text={source} components={components} />
    </div>
  );
}
