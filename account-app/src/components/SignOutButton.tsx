"use client";

import { SignOutButton as ClerkSignOutButton } from "@clerk/nextjs";

export function SignOutButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ClerkSignOutButton>
      <button type="button" className={className}>
        {children}
      </button>
    </ClerkSignOutButton>
  );
}
