import { JuniorLoader } from "@/components/JuniorLoader";

// Fallback shown on any route transition until the page is ready.
// Route-specific loading.tsx files override this with a tailored message.
export default function Loading() {
  return <JuniorLoader message="One moment" />;
}
