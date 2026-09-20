"use client";
import { Button } from "@/components/ui/button";
export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-xl font-semibold">管理画面を読み込めませんでした</h1>
      <p className="text-sm text-muted-foreground">
        ログイン状態とアクセス権限を確認して、もう一度お試しください。
      </p>
      <Button variant="outline" onClick={reset}>
        もう一度試す
      </Button>
    </div>
  );
}
