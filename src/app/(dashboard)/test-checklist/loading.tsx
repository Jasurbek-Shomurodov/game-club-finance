import { SkeletonStatus } from '@/components/PresentationFoundation';
import { TestChecklistSkeleton } from './TestChecklistSkeleton';

/** Shown the moment this page is opened, in the page's own shape, until the route arrives. */
export default function Loading() {
  return <SkeletonStatus><TestChecklistSkeleton /></SkeletonStatus>;
}
