import { Fragment, useMemo } from 'react';
import { parseInline, parseMarkdown } from '@/lib/assistant/markdown';

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((segment, index) => {
        if (segment.bold) return <strong key={index} className="font-semibold text-gray-950">{segment.text}</strong>;
        if (segment.code) return <code key={index} className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em]">{segment.text}</code>;
        return <Fragment key={index}>{segment.text}</Fragment>;
      })}
    </>
  );
}

/** Renders an assistant reply. Text is never injected as HTML. */
export function AssistantMarkdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-800">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return <p key={index} className="font-semibold text-gray-950"><Inline text={block.text} /></p>;
          case 'paragraph':
            return <p key={index} className="whitespace-pre-wrap"><Inline text={block.text} /></p>;
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List key={index} className={block.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
                {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}
              </List>
            );
          }
          case 'table':
            return (
              <div key={index} className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th key={cellIndex} scope="col" className="whitespace-nowrap px-3 py-2 font-medium"><Inline text={cell} /></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="whitespace-nowrap px-3 py-2 tabular-nums"><Inline text={cell} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
