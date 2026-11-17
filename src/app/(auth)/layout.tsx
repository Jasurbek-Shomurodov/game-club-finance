import { APP_INSTALL_METADATA } from '@/lib/appInstall';

// Sign-in belongs to the installable admin app: someone who installs it from
// the login page gets the same icon and manifest as from the dashboard.
export const metadata = APP_INSTALL_METADATA;

export default function AuthRouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
