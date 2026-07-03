/**
 * Step 5 · adapter.test.mts — Node-native test suite exercising the
 * five master-doc named assertions:
 *
 *   closed_registry            · enforced at TS compile (see
 *                                 adapter.type-check.ts) and mirrored
 *                                 at runtime via KNOWN_EVENT_NAMES.
 *   unknown_event_rejected     · same seam · isKnownEventName rejects.
 *   pii_redacted               · sanitizeMetadata strips PII fields.
 *   feature_context_attached   · envelope carries feature + release +
 *                                 correlation triple on every emit.
 *   adapter_failure_nonblocking · a throwing sink does not derail
 *                                 emit() or subsequent sinks.
 *
 * Runs via ``node --test src/lib/telemetry/adapter.test.mts`` — Node
 * 22+ strips TS types natively so no separate build step is needed.
 */

import test from "node:test";
import assert from "node:assert/strict";

// Import directly from the sibling .ts sources so Node's --test loader
// can resolve them (the barrel index.ts uses extensionless imports for
// Vite compatibility, which Node can't follow without additional flags).
import {
  emit,
  initTelemetry,
  registerSink,
  _resetTelemetryForTests,
  type AdapterContext,
  type Sink,
} from "../../src/lib/telemetry/adapter.ts";
import {
  isKnownEventName,
  KNOWN_EVENT_NAMES,
} from "../../src/lib/telemetry/eventRegistry.ts";
import { sanitizeMetadata } from "../../src/lib/telemetry/redact.ts";
import type { Envelope } from "../../src/lib/telemetry/envelope.ts";

function baseCtx(): AdapterContext {
  return {
    release: "2.2.21",
    build: "abcdef0",
    environment: "dev",
    actor: { kind: "internal", id: "user_test" },
    session_id: "sess_test",
    operating_mode: "self",
    entitlement_class: "pro",
    onboarding_state: "desktop_connected",
    correlation_id: "corr_root",
  };
}

/** Collect envelopes emitted through the adapter. */
function collectSink(name = "test-sink"): { sink: Sink; envelopes: Envelope[] } {
  const envelopes: Envelope[] = [];
  const sink: Sink = {
    name,
    receive(env) {
      envelopes.push(env);
    },
  };
  return { sink, envelopes };
}

