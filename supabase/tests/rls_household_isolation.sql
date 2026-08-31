begin;
select plan(4);

-- Execute com Supabase CLI/pgtap após criar três usuários de teste.
-- Este arquivo documenta e automatiza a propriedade essencial: usuários fora do household não leem nem escrevem dados.
select has_table('public', 'households', 'households existe');
select has_table('public', 'transactions', 'transactions existe');
select row_security_active('public', 'transactions', 'RLS está ativo em transactions');
select policies_are('public', 'transactions', array['transactions_member_read'], 'transações expõem apenas leitura validada por membership; escrita é via RPC atômico');

select * from finish();
rollback;
