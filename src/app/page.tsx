import { Portal } from "@/components/portal";
import { deskPayload } from "@/lib/desk";
import { bootQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await bootQueue();
  return <Portal initial={await deskPayload()} />;
}
