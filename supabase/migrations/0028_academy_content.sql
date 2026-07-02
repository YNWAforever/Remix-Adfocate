-- 0028_academy_content.sql — C1.5 Academy → DB. Single source of truth for the authenticated
-- /guide surface + the AI-assistant KB (guide_doc bodies). Staff author in /admin. Global content
-- (no workspace_id). Applied to PROD via RAW SQL (execute_sql), NOT `db push` — the cloud migration
-- tracker is out of sync (0018–0027 applied out-of-tracker). Run `NOTIFY pgrst, 'reload schema';`
-- after applying so PostgREST sees the new table + RLS.

create table if not exists public.academy_content (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('guide_doc','track','playbook','resource')),
  slug           text not null unique,
  status         text not null default 'draft' check (status in ('draft','published','archived')),
  title_zh       text not null,
  title_en       text,
  excerpt_zh     text,
  excerpt_en     text,
  body_zh        text not null default '',
  body_en        text,
  category       text,
  required_level text check (required_level is null or required_level in
                   ('L0','L1','L2','L3','L4','L5','L6')),
  emoji          text,
  color          text,
  sort           int  not null default 0,
  metadata       jsonb not null default '{}'::jsonb,
  published_at   timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists academy_content_kind_status_sort_idx
  on public.academy_content (kind, status, sort);

