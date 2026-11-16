-- Watt-Wise: responsável pela execução e inclusão opcional no calendário
-- Seguro para executar mais de uma vez; preserva as tarefas existentes.

alter table public.tasks
  add column if not exists assigned_to text,
  add column if not exists show_on_calendar boolean not null default true;

-- As tarefas já existentes continuam aparecendo no calendário.
update public.tasks set show_on_calendar = true where show_on_calendar is null;

-- Registrar no histórico alterações de responsável e visibilidade no calendário.
create or replace function public.wattwise_log_task_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events(task_id,user_id,event_type,new_value)
    values(new.id,new.user_id,'created',to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      insert into public.task_events(task_id,user_id,event_type,old_value,new_value)
      values(new.id,new.user_id,'status_changed',jsonb_build_object('status',old.status),jsonb_build_object('status',new.status));
    end if;
    if old.due_date is distinct from new.due_date or old.due_time is distinct from new.due_time then
      insert into public.task_events(task_id,user_id,event_type,old_value,new_value)
      values(new.id,new.user_id,'schedule_changed',
        jsonb_build_object('date',old.due_date,'time',old.due_time),
        jsonb_build_object('date',new.due_date,'time',new.due_time));
    end if;
    if old.title is distinct from new.title or old.description is distinct from new.description
       or old.category is distinct from new.category or old.priority is distinct from new.priority
       or old.assigned_to is distinct from new.assigned_to
       or old.show_on_calendar is distinct from new.show_on_calendar then
      insert into public.task_events(task_id,user_id,event_type,old_value,new_value)
      values(new.id,new.user_id,'details_changed',to_jsonb(old),to_jsonb(new));
    end if;
    return new;
  end if;
  return null;
end $$;

notify pgrst, 'reload schema';
