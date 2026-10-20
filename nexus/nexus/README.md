# NEXUS

## Configuração
1. Crie um projeto no Supabase.
2. Rode em ordem `0001_init.sql`, `0002_rpcs_storage.sql` e `0003_dm_hardening.sql` , `0004_servers.sql`, `0005_roles_presence_media.sql`, `0006_notifications_search_moderation.sql`, `0007_fixes.sql` `0008_voice.sql` e `0009_completeness.sql` no SQL Editor.
3. Auth > URL Configuration: Site URL = `NEXT_PUBLIC_SITE_URL`; Redirect URLs: `<site>/auth/callback`.
4. Auth > Providers > Email: mantenha "Confirm email" ligado.
5. Copie `.env.example` para `.env.local` e preencha.
6. `npm install && npm run dev`.

## Limites do plano gratuito do Supabase (afetam produção)
E-mails de auth com limite baixo por hora (configure SMTP próprio para produção); projeto pausa por inatividade; 1 GB de storage.

## Status
Fase 8: auth, perfil, amigos, DMs, servidores, cargos, canais privados, anexos, reações, presença, notificações (triggers), busca global (RLS), fixar, bloquear, denúncias, conta (senha, sessões, exportar, excluir).
Pendente: SFU para salas grandes, internacionalização (idioma), adicionar membros a grupos já criados, testes automatizados de ponta a ponta, deploy conferido em produção.

## Administrador da plataforma (análise de denúncias)
Depois de criar sua conta, rode no SQL Editor: `insert into platform_admins(user_id) select id from profiles where username = 'SEU_USUARIO';`
O painel fica em `/app/admin/reports`. Denúncias de DMs, usuários e servidores vão só para administradores da plataforma; denúncias de mensagens de canal vão para os moderadores do servidor.

## Limitações conhecidas
- Busca usa `ilike` com índice trigram (adequado para escala pequena/média; considere Postgres FTS ou um serviço de busca para grandes volumes).
- Excluir conta não apaga arquivos já enviados ao Storage.
- Alertas do navegador exigem permissão do usuário; não há push com o app fechado.

## Voz e vídeo (fase 7)
Arquitetura: WebRTC em **malha P2P** (cada participante envia áudio/vídeo diretamente a cada outro). A sinalização usa o Supabase Realtime em **canais privados** (`voice:<canal>` e `call:<conversa>`), autorizados por RLS em `realtime.messages` (migração `0008_voice.sql`).
- **TURN**: sem um servidor TURN (coturn, Twilio, Metered…), parte das conexões falha em redes com NAT simétrico/corporativas. Configure `TURN_*` no `.env`.
- **Escala**: malha P2P é adequada para ~2–8 pessoas (cada pessoa envia N-1 fluxos). Para salas maiores, troque por um SFU (LiveKit/mediasoup) — a interface e as permissões podem ser reaproveitadas.
- **Limite de participantes** e **silenciar/desconectar** são aplicados pelos clientes (as permissões são validadas no servidor, mas sem SFU não há como impedir um cliente modificado de ignorar o comando).
- No painel do Supabase, mantenha **Realtime > Allow public access** ligado (os canais de digitação/presença global são públicos; os de voz são privados).
- Navegadores exigem HTTPS (ou localhost) para microfone, câmera e compartilhamento de tela.

## Testes
- `TESTING.md`: roteiro manual com 2 contas cobrindo os 15 fluxos do escopo.
- `supabase/tests/rls_smoke.sql`: verificação automática de autorização (rodar no SQL Editor).
