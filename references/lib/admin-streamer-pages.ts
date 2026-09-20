import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import type { api } from "../convex/_generated/api";

type Page = FunctionReturnType<typeof api.admin.streamers>;
type FetchPage = (
  args: FunctionArgs<typeof api.admin.streamers>,
) => Promise<Page>;
type State = {
  search: string;
  unlinkedOnly: boolean;
  results: Page["page"];
  status: "LoadingFirstPage" | "LoadingMore" | "CanLoadMore" | "Exhausted";
  error: string;
  updatedAt: number | null;
};

// A mounted admin view owns these snapshots. No polling or persistent subscription.
export class AdminStreamerPages {
  private state: State = {
    search: "",
    unlinkedOnly: false,
    results: [],
    status: "LoadingFirstPage",
    error: "",
    updatedAt: null,
  };
  private cursor: string | null = null;
  private generation = 0;
  private listeners = new Set<() => void>();

  constructor(
    private fetchPage: FetchPage,
    private pageSize: number,
    unlinkedOnly = false,
  ) {
    this.state = { ...this.state, unlinkedOnly };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: State) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  // Ignore late responses after search/refresh/unmount, including failed requests.
  cancel = () => {
    this.generation++;
  };
  refresh = () => this.searchFor(this.state.search);
  setUnlinkedOnly = (unlinkedOnly: boolean) =>
    this.searchFor(this.state.search, unlinkedOnly);
  searchFor = async (
    search: string,
    unlinkedOnly = this.state.unlinkedOnly,
  ) => {
    const generation = ++this.generation;
    this.cursor = null;
    this.publish({
      search,
      unlinkedOnly,
      results: [],
      status: "LoadingFirstPage",
      error: "",
      updatedAt: null,
    });
    await this.load(generation, false);
  };
  loadMore = async () => {
    if (this.state.status !== "CanLoadMore") return;
    this.publish({ ...this.state, status: "LoadingMore", error: "" });
    await this.load(this.generation, true);
  };

  private async load(generation: number, append: boolean) {
    try {
      const page = await this.fetchPage({
        search: this.state.search,
        ...(this.state.unlinkedOnly ? { unlinkedOnly: true } : {}),
        paginationOpts: { numItems: this.pageSize, cursor: this.cursor },
      });
      if (generation !== this.generation) return;
      // LIVE ordering can move between independent requests. Do not show duplicates.
      const rows = new Map(
        this.state.results.map((row) => [row.twitchId, row]),
      );
      page.page.forEach((row) => rows.set(row.twitchId, row));
      this.cursor = page.continueCursor;
      this.publish({
        ...this.state,
        results: [...rows.values()],
        status: page.isDone ? "Exhausted" : "CanLoadMore",
        error: "",
        updatedAt: append ? this.state.updatedAt : Date.now(),
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({
        ...this.state,
        status: append ? "CanLoadMore" : "Exhausted",
        error:
          error instanceof ConvexError && typeof error.data === "string"
            ? error.data
            : "一覧を取得できませんでした。もう一度お試しください。",
      });
    }
  }
}
