/**
 * F6 · Layer 3 · warm-peer email template renderer.
 *
 * Locked template from `growth-engine-build-map.md` F6 section. The subject
 * and body are rendered per target with `{{first_name}}`, `{{preview_url}}`,
 * and `{{user_first_name}}` interpolation. No HTML escaping — Gmail's
 * contenteditable body accepts raw HTML fragments and the fields come
 * from the internal contact-scan pipeline (not from user text input).
 */

export interface WarmPeerTarget {
  email: string;
  firstName: string;
  previewUrl: string;
}

export interface WarmPeerContext {
  senderFirstName: string;
}

const LOCKED_SUBJECT = 'I ran your channel through Liquid Clips';

function renderBody(target: WarmPeerTarget, ctx: WarmPeerContext): string {
  return [
    `Hey ${target.firstName},`,
    ``,
    `Was clipping my own catalog through Liquid Clips and let it loose`,
    `on your last long-form too. It pulled ~80 short-form ready clips.`,
    ``,
    `Preview here (30-sec render of your video getting chopped):`,
    `${target.previewUrl}`,
    ``,
    `Full disclosure: if you subscribe through that link I get a 50% MRR`,
    `split from Whop. So it's a win-win.`,
    ``,
    `Best,`,
    `${ctx.senderFirstName}`,
  ].join('<br>');
}

export function renderWarmPeer(target: WarmPeerTarget, ctx: WarmPeerContext): { to: string; subject: string; body: string } {
  return {
    to: target.email,
    subject: LOCKED_SUBJECT,
    body: renderBody(target, ctx),
  };
}
