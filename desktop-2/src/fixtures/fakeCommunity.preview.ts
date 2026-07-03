export interface FakeCommunityRoom {
  slug: string;
  name: string;
  unread: number;
  href: string;
  tier: "free" | "paid";
}

export const fakeCommunity: FakeCommunityRoom[] = [
  { slug: "announcements",            name: "Announcements",            unread: 1, href: "https://whop.com/c/announcements",       tier: "free" },
  { slug: "free-clipper-lobby",       name: "Free Clipper Lobby",       unread: 4, href: "https://whop.com/c/free-clipper-lobby",  tier: "free" },
  { slug: "uncle-daniel-clips",       name: "Uncle Daniel Clips",       unread: 0, href: "https://whop.com/c/uncle-daniel-clips",  tier: "paid" },
  { slug: "viral-reaction-missions",  name: "Viral Reaction Missions",  unread: 2, href: "https://whop.com/c/viral-reaction",       tier: "paid" },
  { slug: "premium-rewards-hq",       name: "Premium Rewards HQ",       unread: 0, href: "https://whop.com/c/premium-rewards-hq",  tier: "paid" },
];
