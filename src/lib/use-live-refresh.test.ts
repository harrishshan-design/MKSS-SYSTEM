import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLiveRefresh } from "./use-live-refresh";
import { subscribeToLiveEvents, type LiveResource } from "./live-events";

vi.mock("./live-events", () => ({ OPERATIONS_TOPIC: "mkss:operations", subscribeToLiveEvents: vi.fn() }));

describe("live refresh scheduling", () => {
  let page: EventTarget & { hidden: boolean };
  let emit: (resource: LiveResource | null) => void;
  let stop: (() => void) | undefined;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    page = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", page);
    vi.stubGlobal("window", new EventTarget());
    vi.mocked(subscribeToLiveEvents).mockImplementation((_topic, listener) => { emit = listener; return unsubscribe; });
  });
  afterEach(() => { stop?.(); stop = undefined; vi.clearAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("loads initially and uses a 60-second backup rather than fast polling", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    stop = startLiveRefresh(refresh, ["visits"]);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(251);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("batches relevant events, ignores unrelated events, and refreshes on reconnect", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    stop = startLiveRefresh(refresh, ["visits"]);
    await vi.advanceTimersByTimeAsync(2000);
    emit("registrations");
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) emit("visits");
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(2);
    emit(null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("pauses hidden-tab fetches and reconciles on return", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    stop = startLiveRefresh(refresh, ["attendance"]);
    page.hidden = true;
    emit("attendance");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not overlap requests and preserves an event arriving during a request", async () => {
    let release!: () => void;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockResolvedValue(undefined);
    stop = startLiveRefresh(refresh, ["visits"]);
    emit("visits");
    await vi.advanceTimersByTimeAsync(3000);
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop(); stop = undefined;
    emit("visits");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
