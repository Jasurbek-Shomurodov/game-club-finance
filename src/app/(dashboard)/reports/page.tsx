import ReportsPage from './ReportsPage';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string }>;
}) {
  const { from, to, category } = await searchParams;
  return <ReportsPage requestedFrom={from} requestedTo={to} requestedCategory={category} />;
}
