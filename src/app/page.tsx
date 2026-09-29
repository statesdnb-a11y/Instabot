import { Portal } from "@/components/portal";
import { deskPayload } from "@/lib/desk";
import { bootQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

export default function HomePage() {
  bootQueue();
  return <Portal initial={deskPayload()} />;
}
