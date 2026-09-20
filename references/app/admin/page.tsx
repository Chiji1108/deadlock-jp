import type { Metadata } from "next";
import { AdminProvider } from "@/components/admin-provider";
import { AdminDashboard } from "@/components/admin-dashboard";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
export const metadata: Metadata = {
  title: "管理",
  robots: { index: false, follow: false },
};
export default function AdminPage() {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  )
    return (
      <>
        <h1 className="text-xl font-semibold">管理</h1>
        <Alert>
          <AlertTitle>ログインの準備中です</AlertTitle>
          <AlertDescription>
            認証の設定が完了すると、このページから管理者としてログインできます。
          </AlertDescription>
        </Alert>
      </>
    );
  return (
    <AdminProvider>
      <AdminDashboard />
    </AdminProvider>
  );
}
