import { SkeletonStatus } from '@/components/PresentationFoundation';
import { ShowcaseSkeleton } from './ShowcaseSkeletons';

/** Shown the moment this page is opened, in the page's own shape, until the route arrives. */
export default function Loading() {
  return <SkeletonStatus><ShowcaseSkeleton /></SkeletonStatus>;
}
