import { Portal } from "@/components/portal";
import { deskPayload } from "@/lib/desk";
import { instagramCallbackNotice, missingMetaEnv, missingMetaMessage } from "@/lib/meta";
import { bootQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ instagram_error?: string | string[] }>;
}) {
  await bootQueue();
  const params = await searchParams;
  const code = Array.isArray(params.instagram_error) ? params.instagram_error[0] : params.instagram_error;
  const notice =
    code === "config" ? missingMetaMessage(missingMetaEnv()) : instagramCallbackNotice(code);
  return <Portal initial={await deskPayload()} instagramNotice={notice} />;
}
