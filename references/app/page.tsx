import { Suspense } from "react";
import { RankingBoard } from "@/components/ranking-board";
import { LoadingPanel } from "@/components/dashboard-ui";

export default function Home() {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <RankingBoard />
    </Suspense>
  );
}
