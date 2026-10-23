import ReportsPage from './ReportsPage';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string; source?: string }>;
}) {
  const { from, to, category, source } = await searchParams;
  return <ReportsPage requestedFrom={from} requestedTo={to} requestedCategory={category} requestedSource={source} />;
}
