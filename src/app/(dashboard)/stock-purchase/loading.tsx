import { SkeletonStatus } from '@/components/PresentationFoundation';
import { StockPurchaseSkeleton } from './StockPurchaseSkeleton';

/** Shown the moment this page is opened, in the page's own shape, until the route arrives. */
export default function Loading() {
  return <SkeletonStatus><StockPurchaseSkeleton /></SkeletonStatus>;
}
