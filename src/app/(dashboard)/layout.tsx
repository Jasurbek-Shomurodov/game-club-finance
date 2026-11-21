import { DashboardShell } from '@/components/layout/DashboardShell';
import { getDashboardBootstrap } from '@/lib/supabase/dashboardBootstrap';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/PresentationFoundation';
import { APP_INSTALL_METADATA } from '@/lib/appInstall';

// The admin app can be installed on a phone's home screen; see `appInstall.ts`.
export const metadata = APP_INSTALL_METADATA;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedDashboardLayout>{children}</AuthenticatedDashboardLayout>
    </Suspense>
  );
}

/** Same frame as DashboardShell (sidebar, top bar, paddings) so nothing jumps when it arrives. */
function ShellSkeleton() {
  return (
    <div className="min-h-dvh bg-gray-50" aria-busy="true">
      <div className="fixed inset-y-0 left-0 hidden w-64 border-r border-gray-200 bg-sidebar lg:block" />
      <div className="fixed inset-x-0 top-0 h-14 border-b border-gray-200 bg-surface lg:hidden" />
      <main className="lg:pl-64">
        {/* The desktop top bar is in the flow (sticky), so it takes its 3.5rem here too. */}
        <div className="hidden h-14 lg:block" />
        <div className="w-full px-4 pb-6 pt-[4.5rem] sm:px-6 lg:px-8 lg:pb-8 lg:pt-2">
          <PageSkeleton />
        </div>
      </main>
    </div>
  );
}

async function AuthenticatedDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const bootstrap = await getDashboardBootstrap();
  if (!bootstrap) redirect('/login');

  return (
    <DashboardShell
      initialUserId={bootstrap.userId}
      initialEmail={bootstrap.initialEmail}
      initialFullName={bootstrap.initialFullName}
      initialProfileRole={bootstrap.initialRole}
      initialMembershipRows={bootstrap.initialMemberships}
      initialSelectedClubId={bootstrap.initialSelectedClubId}
    >
      {children}
    </DashboardShell>
  );
}
