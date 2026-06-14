import { getCachedLicenseJwt } from "./authStorage";
import { sidecar, type WhopBounty, type WhopSubmission } from "./sidecar";

type WhopBountyListResult = {
  bounties: WhopBounty[];
  authenticated: boolean;
  error?: string;
};

type WhopBountyDetailResult = {
  bounty: WhopBounty | null;
  authenticated: boolean;
  error?: string;
};

type WhopSubmissionResult = {
  submission: WhopSubmission | null;
  authenticated: boolean;
  error?: string;
};

const CONTINUE_SESSION_MSG = "Continue your session to load earnings.";

export async function listWhopBountiesWithCachedSession(first = 30): Promise<WhopBountyListResult> {
  const jwt = getCachedLicenseJwt();
  if (!jwt) {
    return { bounties: [], authenticated: false, error: CONTINUE_SESSION_MSG };
  }
  return sidecar.whopListBounties(first, jwt);
}

// v0.7.68 — public bounty discovery. NO cached-JWT read, NO Keychain. Used
// by Earn Available on cold launch so bounties show before unlock. Returns
// the same shape as listWhopBountiesWithCachedSession but `authenticated`
// is always false (it's a public view, not a personal one).
// v0.7.69 — default 25 to match backend's `_MAX_BOUNTY_LIST_FIRST` clamp.
export async function listPublicWhopBounties(first = 25): Promise<WhopBountyListResult> {
  const r = await sidecar.whopListPublicBounties(first);
  return {
    bounties: r.bounties,
    authenticated: false,
    error: r.error,
  };
}

export async function getWhopBountyWithCachedSession(id: string): Promise<WhopBountyDetailResult> {
  const jwt = getCachedLicenseJwt();
  if (!jwt) {
    return { bounty: null, authenticated: false, error: CONTINUE_SESSION_MSG };
  }
  return sidecar.whopBounty(id, jwt);
}

export async function getWhopSubmissionWithCachedSession(id: string): Promise<WhopSubmissionResult> {
  const jwt = getCachedLicenseJwt();
  if (!jwt) {
    return { submission: null, authenticated: false, error: CONTINUE_SESSION_MSG };
  }
  return sidecar.whopSubmission(id, jwt);
}
