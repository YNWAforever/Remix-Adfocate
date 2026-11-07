-- Read-only opaque checksums of original columns only; no customer rows returned.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY relation),'[]'::jsonb) FROM (
SELECT 'public.academy_content'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","kind","slug","status","title_zh","title_en","excerpt_zh","excerpt_en","body_zh","body_en","category","required_level","emoji","color","sort","metadata","published_at","archived_at","created_at","updated_at" FROM "public"."academy_content") r) rows
UNION ALL
SELECT 'public.assistant_conversations'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","workspace","started_at","last_message_at" FROM "public"."assistant_conversations") r) rows
UNION ALL
SELECT 'public.assistant_messages'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","conversation_id","role","content","citations","tool_calls","created_at" FROM "public"."assistant_messages") r) rows
UNION ALL
SELECT 'public.brand_invites'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","email","workspace_id","role","token","invited_by_staff","expires_at","accepted_at","created_at" FROM "public"."brand_invites") r) rows
UNION ALL
SELECT 'public.brand_users'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "user_id","workspace_id","email","role","active","created_at" FROM "public"."brand_users") r) rows
UNION ALL
SELECT 'public.campaign_missions'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "campaign_id","mission_id","workspace_id","added_at","removed_at" FROM "public"."campaign_missions") r) rows
UNION ALL
SELECT 'public.campaign_participants'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","campaign_id","creator_id","workspace_id","approved_count","goal_reached_at","bonus_granted_at","prize_rank","prize_granted_at","first_approved_at","last_approved_at" FROM "public"."campaign_participants") r) rows
UNION ALL
SELECT 'public.campaign_rank_snapshots'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","campaign_id","workspace_id","creator_id","rank","approved","captured_at" FROM "public"."campaign_rank_snapshots") r) rows
UNION ALL
SELECT 'public.campaigns'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","workspace_id","slug","title","description","status","starts_at","ends_at","goal_metric","goal_target","completion_bonus_points","completion_bonus_xp","prize_tiers","published_at","closed_at","settled_at","created_by","created_at","updated_at" FROM "public"."campaigns") r) rows
UNION ALL
SELECT 'public.content_categories'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","slug","label_zh","label_en","sort","created_at" FROM "public"."content_categories") r) rows
UNION ALL
SELECT 'public.content_item_tags'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "content_id","tag_id" FROM "public"."content_item_tags") r) rows
UNION ALL
SELECT 'public.content_items'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","kind","slug","status","title_zh","title_en","excerpt_zh","excerpt_en","body_zh","body_en","cover_image_url","category_id","author_id","workspace_id","pinned","pinned_rank","views","scheduled_for","published_at","archived_at","created_at","updated_at","audience" FROM "public"."content_items") r) rows
UNION ALL
SELECT 'public.content_tags'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","slug","label_zh","label_en","created_at" FROM "public"."content_tags") r) rows
UNION ALL
SELECT 'public.creator_portfolio_links'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","workspace_id","url","title","platform_type","caption","sort_order","public_highlight","created_at","updated_at" FROM "public"."creator_portfolio_links") r) rows
UNION ALL
SELECT 'public.creator_public_passports'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","public_token_hash","enabled","created_at","revoked_at","last_viewed_at" FROM "public"."creator_public_passports") r) rows
UNION ALL
SELECT 'public.creator_public_profile_snapshots'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "creator_id","workspace_id","avatar_url","highlights","published_at","published_by","updated_at" FROM "public"."creator_public_profile_snapshots") r) rows
UNION ALL
SELECT 'public.creator_review_notes'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","workspace_id","operator_id","category","body","created_at" FROM "public"."creator_review_notes") r) rows
UNION ALL
SELECT 'public.creator_review_statuses'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","workspace_id","status","risk_level","summary","reviewed_by","last_reviewed_at","created_at","updated_at" FROM "public"."creator_review_statuses") r) rows
UNION ALL
SELECT 'public.creator_social_accounts'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","workspace_id","platform","handle","handle_normalized","profile_url","owner_verified","api_synced_at","sync_status","follower_count","following_count","post_count","bio","external_avatar_url","engagement_rate","avg_likes","avg_comments","posting_frequency","freshness_score","content_themes","summary","last_error_code","last_error_message","created_at","updated_at","verification_code","verification_code_expires_at","verified_at" FROM "public"."creator_social_accounts") r) rows
UNION ALL
SELECT 'public.creator_social_scan_snapshots'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","account_id","scanned_at","provider","status","metrics","recent_posts_summary","error_code","error_message" FROM "public"."creator_social_scan_snapshots") r) rows
UNION ALL
SELECT 'public.creators'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","workspace_id","display_name","avatar_url","level","xp","categories","social_handles","scores","status","created_at","onboarding_step","onboarding_completed","phone","referred_by","referral_code","level_seen" FROM "public"."creators") r) rows
UNION ALL
SELECT 'public.earnings_balances'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","workspace_id","available","updated_at" FROM "public"."earnings_balances") r) rows
UNION ALL
SELECT 'public.earnings_transactions'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","workspace_id","type","amount","balance_after","source_ref","description","created_at" FROM "public"."earnings_transactions") r) rows
UNION ALL
SELECT 'public.kb_chunks'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","document_id","chunk_index","content","token_count","embedding" FROM "public"."kb_chunks") r) rows
UNION ALL
SELECT 'public.kb_documents'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","source_type","source_ref","title","locale","workspace","content","content_hash","updated_at" FROM "public"."kb_documents") r) rows
UNION ALL
SELECT 'public.mission_shortlists'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","mission_id","creator_id","workspace_id","status","source","notes","created_by","updated_by","created_at","updated_at" FROM "public"."mission_shortlists") r) rows
UNION ALL
SELECT 'public.mission_submissions'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","mission_id","creator_id","workspace_id","status","content_urls","submission_data","reviewer_notes","xp_awarded","points_awarded","submitted_at","reviewed_at","review_deadline","created_at","quality_rating" FROM "public"."mission_submissions") r) rows
UNION ALL
SELECT 'public.missions'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","workspace_id","slug","title","description","category","mission_type","access_type","required_level","points_reward","cash_reward","cpm_rate","cpm_budget_pool","deadline","quota","filled","status","created_at","deliverables","requirements","platforms","effort","updated_at","published_at","closed_at","created_by","target_audience","dos","donts","key_messages","reference_links" FROM "public"."missions") r) rows
UNION ALL
SELECT 'public.notifications'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","user_id","workspace_id","type","entity_type","entity_id","data","read_at","created_at" FROM "public"."notifications") r) rows
UNION ALL
SELECT 'public.operator_audit_events'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","workspace_id","operator_id","actor_label","event_type","target_type","target_id","creator_id","mission_id","metadata","created_at" FROM "public"."operator_audit_events") r) rows
UNION ALL
SELECT 'public.point_balances'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","workspace_id","balance","available_from","available_to","updated_at" FROM "public"."point_balances") r) rows
UNION ALL
SELECT 'public.point_transactions'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","workspace_id","type","delta","balance_after","source_ref","description","created_at" FROM "public"."point_transactions") r) rows
UNION ALL
SELECT 'public.redemption_codes'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","gift_id","workspace_id","code","status","issued_to","issued_at","created_at" FROM "public"."redemption_codes") r) rows
UNION ALL
SELECT 'public.redemption_gifts'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","workspace_id","name","description","category","points_cost","stock_qty","stock_remaining","gift_type","image_url","status","valid_from","valid_to","created_at" FROM "public"."redemption_gifts") r) rows
UNION ALL
SELECT 'public.redemptions'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","creator_id","workspace_id","gift_id","code_id","code","points_spent","status","created_at" FROM "public"."redemptions") r) rows
UNION ALL
SELECT 'public.staff_users'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "user_id","email","active","created_at" FROM "public"."staff_users") r) rows
UNION ALL
SELECT 'public.workspace_budget_transactions'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","workspace_id","type","delta","balance_after","source_ref","description","created_at" FROM "public"."workspace_budget_transactions") r) rows
UNION ALL
SELECT 'public.workspace_budgets'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","workspace_id","balance","enforced","created_at","updated_at" FROM "public"."workspace_budgets") r) rows
UNION ALL
SELECT 'public.workspaces'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT "id","slug","name","plan","theme","settings","created_at" FROM "public"."workspaces") r) rows
) t;
ROLLBACK;
