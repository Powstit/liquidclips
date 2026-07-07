/**
 * HomeSection · Phase 5B simulator entry point
 *
 * Mounts the SimulatorRouter. nav:click events inside the Design OS shell
 * switch between the 15 simulator pages (Command Room, Create, Engine, …
 * Stop Pages). The legacy section registry still points here for /home,
 * but every Design OS page is now reachable through the bus.
 */

import { SimulatorRouter } from "../../design-os/routing/SimulatorRouter";

export default function HomeSection() {
  return <SimulatorRouter />;
}

export { HomeSection };
