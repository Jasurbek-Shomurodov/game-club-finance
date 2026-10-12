import { DashboardShell } from '@/components/layout/DashboardShell';
import { getDashboardBootstrap } from '@/lib/supabase/dashboardBootstrap';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/PresentationFoundation';

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
      <div className="fixed inset-y-0 left-0 hidden w-64 bg-sidebar lg:block" />
      <div className="fixed inset-x-0 top-0 h-14 border-b border-gray-200 bg-surface lg:hidden" />
      <main className="lg:pl-64">
        <div className="w-full px-3 pb-5 pt-16 sm:px-5 md:px-6 lg:py-6 xl:px-8 2xl:px-10">
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
