-- Demo workspace
insert into public.workspaces (id, slug, name, theme) values
  ('00000000-0000-0000-0000-0000000000aa', 'demo', 'Demo Brand',
   '{"primary":"#D4FF00","secondary":"#D81B60","accent":"#7C5CFF","currency_label":"積分"}');

-- Demo missions (6)
insert into public.missions (workspace_id, slug, title, category, mission_type, points_reward, quota, filled) values
  ('00000000-0000-0000-0000-0000000000aa','koc-trial-serum','美容精華試用','美容','koc_trial',300,20,4),
  ('00000000-0000-0000-0000-0000000000aa','ugc-cafe','咖啡店打卡','餐飲','ugc',150,30,12),
  ('00000000-0000-0000-0000-0000000000aa','clip-skincare','護膚短片剪輯','美容','clipping',200,15,3),
  ('00000000-0000-0000-0000-0000000000aa','ugc-pet','寵物日常','寵物','ugc',120,25,9),
  ('00000000-0000-0000-0000-0000000000aa','koc-trial-mask','面膜試用','美容','koc_trial',250,10,7),
  ('00000000-0000-0000-0000-0000000000aa','ugc-travel','旅遊分享','旅遊','ugc',180,20,5);

-- Demo gifts (8)
insert into public.redemption_gifts (workspace_id, name, category, points_cost, stock_qty, stock_remaining, gift_type, status) values
  ('00000000-0000-0000-0000-0000000000aa','HK$50 現金券','現金券',500,100,42,'voucher','available'),
  ('00000000-0000-0000-0000-0000000000aa','精華樣品','美容',300,50,0,'physical','available'),
  ('00000000-0000-0000-0000-0000000000aa','咖啡券','餐飲',200,80,15,'voucher','available'),
  ('00000000-0000-0000-0000-0000000000aa','電子書','數碼',150,9999,9999,'digital','available'),
  ('00000000-0000-0000-0000-0000000000aa','面膜套裝','美容',400,40,8,'physical','available'),
  ('00000000-0000-0000-0000-0000000000aa','寵物零食','寵物',250,60,21,'physical','available'),
  ('00000000-0000-0000-0000-0000000000aa','SPA體驗','體驗',1200,10,2,'experience','available'),
  ('00000000-0000-0000-0000-0000000000aa','HK$100 現金券','現金券',1000,30,5,'voucher','available');
