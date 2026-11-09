create or replace function public.generate_appointment_payload(p_appointment public.appointments)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'appointment_id', p_appointment.id,
    'business_id', p_appointment.business_id,
    'customer_id', p_appointment.customer_id,
    'customer_name', p_appointment.customer_name,
    'customer_email', p_appointment.customer_email,
    'customer_phone', p_appointment.customer_phone,
    'staff_id', p_appointment.staff_id,
    'service_id', p_appointment.service_id,
    'status', p_appointment.status,
    'appointment_date', p_appointment.appointment_date,
    'start_time', p_appointment.start_time,
    'end_time', p_appointment.end_time,
    'starts_at', p_appointment.starts_at,
    'ends_at', p_appointment.ends_at,
    'created_at', p_appointment.created_at
  );
$$;

create or replace function public.handle_appointment_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  appointment public.appointments%rowtype;
  owner_id uuid;
  staff_email text;
  event_types text[] := array[]::text[];
  event_type text;
  version_hash text;
  payload jsonb;
  linked_appointment_id uuid;
begin
  if tg_op = 'DELETE' then
    appointment := old;
    event_types := array['appointment_deleted'];
    linked_appointment_id := null;
  else
    appointment := new;
    linked_appointment_id := new.id;
    if tg_op = 'INSERT' then
      event_types := array['appointment_created'];
    else
      if old.status is distinct from new.status and new.status in ('confirmed', 'cancelled', 'completed') then
        event_types := array_append(event_types, 'appointment_' || new.status);
      end if;
      if (old.starts_at, old.ends_at) is distinct from (new.starts_at, new.ends_at)
        and new.status <> 'cancelled' then
        event_types := array_append(event_types, 'appointment_rescheduled');
      end if;
    end if;
  end if;

  if cardinality(event_types) = 0 then return appointment; end if;
  select businesses.owner_id into owner_id from public.businesses where businesses.id = appointment.business_id;
  payload := public.generate_appointment_payload(appointment);
  foreach event_type in array event_types loop
    version_hash := md5(concat(appointment.id, event_type, txid_current(), clock_timestamp()));
    if owner_id is not null then
      insert into public.notification_outbox (business_id, appointment_id, recipient_user_id, event_type, channel, payload, dedupe_key, status)
      values (appointment.business_id, linked_appointment_id, owner_id, event_type, 'email', payload,
        public.generate_dedupe_key(appointment.id, event_type, owner_id, version_hash), 'pending')
      on conflict (dedupe_key) do nothing;
    end if;
    if appointment.customer_id is not null then
      insert into public.notification_outbox (business_id, appointment_id, recipient_user_id, recipient_email, event_type, channel, payload, dedupe_key, status)
      values (appointment.business_id, linked_appointment_id, appointment.customer_id, appointment.customer_email, event_type, 'email', payload,
        public.generate_dedupe_key(appointment.id, event_type, appointment.customer_id, version_hash), 'pending')
      on conflict (dedupe_key) do nothing;
    end if;
    if event_type = 'appointment_created' then
      select email into staff_email from public.staff where id = appointment.staff_id;
      if staff_email is not null then
        insert into public.notification_outbox (business_id, appointment_id, recipient_email, event_type, channel, payload, dedupe_key, status)
        values (appointment.business_id, linked_appointment_id, staff_email, event_type, 'email', payload,
          public.generate_dedupe_key(appointment.id, event_type, appointment.staff_id, version_hash), 'pending')
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
  end loop;
  return appointment;
end;
$$;