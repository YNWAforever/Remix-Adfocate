import GrowthImageWorkspaceImplementation from
  "@/components/studio/GrowthImageWorkspaceDev";
import type { GrowthImageWorkspaceProps } from "./GrowthImageWorkspace";

export function GrowthImageWorkspaceEntry(
  props: GrowthImageWorkspaceProps,
) {
  return <GrowthImageWorkspaceImplementation {...props}/>;
}
