import { Portal } from "@/components/portal";
import { deskPayload } from "@/lib/desk";
import { instagramCallbackNotice } from "@/lib/meta";
import { bootQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ instagram_error?: string | string[] }>;
}) {
  await bootQueue();
  const params = await searchParams;
  const code = Array.isArray(params.instagram_error) ? params.instagram_error[0] : params.instagram_error;
  return <Portal initial={await deskPayload()} instagramNotice={instagramCallbackNotice(code)} />;
}
