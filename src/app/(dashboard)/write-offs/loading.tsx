import { SkeletonStatus } from '@/components/PresentationFoundation';
import { WriteOffsSkeleton } from './WriteOffsSkeleton';

/** Shown the moment this page is opened, in the page's own shape, until the route arrives. */
export default function Loading() {
  return <SkeletonStatus><WriteOffsSkeleton /></SkeletonStatus>;
}
