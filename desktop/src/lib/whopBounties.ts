import { getCachedLicenseJwt } from "./authStorage";
import { sidecar, type WhopBounty } from "./sidecar";

type WhopBountyListResult = {
  bounties: WhopBounty[];
  authenticated: boolean;
  error?: string;
};

export async function listWhopBountiesWithCachedSession(first = 30): Promise<WhopBountyListResult> {
  const jwt = getCachedLicenseJwt();
  if (!jwt) {
    return {
      bounties: [],
      authenticated: false,
      error: "Continue your session to load earnings.",
    };
  }
  return sidecar.whopListBounties(first, jwt);
}
