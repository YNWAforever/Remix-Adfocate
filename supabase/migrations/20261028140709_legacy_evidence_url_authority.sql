-- Bound the direct-RPC HTTP authority guard without implementing full UTS46/IDNA.
-- The authorized API checks both parsers for fresh correction eligibility;
-- the service-only command retains scope, revision, state, receipt and audit guards.
-- No historical evidence, receipt, XP or reward row is rewritten.
begin;

create or replace function private.valid_legacy_evidence(p_urls text[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_url text;
  v_parts text[];
  v_host text;
  v_bytes bytea;
  v_index integer;
  v_octet text;
  v_ipv4_parts text[];
  v_part text;
  v_part_index integer;
  v_radix integer;
  v_number bigint;
  v_digit integer;
begin
  if p_urls is null or cardinality(p_urls) = 0 then return false; end if;
  foreach v_url in array p_urls loop
    if v_url is null then return false; end if;
    v_parts := regexp_match(btrim(v_url),
      '^https?://(\[[0-9a-f:.]+\]|[^/@:?#[:space:]\\]+)(:([0-9]{1,5}))?([/?#][^[:space:]\\]*)?$', 'i');
    if v_parts is null or (v_parts[3] is not null and v_parts[3]::integer > 65535) then return false; end if;
    v_host := v_parts[1];
    if left(v_host, 1) = '[' then
      -- A bracketed authority must contain a real IPv6 address, not merely hex/colon text.
      if right(v_host, 1) <> ']' or family(substring(v_host from 2 for length(v_host) - 2)::inet) <> 6 then return false; end if;
    else
      -- WHATWG HTTP hosts decode percent escapes before checking forbidden host
      -- characters. Retain valid escaped DNS/UTF-8 hosts rather than banning '%'.
      if position('%' in v_host) > 0 then
        v_bytes := ''::bytea;
        v_index := 1;
        while v_index <= length(v_host) loop
          if substring(v_host from v_index for 1) = '%' then
            v_octet := substring(v_host from v_index + 1 for 2);
            if v_octet !~ '^[0-9a-fA-F]{2}$' then return false; end if;
            v_bytes := v_bytes || decode(v_octet, 'hex');
            v_index := v_index + 3;
          else
            v_bytes := v_bytes || convert_to(substring(v_host from v_index for 1), 'UTF8');
            v_index := v_index + 1;
          end if;
        end loop;
        v_host := convert_from(v_bytes, 'UTF8');
      end if;
      -- Width variants and Unicode DNS separators participate in numeric-host
      -- validation too. This normalization checks syntax; it never rewrites evidence.
      v_host := translate(normalize(v_host, NFKC), '。．｡', '...');
      if v_host ~ '[[:cntrl:][:space:]#%/:<>?@^|]'
        or position('[' in v_host) > 0 or position(']' in v_host) > 0
        or position(chr(92) in v_host) > 0 then return false; end if;
      v_ipv4_parts := string_to_array(v_host, '.');
      if cardinality(v_ipv4_parts) > 1 and v_ipv4_parts[cardinality(v_ipv4_parts)] = '' then
        v_ipv4_parts := v_ipv4_parts[1:cardinality(v_ipv4_parts) - 1];
      end if;
      -- A host ending in an IPv4 number uses IPv4 limits, not arbitrary DNS
      -- labels. Preserve the URL parser's valid short, octal and hexadecimal forms.
      if v_ipv4_parts[cardinality(v_ipv4_parts)] ~* '^([0-9]+|0x[0-9a-f]*)$' then
        if cardinality(v_ipv4_parts) > 4 then return false; end if;
        for v_part_index in 1..cardinality(v_ipv4_parts) loop
          v_part := lower(v_ipv4_parts[v_part_index]);
          if v_part = '' then return false; end if;
          v_radix := 10;
          if left(v_part, 2) = '0x' then v_radix := 16; v_part := substring(v_part from 3);
          elsif length(v_part) > 1 and left(v_part, 1) = '0' then v_radix := 8; v_part := substring(v_part from 2);
          end if;
          v_number := 0;
          for v_index in 1..length(v_part) loop
            v_digit := position(substring(v_part from v_index for 1) in '0123456789abcdef') - 1;
            if v_digit < 0 or v_digit >= v_radix then return false; end if;
            v_number := v_number * v_radix + v_digit;
            if v_number > 4294967295 then return false; end if;
          end loop;
          if (v_part_index < cardinality(v_ipv4_parts) and v_number > 255)
            or (v_part_index = cardinality(v_ipv4_parts) and v_number >= power(256::bigint, 5 - cardinality(v_ipv4_parts))) then return false; end if;
        end loop;
      end if;
    end if;
  end loop;
  return true;
exception when invalid_text_representation or character_not_in_repertoire or invalid_parameter_value then
  return false;
end;
$$;

revoke all on function private.valid_legacy_evidence(text[]) from public, anon, authenticated;
grant execute on function private.valid_legacy_evidence(text[]) to service_role;

-- The trusted API must observe the exact same scoped evidence revision and SQL
-- validity together; either parser's rejection makes historical work repairable.
create function public.get_legacy_correction_evidence(p_workspace uuid, p_submission uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('content_urls', s.content_urls, 'evidence_revision', s.evidence_revision,
    'sql_valid', private.valid_legacy_evidence(s.content_urls))
  from public.mission_submissions s where s.workspace_id = p_workspace and s.id = p_submission;
$$;
revoke all on function public.get_legacy_correction_evidence(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_legacy_correction_evidence(uuid,uuid) to service_role;

-- The API's URL parser handles IDNA and other browser-specific validity rules.
-- Only that staff-authorized service path may initiate fresh corrections. Do not
-- strand parser-invalid evidence merely because the bounded SQL guard accepts it.
create or replace function public.request_legacy_evidence_correction(p_workspace uuid, p_operator uuid, p_submission uuid,
  p_request uuid, p_expected_revision bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_submission public.mission_submissions%rowtype; v_receipt public.legacy_evidence_corrections%rowtype;
  v_hash text; v_result jsonb; v_actor text;
begin
  select email into v_actor from public.staff_users where user_id=p_operator and active;
  if not found or not exists(select 1 from public.brand_users where user_id=p_operator and workspace_id=p_workspace and active) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if p_request is null or p_expected_revision is null or p_expected_revision<0 or nullif(btrim(p_note),'') is null then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  select * into v_submission from public.mission_submissions where id=p_submission and workspace_id=p_workspace for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('submission',p_submission,'revision',p_expected_revision,'note',btrim(p_note))::text,'UTF8')),'hex');
  select * into v_receipt from public.legacy_evidence_corrections where workspace_id=p_workspace and operator_id=p_operator and request_id=p_request;
  if found then
    if v_receipt.payload_hash<>v_hash then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    return v_receipt.result;
  end if;
  if v_submission.evidence_revision<>p_expected_revision then raise exception using errcode='P0001',message='EVIDENCE_STALE'; end if;
  if v_submission.status not in ('submitted','under_review','rejected')
    or not exists(select 1 from public.missions where id=v_submission.mission_id and workspace_id=p_workspace and creator_workflow_mode='legacy') then
    raise exception using errcode='P0001',message='wrong_state';
  end if;
  update public.mission_submissions set status='joined',reviewer_notes=btrim(p_note),reviewed_at=null where id=p_submission;
  v_result:=jsonb_build_object('submission_id',p_submission,'status','joined','revision',v_submission.evidence_revision+1,'receipt_id',p_request);
  insert into public.legacy_evidence_corrections(workspace_id,operator_id,request_id,submission_id,payload_hash,previous_evidence,result)
    values(p_workspace,p_operator,p_request,p_submission,v_hash,jsonb_build_object('status',v_submission.status,'urls',v_submission.content_urls,
      'review_notes',v_submission.reviewer_notes,'reviewed_at',v_submission.reviewed_at,'revision',v_submission.evidence_revision),v_result);
  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,metadata)
    values(p_workspace,p_operator::text,v_actor,'legacy_evidence.correction_requested','submission',p_submission::text,v_submission.creator_id,
      jsonb_build_object('request_id',p_request,'revision',v_submission.evidence_revision+1));
  return v_result;
end;
$$;
revoke all on function public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text) to service_role;

commit;
