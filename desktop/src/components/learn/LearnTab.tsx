// Learn tab — the doctrine layer mounted inside Liquid Lift (sprint #14c).
//
// Sits as a new top-level nav destination alongside Build / Earn / Clips /
// Settings. The doctrine library is what converts Minecraft Challenge entry
// clippers into long-term Liquid Clips operators — every episode they watch
// raises lifetime value.

import { DoctrineLibrary } from "./DoctrineLibrary";

export function LearnTab() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <DoctrineLibrary />
    </div>
  );
}
