/**
 * The scroll behaviour for a programmatic jump (a tapped figure that scrolls
 * to its list): smooth, unless the person asked the system to reduce motion.
 */
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'auto';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
