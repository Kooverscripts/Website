import { supabaseServer } from "@/lib/supabase/server";
import Friends from "@/components/Friends";

export default async function AppHome() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  return <Friends meId={user!.id} />;
}
