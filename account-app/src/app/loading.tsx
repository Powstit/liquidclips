import { LiquidLoader } from "@/components/LiquidLoader";

// Fallback shown on any route transition until the page is ready.
// Route-specific loading.tsx files override this with a tailored message.
export default function Loading() {
  return <LiquidLoader message="One moment" />;
}
