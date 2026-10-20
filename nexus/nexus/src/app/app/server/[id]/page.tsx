import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function ServerHome({ params }: { params: { id: string } }) {
  const { data } = await supabaseServer().from("channels").select("id").eq("server_id", params.id).eq("type", "text").order("position").limit(1);
  if (data?.[0]) redirect(`/app/server/${params.id}/c/${data[0].id}`);
  return <p className="p-6 text-zinc-500">Este servidor ainda não tem canais de texto.</p>;
}
