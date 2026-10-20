-- Verificação rápida de autorização (NÃO executado pelo autor; rode no SQL Editor).
-- Tudo acontece dentro de uma transação e termina em ROLLBACK (não deixa dados).
-- Se algum ASSERT falhar, o erro mostra qual regra está quebrada.
begin;

insert into auth.users(id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'alice@test.local', '{"username":"alice_t"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'bob@test.local',   '{"username":"bob_t"}');

do $$
declare sid uuid; n int; ok boolean;
begin
  -- Alice cria um servidor PRIVADO
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  sid := create_server('Privado de teste', null, false);

  -- Bob (não é membro) não pode ver o servidor, seus canais nem mensagens
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from servers where id = sid;               assert n = 0, 'Bob NÃO deveria ver servidor privado';
  select count(*) into n from channels where server_id = sid;       assert n = 0, 'Bob NÃO deveria ver canais';
  select count(*) into n from channel_messages cm join channels c on c.id = cm.channel_id where c.server_id = sid;
  assert n = 0, 'Bob NÃO deveria ver mensagens';

  -- Bob não pode se expulsar/banir/criar cargo/entrar por conta própria
  begin perform kick_member(sid, '00000000-0000-0000-0000-0000000000a1'); assert false, 'Bob NÃO deveria poder expulsar';
  exception when others then ok := sqlerrm not like 'ASSERT%'; assert ok, sqlerrm; end;
  begin perform create_role(sid, 'x', '#ffffff', array['manage_server']); assert false, 'Bob NÃO deveria criar cargo';
  exception when others then ok := sqlerrm not like 'ASSERT%'; assert ok, sqlerrm; end;
  begin insert into server_members(server_id, user_id) values (sid, '00000000-0000-0000-0000-0000000000b2'); assert false, 'Bob NÃO deveria se inserir como membro';
  exception when others then ok := sqlerrm not like 'ASSERT%'; assert ok, sqlerrm; end;
  begin perform join_public_server(sid); assert false, 'servidor privado NÃO aceita entrada pública';
  exception when others then ok := sqlerrm not like 'ASSERT%'; assert ok, sqlerrm; end;

  reset role;
  raise notice 'OK: regras básicas de autorização passaram';
end $$;

rollback;
