'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type DetailedHTMLProps, type HTMLAttributes } from 'react';

// The figure is drawn with its own tags rather than spans, so a page's broad
// span rules can never resize or space out the digit strips.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- JSX element types can only be widened through this namespace.
  namespace JSX {
    interface IntrinsicElements {
      'roll-text': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      'roll-chars': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      'roll-char': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      'roll-digit': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      'roll-strip': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

/** How long one roll takes; the roll-strip transition in globals.css uses the same duration. */
const ROLL_MS = 900;
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** The characters of a formatted figure, keyed from the right so a digit keeps its column when the figure grows or shrinks. */
export function rollingColumns(text: string) {
  const chars = [...text];
  return chars.map((char, index) => ({ key: chars.length - index, char, digit: /[0-9]/.test(char) ? Number(char) : null }));
}

/**
 * One digit as a strip of 0–9 that slides to its value: up from 0 when it
 * appears, up or down when it changes. Once it has arrived the strip is swapped
 * for the plain digit, so a resting figure is drawn exactly like text.
 */
function RollingDigit({ digit, column }: { digit: number; column: number }) {
  const [shown, setShown] = useState(0);
  const [settled, setSettled] = useState(false);
  const at = useRef(0);
  const delay = Math.min(column, 8) * 35;
  useLayoutEffect(() => {
    setSettled(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Two frames: the browser must paint the strip where it is before a move can be animated.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const still = at.current === digit || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        at.current = digit;
        setShown(digit);
        // Nothing to roll (or no motion wanted): rest now. Otherwise rest when the
        // slide ends, or once its time is up, since a cut-short slide never reports an end.
        if (still) setSettled(true);
        else timer = setTimeout(() => setSettled(true), ROLL_MS + delay + 100);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [digit, delay]);
  // React does not map onTransitionEnd onto custom elements, so listen directly.
  const strip = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = strip.current;
    const rest = () => setSettled(true);
    node?.addEventListener('transitionend', rest);
    return () => node?.removeEventListener('transitionend', rest);
  }, [settled]);
  if (settled) return <roll-digit><roll-char>{digit}</roll-char></roll-digit>;
  return (
    <roll-digit>
      <roll-strip ref={strip} style={{ transform: `translateY(-${shown * 10}%)`, '--roll-delay': `${delay}ms` } as CSSProperties}>
        {DIGITS.map((item) => <roll-char key={item}>{item}</roll-char>)}
      </roll-strip>
    </roll-digit>
  );
}

/**
 * An already formatted figure (money, a percentage, a count) whose digits roll
 * into place like an odometer and roll up or down when it changes. Signs and
 * separators stay put; screen readers and reduced motion get the final text only.
 */
export function RollingText({ text }: { text: string }) {
  return (
    <roll-text>
      <roll-chars aria-hidden="true">
        {rollingColumns(text).map(({ key, char, digit }) => (
          digit === null
            ? <roll-char key={`c${key}`}>{char}</roll-char>
            : <RollingDigit key={`d${key}`} digit={digit} column={key} />
        ))}
      </roll-chars>
      <span className="sr-only">{text}</span>
    </roll-text>
  );
}
