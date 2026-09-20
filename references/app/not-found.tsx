import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyContent,
} from "@/components/ui/empty";
export default function NotFound() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          <h1>ページが見つかりません</h1>
        </EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link href="/">配信者一覧へ戻る</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
