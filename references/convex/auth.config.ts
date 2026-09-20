import type { AuthConfig } from "convex/server";
// Auth config is evaluated before generated runtime env is available.
// eslint-disable-next-line @convex-dev/no-process-env
const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
// Until Clerk is configured, accept no authentication provider (fail closed).
export default {
  providers: issuer ? [{ domain: issuer, applicationID: "convex" }] : [],
} satisfies AuthConfig;
