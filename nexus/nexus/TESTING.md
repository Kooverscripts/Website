# Roteiro de testes (manual) — NEXUS

Use dois navegadores (ou um normal + uma janela anônima) com **contas diferentes**: Alice e Bob.
Marque cada item. Nada abaixo foi executado pelo autor do código: este é o roteiro para você validar.

1. [ ] Criar duas contas reais (confirmar o e-mail de cada uma).
2. [ ] Sair e entrar novamente nas duas; testar senha errada e "Esqueci minha senha".
3. [ ] Alice edita nome, bio, avatar e cor; Bob abre `/app/u/alice` e vê as mudanças.
4. [ ] Alice envia solicitação de amizade; Bob aceita (e testa recusar/cancelar em outra tentativa).
5. [ ] Alice inicia DM com Bob (pela busca ou pelo perfil).
6. [ ] Trocar mensagens: chegam em tempo real; indicador "digitando"; ✓ enviada → ✓✓ entregue → ✓✓ azul lida.
7. [ ] Recarregar a página: o histórico continua.
8. [ ] Alice cria um servidor, gera convite; Bob entra pelo link `/app/join/<código>`.
9. [ ] Alice cria categoria e canais (texto, anúncio, voz, privado).
10. [ ] Trocar mensagens no canal; testar menção `@bob` (notificação) e reações/anexos.
11. [ ] Cargos: Alice cria cargo com poucas permissões e atribui a Bob; confirmar que Bob **não** consegue banir, criar cargos acima do seu, nem ver canal privado.
    Expulsar, banir (Bob não consegue reentrar), desbanir; bloquear Bob (ele não consegue mais enviar DM).
12. [ ] Segurança: logado como Bob, abrir `/app/server/<id>` de um servidor privado do qual ele não participa → deve redirecionar; tentar abrir DM alheia `/app/dm/<id>` → 404.
    Rodar também `supabase/tests/rls_smoke.sql` no SQL Editor.
13. [ ] Uploads (imagem, PDF; arquivo >25 MB e tipo proibido devem ser recusados), notificações (sino) e presença (online/ausente/invisível).
14. [ ] Voz: dois dispositivos em redes diferentes entram no mesmo canal de voz; testar mutar, volume, câmera, tela, reconectar (desligar o Wi-Fi por 5 s). Sem TURN, falhas em algumas redes são esperadas.
15. [ ] Responsividade: abrir no celular (menu ☰, painel de canais, chat) e em tela larga; testar tema claro e texto grande em Preferências.

Extras: denunciar mensagem → aparece no painel de denúncias (admin da plataforma ou moderadores); excluir conta (só sem servidores próprios).
