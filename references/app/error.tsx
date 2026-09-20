"use client";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <Empty role="alert">
      <EmptyHeader>
        <EmptyTitle>
          <h1>データを読み込めませんでした</h1>
        </EmptyTitle>
        <EmptyDescription>
          接続を確認して、もう一度お試しください。
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={reset}>
          再読み込み
        </Button>
      </EmptyContent>
    </Empty>
  );
}
