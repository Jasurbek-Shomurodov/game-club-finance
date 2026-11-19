import { SkeletonStatus } from '@/components/PresentationFoundation';
import { MoneyDetailsSkeleton } from '@/components/money-details/MoneyDetailsSkeleton';

/** Shown the moment this page is opened, in the page's own shape, until the route arrives. */
export default function Loading() {
  return <SkeletonStatus><MoneyDetailsSkeleton /></SkeletonStatus>;
}
