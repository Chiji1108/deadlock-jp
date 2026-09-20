import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { LastObserved } from "@/components/dashboard-ui";
import { Separator } from "@/components/ui/separator";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
export const metadata: Metadata = {
  title: {
    default: "Deadlock 日本語Twitch配信者ボード",
    template: "%s | Deadlock 日本語Twitch配信者ボード",
  },
  description:
    "日本語Deadlock配信者の配信時間・視聴者数・配信状況を確認できます。",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className={geist.variable}>
      <body>
        <ConvexClientProvider>
          <TooltipProvider>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:bg-background focus:p-3"
            >
              本文へ移動
            </a>
            <header className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
              <Link href="/" className="text-sm font-semibold tracking-tight">
                Deadlock 日本語Twitch配信者ボード
              </Link>
              <nav aria-label="メインナビゲーション">
                <Button asChild variant="ghost" size="sm">
                  <Link href="/about">データについて</Link>
                </Button>
              </nav>
            </header>
            <Separator />
            <main
              id="main"
              className="mx-auto flex min-h-[calc(100svh-140px)] max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6"
            >
              {children}
            </main>
            <footer className="mx-auto max-w-6xl px-4 pb-6 sm:px-6">
              <Separator />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <p>
                  <LastObserved />
                </p>
                <p>
                  ©{" "}
                  <a
                    href="https://www.twitch.tv/miri_ch_"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    ミリちゃんねる
                  </a>
                </p>
              </div>
            </footer>
          </TooltipProvider>
        </ConvexClientProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