-- Reuse the existing 0021 touch function (do NOT redefine it — that would clobber content_items).
-- Trigger/policy have no `if not exists` in Postgres; on a retry against an already-applied DB
-- these two `create` statements below will each emit a harmless "already exists" error — expected,
-- not a failure signal (matches this file's own re-apply contract per the header comment above).
create trigger academy_content_touch
  before update on public.academy_content
  for each row execute function public.content_touch_updated_at();

alter table public.academy_content enable row level security;
create policy academy_content_read_published on public.academy_content
  for select to authenticated using (status = 'published');
grant select on public.academy_content to authenticated;
grant all    on public.academy_content to service_role;

-- Guide docs seed (8 rows) -----
insert into public.academy_content
  (kind, slug, status, title_zh, title_en, category, emoji, sort, body_zh, published_at)
values
('guide_doc','account','published','帳戶','Account','account','👤',0, $md$平台以手機號碼作為登入方式，透過 WhatsApp 發送一次性驗證碼（OTP）完成驗證，毋須設定密碼。首次登入後會有入門引導，協助你設定內容範疇同完善帳號資料。

如需登出，可喺個人檔案頁面底部找到登出選項。如果遇到登入問題，例如收不到 OTP，可以重新輸入手機號碼再試，或稍等片刻後重試。$md$, now()),
('guide_doc','leveling','published','等級制度','Levels','start','⭐',1, $md$每次完成任務並獲得審批通過，你會同時賺取經驗值（XP）。XP 累積到一定數量後會自動升級，無需任何手動操作。

等級越高，代表你係平台上越資深嘅創作者。你嘅等級同 XP 進度會顯示喺個人檔案同創作者護照度，方便品牌合作夥伴了解你嘅活躍程度。持續完成更多任務，就能不斷積累 XP 升級，解鎖更多資深創作者嘅身份認證。$md$, now()),
('guide_doc','missions','published','任務','Missions','missions','🎯',2, $md$平台上的任務分為兩種類型：「公開任務」同「申請制任務」。

公開任務可以直接加入開始，毋須等候審批。申請制任務則需要先提交申請，由營運團隊審核後接受，才可以正式加入並開始完成任務。喺任務頁面可以睇到每個任務嘅詳細簡介、內容要求同獎勵積分，方便你決定係咪參與。揀啱任務後，按「加入」或「申請」按鈕即可開始流程。$md$, now()),
('guide_doc','submission','published','提交內容','Submitting Content','missions','📤',3, $md$成功加入任務後，請按照任務要求製作相關內容，然後提交你嘅作品連結或詳情。營運團隊會逐一審批提交內容。

審批通過後，你會即時獲得對應積分同 XP；若提交被拒，系統會列明被拒原因，你可以按指示修改後重新提交。每次提交的狀態分為：已提交、審批中、已通過、已拒絕，可隨時喺任務頁面查看最新進度。$md$, now()),
('guide_doc','points','published','積分','Points','rewards','🪙',4, $md$完成任務後，營運團隊審批通過即可獲得積分。積分可用於「積分兌換」換領禮品或優惠碼。
積分餘額會即時更新；如審批被拒，該次提交不會獲得積分。你可以在「錢包」查看現時積分。$md$, now()),
('guide_doc','redemption','published','兌換','Redemption','rewards','🎁',5, $md$累積足夠積分後，可以喺「積分兌換」頁面將積分換領禮品或優惠碼。選擇心儀獎勵並確認兌換後，積分會即時從餘額扣除。

已換領嘅禮品同優惠碼可喺「兌換記錄」查看，包括換領日期同對應嘅優惠碼詳情。請注意，兌換後積分不可退回，換領前請確認選擇正確嘅獎勵。$md$, now()),
('guide_doc','wallet','published','錢包','Wallet','rewards','💰',6, $md$錢包分為兩個獨立部分：積分同現金收益。

積分用嚟喺平台兌換禮品或優惠碼，每次任務審批通過後即時增加。現金收益則係部分任務提供嘅港幣獎勵，以唯讀方式記錄，不可用於兌換，屬於另行結算嘅收益。兩者分開計算，互不影響，可喺錢包頁面分別查看各自嘅餘額同歷史記錄。$md$, now()),
('guide_doc','profile','published','個人檔案','Profile','account','🪪',7, $md$個人檔案讓你展示自己作為創作者嘅身份。你可以設定顯示名稱、選擇內容創作範疇，以及填寫各社交平台帳號，包括 Instagram、小紅書、TikTok 同 YouTube。

創作者護照會根據你嘅檔案資料同任務記錄，自動計算並顯示你嘅等級、各項分數同已獲得嘅徽章。填寫完整嘅個人資料有助平台為你配對更合適嘅品牌任務，提升被選中嘅機會。$md$, now())
on conflict (slug) do nothing;

-- Learning tracks seed (9 rows) -----
insert into public.academy_content
  (kind, slug, status, title_zh, title_en, excerpt_zh, excerpt_en, required_level, emoji, color, sort, metadata, published_at)
values
('track','a1','published','KOC新手訓練營','KOC Starter Bootcamp',
 '由零開始了解KOC任務流程、賺取積分及建立個人品牌的基礎課程。',
 'Start from zero: learn the KOC mission flow, earn points, and build your personal brand.',
 'L0','🌱','pink',0,
 $j${"duration":{"en":"4 lessons","zh":"4堂課"},"levelLabel":"L0–L1","teaser_zh":"解鎖基礎：了解 KOC 任務流程，賺取你的第一批積分。","teaser_en":"Unlock the basics: learn how KOC missions work and earn your first points."}$j$, now()),
('track','a2','published','產品評測基礎','Product Review Basics',
 '學習撰寫真實有說服力的產品評測，提升品牌信任及任務評分。',
 'Write authentic, persuasive product reviews that build brand trust and lift your mission ratings.',
 'L1','⭐','yellow',1,
 $j${"duration":{"en":"3 lessons","zh":"3堂課"},"levelLabel":"L1+","teaser_zh":"達到 L1 即可解鎖：學習撰寫真實評測，提升品牌信任度。","teaser_en":"Reach L1 to unlock product review fundamentals and build brand trust."}$j$, now()),
('track','a3','published','Instagram Reels 增長術','Instagram Reels Growth',
 '掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。',
 'Master Reels editing, music selection, and the algorithm to grow your reach fast.',
 'L2','📱','mint',2,
 $j${"duration":{"en":"5 lessons","zh":"5堂課"},"levelLabel":"L2+","teaser_zh":"升至信譽 KOC 即可解鎖：掌握 Reels 剪接技巧與演算法攻略。","teaser_en":"Reach Trusted KOC to unlock Reels growth tactics and algorithm tips."}$j$, now()),
('track','a4','published','TikTok短片Hook技巧','TikTok Hook Techniques',
 '設計令人停止滑動的開場Hook，打造高留存率的短影片內容。',
 'Design scroll-stopping opening hooks and craft short videos with high retention.',
 'L2','🎬','blue',3,
 $j${"duration":{"en":"4 lessons","zh":"4堂課"},"levelLabel":"L2+","teaser_zh":"升至信譽 KOC 即可解鎖：學習令人停止滑動的 TikTok Hook 公式。","teaser_en":"Reach Trusted KOC to learn TikTok hook formulas that stop the scroll."}$j$, now()),
('track','a5','published','小紅書式內容創作','RED (Xiaohongshu) Content',
 '學習小紅書的圖文排版、種草文案及標籤策略，打入內地及港人市場。',
 'Learn RED photo-text layout, recommendation copy, and tag strategy to reach mainland and HK audiences.',
 'L2','📕','pink',4,
 $j${"duration":{"en":"3 lessons","zh":"3堂課"},"levelLabel":"L2+","teaser_zh":"升至信譽 KOC 即可解鎖：掌握小紅書圖文排版與種草文案技巧。","teaser_en":"Reach Trusted KOC to master RED-style content and reach new audiences."}$j$, now()),
('track','a6','published','聯盟推廣賺錢術','Affiliate Monetization',
 '建立聯盟推廣策略，選對產品、設計轉換內容，實現穩定被動收入。',
 'Build an affiliate strategy: pick the right products, design converting content, and earn steady passive income.',
 'L3','💰','lilac',5,
 $j${"duration":{"en":"4 lessons","zh":"4堂課"},"levelLabel":"L3+","teaser_zh":"升至微型創作者即可解鎖：透過聯盟推廣建立穩定被動收入。","teaser_en":"Reach Nano Creator to start building passive income through affiliate links."}$j$, now()),
('track','a7','published','直播電商培訓','Live Commerce Training',
 '直播選品、話術設計及互動技巧全攻略，助你成為直播帶貨達人。',
 'A full guide to live-selling: product picks, scripts, and audience interaction to become a live-commerce pro.',
 'L4','🎙️','mint',6,
 $j${"duration":{"en":"5 lessons","zh":"5堂課"},"levelLabel":"L4+","teaser_zh":"升至微網紅即可解鎖：直播帶貨全攻略，成為直播達人。","teaser_en":"Reach Micro-Influencer to unlock live commerce training and selling techniques."}$j$, now()),
('track','a8','published','品牌簡報及合規守則','Brand Briefs & Compliance',
 '解讀品牌Brief、了解廣告披露要求，確保內容專業合規。',
 'Read brand briefs and understand ad-disclosure rules to keep your content professional and compliant.',
 'L3','📋','yellow',7,
 $j${"duration":{"en":"2 lessons","zh":"2堂課"},"levelLabel":"L3+","teaser_zh":"升至微型創作者即可解鎖：解讀品牌 Brief，確保內容合規專業。","teaser_en":"Reach Nano Creator to learn how to read brand briefs and stay compliant."}$j$, now()),
('track','a9','published','創作者財務入門','Creator Finance 101',
 '管理自由工作者收入、稅務基礎及如何與品牌談判合理報酬。',
 'Manage freelance income, learn tax basics, and negotiate fair rates with brands.',
 'L3','🏦','blue',8,
 $j${"duration":{"en":"3 lessons","zh":"3堂課"},"levelLabel":"L3+","teaser_zh":"升至微型創作者即可解鎖：管理自由工作收入、稅務與品牌議價技巧。","teaser_en":"Reach Nano Creator to manage freelance income, taxes, and brand negotiations."}$j$, now())
on conflict (slug) do nothing;

-- Playbooks seed (6 rows) -----
insert into public.academy_content
  (kind, slug, status, title_zh, title_en, emoji, color, sort, metadata, published_at)
values
('playbook','pb-beauty','published','美妝護膚','Beauty & Skincare','💄','pink',0,
 $j${"levels":[{"en":"KOC Starter","zh":"KOC新手"},{"en":"Nano Creator","zh":"奈米創作者"},{"en":"Micro-KOL","zh":"微型KOL"},{"en":"Small KOL","zh":"小型KOL"}],"creatorAngle":{"en":"From product tester to beauty affiliate creator.","zh":"由產品試用者成為美妝聯盟創作者。"},"ideas":["KOC護膚試用配前後對比故事","奈米創作者教學系列（5天5個造型）","微型KOL聯盟優惠（12%佣金）","直播購物套裝推廣","創作者產品上市先行試用","成熟美妝KOC推廣活動"],"measurementFocus":"收藏數、評論情感分析、優惠券轉換率、創作者重複合作需求"}$j$, now()),
('playbook','pb-food','published','餐飲食肆','Food & Dining','🍜','yellow',1,
 $j${"levels":[{"en":"KOC Starter","zh":"KOC新手"},{"en":"Trusted KOC","zh":"受信任KOC"},{"en":"Nano Creator","zh":"奈米創作者"}],"creatorAngle":{"en":"From foodie to trusted local dining guide.","zh":"由美食愛好者成為受信任的本地飲食指南。"},"ideas":["餐廳開幕創作者報道","隱藏菜單挑戰","百元以下飲食系列","週末咖啡廳優惠任務","地區美食路線配地圖內容","家庭飲食KOC評測"],"measurementFocus":"到店人次、優惠券兌換、限時動態互動、粉絲增長"}$j$, now()),
('playbook','pb-travel','published','旅遊及酒店','Travel & Hotels','✈️','blue',2,
 $j${"levels":[{"en":"Trusted KOC","zh":"受信任KOC"},{"en":"Nano Creator","zh":"奈米創作者"},{"en":"Micro-KOL","zh":"微型KOL"}],"creatorAngle":{"en":"From travel sharer to travel content creator.","zh":"由旅遊分享者成為旅遊內容創作者。"},"ideas":["酒店KOC住宿評測","澳門一日遊任務","景點門票創作者指南","eSIM旅遊創作者活動","旅遊保險教育內容","飲食文化行程挑戰"],"measurementFocus":"訂房查詢、行程收藏、UGC質量、目的地認知度"}$j$, now()),
('playbook','pb-retail','published','零售及電商','Retail & E-commerce','🛍️','mint',3,
 $j${"levels":[{"en":"KOC Starter","zh":"KOC新手"},{"en":"Trusted KOC","zh":"受信任KOC"},{"en":"Nano Creator","zh":"奈米創作者"},{"en":"Micro-KOL","zh":"微型KOL"}],"creatorAngle":{"en":"From shopper to shopping-content creator and affiliate.","zh":"由購物者成為購物內容創作者及聯盟推廣員。"},"ideas":["產品開箱浪潮","短影片衝刺（10位創作者 × 3支Reels）","聯盟優惠券計劃","直播購物活動","節日禮品指南配創作者精選","產品對比系列"],"measurementFocus":"點擊率、優惠券使用量、聯盟轉換率、內容庫規模"}$j$, now()),
('playbook','pb-health','published','健康及保健','Health & Wellness','🌿','mint',4,
 $j${"levels":[{"en":"KOC Starter","zh":"KOC新手"},{"en":"Trusted KOC","zh":"受信任KOC"},{"en":"Nano Creator","zh":"奈米創作者"}],"creatorAngle":{"en":"From wellness enthusiast to trusted health creator.","zh":"由健康愛好者成為受信任的健康內容創作者。"},"ideas":["保健品KOC試用配打卡內容","健身挑戰（21天創作者旅程）","健康檢查教育系列","心理健康故事分享","營養教育短片","健康講座報道"],"measurementFocus":"打卡完成率、收藏數、信任訊號、教育觸及率"}$j$, now()),
('playbook','pb-finance','published','金融及保險','Finance & Insurance','💳','lilac',5,
 $j${"levels":[{"en":"Nano Creator","zh":"奈米創作者"},{"en":"Micro-KOL","zh":"微型KOL"},{"en":"Small KOL","zh":"小型KOL"}],"creatorAngle":{"en":"From everyday consumer to financial-literacy creator.","zh":"由日常消費者成為金融知識創作者。"},"ideas":["防騙教育活動","保險普及短片","信用卡生活方式活動","旅遊保險清單內容","理財健康挑戰","淺白金融FAQ系列"],"measurementFocus":"教育完成率、信任度提升、查詢量、內容收藏數"}$j$, now())
on conflict (slug) do nothing;

-- Resources seed (8 rows) -----
insert into public.academy_content
  (kind, slug, status, title_zh, title_en, emoji, sort, metadata, published_at)
values
('resource','r1','published','文案範本','Caption Templates','📝',0, $j${"type":{"en":"Template pack","zh":"範本包"},"fileUrl":null}$j$, now()),
('resource','r2','published','Hook 公式','Hook Formulas','🎣',1, $j${"type":{"en":"Playbook","zh":"攻略"},"fileUrl":null}$j$, now()),
('resource','r3','published','分鏡清單','Shot Lists','📸',2, $j${"type":{"en":"Checklist","zh":"清單"},"fileUrl":null}$j$, now()),
('resource','r4','published','媒體資料包範本','Media Kit Template','📁',3, $j${"type":{"en":"Template","zh":"範本"},"fileUrl":null}$j$, now()),
('resource','r5','published','報價表指南','Rate Card Guide','💵',4, $j${"type":{"en":"Guide","zh":"指南"},"fileUrl":null}$j$, now()),
('resource','r6','published','披露清單','Disclosure Checklist','✅',5, $j${"type":{"en":"Checklist","zh":"清單"},"fileUrl":null}$j$, now()),
('resource','r7','published','聯盟內容攻略','Affiliate Content Playbook','📈',6, $j${"type":{"en":"Playbook","zh":"攻略"},"fileUrl":null}$j$, now()),
('resource','r8','published','直播購物流程範本','Live Shopping Rundown Template','🎙️',7, $j${"type":{"en":"Template","zh":"範本"},"fileUrl":null}$j$, now())
on conflict (slug) do nothing;
