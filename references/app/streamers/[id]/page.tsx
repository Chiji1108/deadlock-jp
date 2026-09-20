import { Suspense } from "react";
import { StreamerDetail } from "@/components/streamer-detail";
import { LoadingPanel } from "@/components/dashboard-ui";
export default async function StreamerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<LoadingPanel />}>
      <StreamerDetail twitchId={id} />
    </Suspense>
  );
}
