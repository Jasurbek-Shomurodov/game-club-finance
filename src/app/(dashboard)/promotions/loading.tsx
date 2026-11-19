import { SkeletonStatus } from '@/components/PresentationFoundation';
import { PromotionsSkeleton } from './PromotionsSkeleton';

/** Shown the moment this page is opened, in the page's own shape, until the route arrives. */
export default function Loading() {
  return <SkeletonStatus><PromotionsSkeleton /></SkeletonStatus>;
}
