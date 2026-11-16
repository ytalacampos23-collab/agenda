# Watt-Wise

Aplicação web em desenvolvimento para agenda profissional e controle de visitas à Cemig.

## O que existe nesta primeira entrega
- Estrutura React + TypeScript + Vite.
- Layout responsivo inicial.
- Navegação entre Minha Agenda, Visitas à Cemig e Histórico.
- Prévia de cadastro e alteração de status de tarefas (dados temporários no navegador nesta etapa).
- Paleta de categorias em tons pastéis.
- Cliente Supabase preparado para configuração posterior.
- Esquema SQL inicial com políticas RLS por usuário.

## Importante
Esta é uma **base inicial de desenvolvimento**, não uma aplicação pronta para uso real. A autenticação, persistência, histórico completo, atas, transferência de tópicos, exportação PDF/Excel e testes de segurança ainda precisam ser implementados e validados antes de inserir informações profissionais reais.

Nunca coloque a chave `service_role` no frontend ou no GitHub. O `.env` real não deve ser enviado ao repositório. Use somente variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no ambiente de desenvolvimento/hospedagem, depois de configurar as políticas RLS e validar o projeto.

## Executar no computador
1. Instale Node.js LTS.
2. Abra o terminal nesta pasta.
3. Execute `npm install`.
4. Copie `.env.example` para `.env.local` e preencha as credenciais públicas do projeto Supabase quando ele estiver configurado.
5. Execute `npm run dev`.

## Publicação
A publicação será configurada depois, preferencialmente com Vercel ligada ao repositório privado do GitHub. Configure as variáveis de ambiente diretamente na plataforma de hospedagem.

## Segurança antes de produção
- Restringir criação de contas a usuários autorizados.
- Ativar confirmação de e-mail e configurar URLs de redirecionamento.
- Revisar RLS em todas as tabelas e testar isolamento entre usuários.
- Implementar auditoria no banco para alterações importantes.
- Configurar backups e política de recuperação.
- Nunca usar dados reais até concluir os testes.
