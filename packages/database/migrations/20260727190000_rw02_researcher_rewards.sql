-- RW-02: researcher-safe reward activity projection.
--
-- The endpoint must not join through the owner transaction API. This RPC starts from reports
-- owned by the authenticated researcher, exposes only reward metadata, and links at most one
-- real payout transaction from that same report.

create index reports_researcher_reward_activity_idx
  on public.reports (researcher_id, status, reward_approved_at desc, id)
  where status in ('reward_approved', 'payment_pending', 'paid');

create or replace function public.researcher_rewards(
  actor_id uuid,
  requested_status text,
  page_size integer,
  page_offset integer
)
returns table (
  report_id uuid,
  program_id uuid,
  program_name text,
  report_title text,
  final_severity text,
  reward_status text,
  approved_reward text,
  submitted_at timestamp with time zone,
  reward_approved_at timestamp with time zone,
  payment_chain_id text,
  payment_token_address text,
  payment_transaction_hash text,
  payment_status text,
  payment_confirmations integer,
  payment_confirmed_at timestamp with time zone,
  paid_at timestamp with time zone,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = actor_id
      and role = 'researcher'
  ) then
    perform public.reject_forbidden('researcher_role_required');
  end if;

  if requested_status is not null
    and requested_status not in ('reward_approved', 'payment_pending', 'paid')
  then
    perform public.reject_business('invalid_reward_status');
  end if;

  if page_size < 1 or page_size > 100 or page_offset < 0 then
    perform public.reject_business('invalid_pagination');
  end if;

  return query
  with matching_rewards as materialized (
    select
      report.id,
      report.program_id,
      program.name as program_name,
      report.title,
      report.final_severity,
      report.status,
      report.approved_reward::text as approved_reward,
      report.submitted_at,
      report.reward_approved_at,
      report.paid_at
    from public.reports as report
    join public.programs as program
      on program.id = report.program_id
    where report.researcher_id = actor_id
      and report.status in ('reward_approved', 'payment_pending', 'paid')
      and (requested_status is null or report.status = requested_status)
  ),
  reward_count as (
    select count(*) as total_count
    from matching_rewards
  ),
  paged_rewards as materialized (
    select reward.*
    from matching_rewards as reward
    order by
      case reward.status
        when 'payment_pending' then 0
        when 'reward_approved' then 1
        when 'paid' then 2
      end,
      coalesce(reward.paid_at, reward.reward_approved_at) desc,
      reward.reward_approved_at desc,
      reward.id
    limit page_size
    offset page_offset
  ),
  projected as (
    select
      reward.id as report_id,
      reward.program_id,
      reward.program_name,
      reward.title as report_title,
      reward.final_severity,
      reward.status as reward_status,
      reward.approved_reward,
      reward.submitted_at,
      reward.reward_approved_at,
      payment.chain_id::text as payment_chain_id,
      payment.token_address as payment_token_address,
      payment.transaction_hash as payment_transaction_hash,
      case
        when payment.status = 'pending' then 'pending'
        when payment.status = 'confirmed' then 'confirmed'
        when payment.status in ('reverted', 'timeout') then 'failed'
        else null
      end as payment_status,
      payment.confirmations as payment_confirmations,
      payment.confirmed_at as payment_confirmed_at,
      reward.paid_at,
      reward_count.total_count
    from paged_rewards as reward
    cross join reward_count
    left join lateral (
      select payout.*
      from public.escrow_transactions as payout
      where payout.report_id = reward.id
        and payout.transaction_type = 'payout'
      order by
        case payout.status
          when 'confirmed' then 0
          when 'pending' then 1
          else 2
        end,
        payout.created_at desc,
        payout.id
      limit 1
    ) as payment on true

    union all

    -- A count-only sentinel keeps pagination metadata exact when offset is past the final row.
    -- The RPC is service-role-only; the repository removes this row before serialization.
    select
      null::uuid,
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::timestamp with time zone,
      null::timestamp with time zone,
      null::text,
      null::text,
      null::text,
      null::text,
      null::integer,
      null::timestamp with time zone,
      null::timestamp with time zone,
      reward_count.total_count
    from reward_count
    where not exists (select 1 from paged_rewards)
  )
  select
    projected.report_id,
    projected.program_id,
    projected.program_name,
    projected.report_title,
    projected.final_severity,
    projected.reward_status,
    projected.approved_reward,
    projected.submitted_at,
    projected.reward_approved_at,
    projected.payment_chain_id,
    projected.payment_token_address,
    projected.payment_transaction_hash,
    projected.payment_status,
    projected.payment_confirmations,
    projected.payment_confirmed_at,
    projected.paid_at,
    projected.total_count
  from projected
  order by
    case projected.reward_status
      when 'payment_pending' then 0
      when 'reward_approved' then 1
      when 'paid' then 2
      else 3
    end,
    coalesce(projected.paid_at, projected.reward_approved_at) desc nulls last,
    projected.reward_approved_at desc nulls last,
    projected.report_id;
end;
$$;

revoke all on function public.researcher_rewards(uuid, text, integer, integer) from public;
revoke all on function public.researcher_rewards(uuid, text, integer, integer) from anon;
revoke all on function public.researcher_rewards(uuid, text, integer, integer) from authenticated;
grant execute on function public.researcher_rewards(uuid, text, integer, integer) to service_role;
