import ReportsPage from './ReportsPage';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string; source?: string; view?: string }>;
}) {
  const { from, to, category, source, view } = await searchParams;
  return <ReportsPage requestedFrom={from} requestedTo={to} requestedCategory={category} requestedSource={source} requestedView={view} />;
}
