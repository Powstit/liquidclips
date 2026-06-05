// Affiliate referral capture — first-touch, persistent.
//
// Reads ?ref= (or legacy ?a=) from the landing URL and stores it as the
// `jnr_ref` cookie scoped to *.liquidclips.app, so the account-app sign-up
// (account.liquidclips.app) can bake it into Clerk unsafeMetadata — the
// "first-touch forever" attribution from oauth-billing.md §6.
//
// IDs only; first-touch wins (never overwrite an existing capture).
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var ref = params.get("ref") || params.get("a");
    if (!ref) return;
    ref = ref.trim().slice(0, 64);
    // Affiliate ids are alphanumeric + _ - only. Reject anything else.
    if (!/^[A-Za-z0-9_-]+$/.test(ref)) return;
    // First-touch: do not overwrite an existing referral.
    if (/(?:^|;\s*)jnr_ref=/.test(document.cookie)) return;
    var oneYear = 60 * 60 * 24 * 365;
    // Share across apex + subdomains (account., partner.) so signup can read it.
    var domain = /(^|\.)liquidclips\.app$/.test(location.hostname)
      ? "; domain=.liquidclips.app"
      : "";
    document.cookie =
      "jnr_ref=" + encodeURIComponent(ref) +
      "; path=/; max-age=" + oneYear + domain + "; SameSite=Lax";
  } catch (e) {
    /* attribution is best-effort — never break the page */
  }
})();
