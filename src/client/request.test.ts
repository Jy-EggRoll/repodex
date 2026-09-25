import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { createRequestGate, requestFailure, runLatest } from "./request";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Records what a gated request applied, so a stale request is visible as a missing entry. */
function recorder() {
  const applied: string[] = [];
  return {
    applied,
    onSuccess: (value: string) => applied.push(`ok:${value}`),
    onFailure: (failure: { status: number | null; message: string }) =>
      applied.push(`err:${failure.status}:${failure.message}`),
    onSettled: () => applied.push("settled"),
  };
}

describe("createRequestGate", () => {
  it("treats only the newest token as current", () => {
    const gate = createRequestGate();
    const first = gate.begin();
    expect(gate.isCurrent(first)).toBe(true);
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });
});

describe("requestFailure", () => {
  it("keeps the HTTP status of an ApiError", () => {
    expect(requestFailure(new ApiError(503, "index not ready"))).toEqual({
      status: 503,
      message: "index not ready",
    });
  });

  it("reports a status-less failure for anything else", () => {
    expect(requestFailure(new Error("boom"))).toEqual({ status: null, message: "boom" });
    expect(requestFailure("boom")).toEqual({ status: null, message: "boom" });
  });
});

describe("runLatest", () => {
  it("applies the newest outcome and drops the superseded one", async () => {
    const gate = createRequestGate();
    const slow = deferred<string>();
    const fast = deferred<string>();
    const slowRun = recorder();
    const fastRun = recorder();

    const running = runLatest(
      gate,
      () => slow.promise,
      slowRun.onSuccess,
      slowRun.onFailure,
      slowRun.onSettled,
    );
    const superseding = runLatest(
      gate,
      () => fast.promise,
      fastRun.onSuccess,
      fastRun.onFailure,
      fastRun.onSettled,
    );

    fast.resolve("newer");
    await superseding;
    slow.resolve("older");
    await running;

    expect(fastRun.applied).toEqual(["ok:newer", "settled"]);
    // The older response leaves no trace at all: no result, no error, no settle
    expect(slowRun.applied).toEqual([]);
  });

  it("reports a failure of the newest request only", async () => {
    const gate = createRequestGate();
    const run = recorder();
    await runLatest(
      gate,
      () => Promise.reject(new ApiError(500, "nope")),
      run.onSuccess,
      run.onFailure,
      run.onSettled,
    );
    expect(run.applied).toEqual(["err:500:nope", "settled"]);
  });

  it("stays quiet when a superseded request fails", async () => {
    const gate = createRequestGate();
    const failing = deferred<string>();
    const newer = deferred<string>();
    const failingRun = recorder();
    const newerRun = recorder();

    const running = runLatest(
      gate,
      () => failing.promise,
      failingRun.onSuccess,
      failingRun.onFailure,
      failingRun.onSettled,
    );
    const superseding = runLatest(
      gate,
      () => newer.promise,
      newerRun.onSuccess,
      newerRun.onFailure,
      newerRun.onSettled,
    );

    failing.reject(new Error("stale failure"));
    await running;
    newer.resolve("newer");
    await superseding;

    expect(failingRun.applied).toEqual([]);
    expect(newerRun.applied).toEqual(["ok:newer", "settled"]);
  });
});
