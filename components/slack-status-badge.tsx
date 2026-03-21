import { Badge } from "@/components/ui/badge";
import type { SlackStatus } from "@/lib/types";

export function SlackStatusBadge({ status }: { status: SlackStatus }) {
  switch (status) {
    case "ready":
      return <Badge variant="success">ready</Badge>;
    case "provisioning":
      return <Badge variant="warning">provisioning</Badge>;
    case "error":
      return <Badge variant="danger">error</Badge>;
    default:
      return <Badge variant="default">disconnected</Badge>;
  }
}
