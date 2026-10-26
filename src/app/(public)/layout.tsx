import { Unbounded } from 'next/font/google';
import './showcase.css';

// A wide display face for headings on the public page only; it covers Cyrillic too.
const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], variable: '--font-display', display: 'swap' });

export default function PublicClubLayout({ children }: { children: React.ReactNode }) {
  return <div className={unbounded.variable}>{children}</div>;
}