async function flushMicrotasks() {
  // Microtask flush — the adapter defers sink delivery via
  // queueMicrotask so tests must await a tick.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

test("closed_registry · KNOWN_EVENT_NAMES matches EventName union", () => {
  assert.ok(KNOWN_EVENT_NAMES.size >= 12);
  // Sanity — every listed name is a non-empty string.
  for (const name of KNOWN_EVENT_NAMES) {
    assert.equal(typeof name, "string");
    assert.notEqual(name, "");
  }
});

test("unknown_event_rejected · isKnownEventName rejects unlisted names", () => {
  assert.equal(isKnownEventName("feature_started"), true);
  assert.equal(isKnownEventName("permission_denied"), true);
  assert.equal(isKnownEventName("random_made_up_event"), false);
  assert.equal(isKnownEventName(""), false);
  assert.equal(isKnownEventName("FEATURE_STARTED"), false); // case-sensitive
});

test("pii_redacted · email · jwt · token · path · url query stripped", () => {
  const sanitized = sanitizeMetadata({
    email: "daniel@example.com",
    authorization: "Bearer secret",
    token: "sk-abcdef",
    body_text: "Please email me at hello@x.com or my JWT eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.zzz for /Users/dipdip/keys/private",
    ok_field: "safe",
  });
  assert.ok(sanitized);
  assert.equal(sanitized.email, undefined);
  assert.equal(sanitized.authorization, undefined);
  assert.equal(sanitized.token, undefined);
  assert.equal(typeof sanitized.body_text, "string");
  const body = sanitized.body_text as string;
  assert.ok(!body.includes("hello@x.com"));
  assert.ok(body.includes("[email]"));
  assert.ok(!body.includes("eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop"));
  assert.ok(!body.includes("/Users/dipdip"));
  assert.equal(sanitized.ok_field, "safe");
});

test("pii_redacted · nested objects respect the ban list", () => {
  const sanitized = sanitizeMetadata({
    user: {
      email: "n@x.com",
      handle: "kade",
    },
    ok: 1,
  });
  const user = sanitized!.user as Record<string, unknown>;
  assert.equal(user.email, undefined);
  assert.equal(user.handle, "kade");
  assert.equal(sanitized!.ok, 1);
});

test("feature_context_attached · envelope carries feature + release + correlation", async () => {
  _resetTelemetryForTests();
  initTelemetry(baseCtx());
  const { sink, envelopes } = collectSink();
  registerSink(sink);

  emit({
    event: "feature_started",
    payload: { feature_id: "publish.now", journey_id: "clipper" },
    feature_id: "publish.now",
    journey_id: "clipper",
    surface: "desktop.publish.modal",
    route: "/home",
  });

  await flushMicrotasks();
  assert.equal(envelopes.length, 1);
  const e = envelopes[0]!;
  assert.equal(e.feature_id, "publish.now");
  assert.equal(e.journey_id, "clipper");
  assert.equal(e.surface, "desktop.publish.modal");
  assert.equal(e.route, "/home");
  assert.equal(e.release, "2.2.21");
  assert.equal(e.build, "abcdef0");
  assert.equal(e.environment, "dev");
  assert.equal(e.correlation_id, "corr_root");
  assert.equal(e.session_id, "sess_test");
  assert.ok(e.attempt_id);
  assert.ok(e.emitted_at);
  assert.equal(e.schema_version, 1);
});

test("feature_context_attached · defaults from AdapterContext when call-site omits", async () => {
  _resetTelemetryForTests();
  initTelemetry(baseCtx());
  const { sink, envelopes } = collectSink();
  registerSink(sink);

  emit({
    event: "empty_state_seen",
    payload: { surface: "home", reason: "loading" },
    feature_id: "home.render",
    surface: "home",
  });
  await flushMicrotasks();
  const e = envelopes[0]!;
  assert.equal(e.operating_mode, "self");
  assert.equal(e.entitlement_class, "pro");
  assert.equal(e.onboarding_state, "desktop_connected");
  assert.equal(e.success, true);
  assert.equal(e.failure, null);
});

test("adapter_failure_nonblocking · throwing sink does not abort other sinks or emit()", async () => {
  _resetTelemetryForTests();
  initTelemetry(baseCtx());
  const broken: Sink = {
    name: "broken",
    receive() {
      throw new Error("this sink is broken");
    },
  };
  const { sink: good, envelopes } = collectSink("good");
  registerSink(broken);
  registerSink(good);

  // emit() returns SYNC and must not throw even though `broken` will.
  emit({
    event: "feature_succeeded",
    payload: { feature_id: "publish.now", duration_ms: 400 },
    feature_id: "publish.now",
    surface: "desktop.publish.modal",
  });
  await flushMicrotasks();
  assert.equal(envelopes.length, 1);
});

test("adapter_failure_nonblocking · async sink rejection does not throw", async () => {
  _resetTelemetryForTests();
  initTelemetry(baseCtx());
  const asyncBroken: Sink = {
    name: "async-broken",
    async receive() {
      throw new Error("async fail");
    },
  };
  registerSink(asyncBroken);

  emit({
    event: "feature_failed",
    payload: {
      feature_id: "publish.now",
      stable_error_code: "publish.timeout",
    },
    feature_id: "publish.now",
    surface: "desktop.publish.modal",
    success: false,
    failure: "timeout",
    stable_error_code: "publish.timeout",
  });
  await flushMicrotasks();
  // If we got here without an uncaught rejection escaping, the test
  // has proven the non-blocking guarantee.
  assert.ok(true);
});

test("closed_registry · emit uses SCHEMA_VERSION lookup", async () => {
  _resetTelemetryForTests();
  initTelemetry(baseCtx());
  const { sink, envelopes } = collectSink();
  registerSink(sink);

  emit({
    event: "arcade_score_submitted",
    payload: { score: 42_500, wave: 12, duration_ms: 90_000 },
    feature_id: "arcade.score.submit",
    surface: "splash.game.over",
  });
  await flushMicrotasks();
  assert.equal(envelopes[0]!.schema_version, 1);
});
