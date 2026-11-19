import { SkeletonStatus } from '@/components/PresentationFoundation';
import { DebtsSkeleton } from './DebtsSkeleton';

/** Shown the moment this page is opened, in the page's own shape, until the route arrives. */
export default function Loading() {
  return <SkeletonStatus><DebtsSkeleton /></SkeletonStatus>;
}
