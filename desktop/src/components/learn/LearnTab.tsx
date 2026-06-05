// Learn tab — the doctrine layer mounted inside Liquid Lift (sprint #14c).
//
// Sits as a new top-level nav destination alongside Build / Earn / Clips /
// Settings. The doctrine library is what converts Minecraft Challenge entry
// clippers into long-term Liquid Clips operators — every episode they watch
// raises lifetime value.

import { GraduationCap } from "lucide-react";
import { DoctrineLibrary } from "./DoctrineLibrary";
import { PageHeader } from "../primitives";

export function LearnTab() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <PageHeader
        glyph={GraduationCap}
        eyebrow="doctrine deck"
        title="Learn the craft."
        subtitle="Doctrine episodes that turn first-time clippers into long-term operators."
      />
      <DoctrineLibrary />
    </div>
  );
}
