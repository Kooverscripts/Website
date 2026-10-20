export const ALL_PERMS = ["manage_server","manage_channels","manage_roles","send_messages","attach_files","delete_messages",
  "mention_everyone","create_invites","kick_members","ban_members","manage_pins","connect_voice","mute_members","move_members","view_audit_log"];

// Apenas para exibir/ocultar controles. A autorização real é feita no banco (RLS/RPC).
export async function getPerms(sb: any, serverId: string, userId: string) {
  const { data: s } = await sb.from("servers").select("owner_id").eq("id", serverId).single();
  if (!s) return null;
  const isOwner = s.owner_id === userId;
  if (isOwner) return { isOwner, perms: ALL_PERMS };
  const { data: mr } = await sb.from("member_roles").select("roles(role_permissions(permission))")
    .eq("server_id", serverId).eq("user_id", userId);
  const set = new Set<string>();
  (mr ?? []).forEach((r: any) => r.roles?.role_permissions?.forEach((p: any) => set.add(p.permission)));
  return { isOwner, perms: Array.from(set) };
}
