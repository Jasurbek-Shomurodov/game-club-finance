import { SkeletonStatus } from '@/components/PresentationFoundation';
import { AssistantSkeleton } from './AssistantSkeleton';

/** Shown the moment this page is opened, in the page's own shape, until the route arrives. */
export default function Loading() {
  return <SkeletonStatus><AssistantSkeleton /></SkeletonStatus>;
}
