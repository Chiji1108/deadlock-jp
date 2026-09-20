/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as aggregates from "../aggregates.js";
import type * as collectionState from "../collectionState.js";
import type * as collector from "../collector.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as deadlock from "../deadlock.js";
import type * as ingestion from "../ingestion.js";
import type * as maintenance from "../maintenance.js";
import type * as matchLookup from "../matchLookup.js";
import type * as model from "../model.js";
import type * as playerActivity from "../playerActivity.js";
import type * as playerActivityModel from "../playerActivityModel.js";
import type * as rankOrdering from "../rankOrdering.js";
import type * as steamLinks from "../steamLinks.js";
import type * as steamSearch from "../steamSearch.js";
import type * as time from "../time.js";
import type * as twitch from "../twitch.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  aggregates: typeof aggregates;
  collectionState: typeof collectionState;
  collector: typeof collector;
  crons: typeof crons;
  dashboard: typeof dashboard;
  deadlock: typeof deadlock;
  ingestion: typeof ingestion;
  maintenance: typeof maintenance;
  matchLookup: typeof matchLookup;
  model: typeof model;
  playerActivity: typeof playerActivity;
  playerActivityModel: typeof playerActivityModel;
  rankOrdering: typeof rankOrdering;
  steamLinks: typeof steamLinks;
  steamSearch: typeof steamSearch;
  time: typeof time;
  twitch: typeof twitch;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  duration: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"duration">;
  watched: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"watched">;
  activeDays: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"activeDays">;
};
