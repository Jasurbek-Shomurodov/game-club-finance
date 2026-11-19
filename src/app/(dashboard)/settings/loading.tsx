import { SkeletonStatus } from '@/components/PresentationFoundation';
import { SettingsSkeleton } from './SettingsSkeleton';

/** Shown the moment this page is opened, in the page's own shape, until the route arrives. */
export default function Loading() {
  return <SkeletonStatus><SettingsSkeleton /></SkeletonStatus>;
}
