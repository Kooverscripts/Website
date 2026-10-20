export const metadata = { title: "Política de Privacidade — NEXUS" };
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 text-sm leading-6"><a href="/login" className="text-violet-400">← Voltar</a>
      <h1 className="text-2xl font-bold">Política de Privacidade</h1>
      <p className="rounded border border-amber-500/40 p-3 text-amber-300">Modelo inicial (LGPD). Preencha os dados do controlador e revise com assessoria jurídica antes de publicar.</p>
      <h2 className="font-semibold">Dados que coletamos</h2><p>E-mail, nome de usuário, senha (armazenada somente como hash), dados de perfil que você informar, mensagens, arquivos enviados, amizades, associações a servidores e configurações.</p>
      <h2 className="font-semibold">Como usamos</h2><p>Para operar o serviço: autenticar você, entregar mensagens, exibir perfis a quem você permitir, enviar notificações e proteger a plataforma contra abuso.</p>
      <h2 className="font-semibold">Mensagens privadas</h2><p>Mensagens diretas só são acessíveis aos participantes da conversa. Ao denunciar uma mensagem, uma cópia do trecho é enviada à análise de denúncias.</p>
      <h2 className="font-semibold">Seus direitos</h2><p>Você pode acessar e baixar seus dados e excluir a conta em Configurações → Conta. A exclusão remove perfil, amizades e mensagens associadas.</p>
      <h2 className="font-semibold">Compartilhamento</h2><p>Não vendemos dados. Utilizamos provedores de infraestrutura (hospedagem, banco de dados, armazenamento e e-mail) para operar o serviço.</p>
      <h2 className="font-semibold">Contato</h2><p>Informe aqui o e-mail do responsável pelo tratamento de dados.</p>
    </main>
  );
}
