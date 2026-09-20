"use client";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { jaJP } from "@clerk/localizations";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";
const client = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
export function AdminProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      localization={jaJP}
      appearance={{ theme: shadcn }}
      signInFallbackRedirectUrl="/admin"
      signUpFallbackRedirectUrl="/admin"
    >
      <ConvexProviderWithClerk client={client} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
