import type { StudioTopic } from "./types";
export const STUDIO_TEMPLATES: Array<{ id: string; topic: StudioTopic; icon: string; title: [string,string]; prompt: [string,string]; difficulty: [string,string]; minutes: number }> = [
  { id:"pick",topic:"missions",icon:"🧭",title:["挑一個適合我的任務","Find my next mission"],prompt:["這週哪些任務最適合我的時間和內容方向？","Which missions fit my time and content this week?"],difficulty:["入門","Easy"],minutes:5 },
  { id:"brief",topic:"creation",icon:"🎬",title:["把靈感變成拍攝 Brief","Turn an idea into a brief"],prompt:["幫我整理這個任務的腳本、鏡頭與拍攝清單。","Help me plan a script, shots and checklist for this mission."],difficulty:["入門","Easy"],minutes:15 },
  { id:"gap",topic:"creation",icon:"💡",title:["發現受眾的新問題","Find an unanswered question"],prompt:["受眾還有哪些問題未被回答好？請列出證據不足的地方。","Which audience questions are underserved? Mark evidence gaps."],difficulty:["進階","Medium"],minutes:15 },
  { id:"review",topic:"performance",icon:"🔎",title:["看看這篇貼文的表現","Review a post"],prompt:["幫我檢討這篇貼文；未連接的指標請標示未驗證。","Review my post. Mark unavailable metrics as unverified."],difficulty:["進階","Medium"],minutes:10 },
  { id:"reward",topic:"rewards",icon:"🎁",title:["規劃下一份小獎賞","Plan my next reward"],prompt:["根據已入帳積分和可做任務，規劃我的兌換路線。","Plan a reward using credited points and eligible missions."],difficulty:["入門","Easy"],minutes:5 },
  { id:"brand",topic:"missions",icon:"🤝",title:["找合拍的品牌","Find a brand fit"],prompt:["哪些品牌適合我的受眾？請說明依據和未驗證的部分。","Which brands fit my audience? Explain evidence and uncertainty."],difficulty:["進階","Medium"],minutes:10 },
  { id:"hook",topic:"creation",icon:"✨",title:["寫出有吸引力的開場","Create a compelling opening"],prompt:["根據已選來源，幫我寫三個真實、不誇大的開場。","Use my sources to suggest three truthful opening hooks."],difficulty:["入門","Easy"],minutes:5 },
  { id:"check",topic:"creation",icon:"✅",title:["提交前檢查一次","Check before submitting"],prompt:["對照任務要求，幫我找出作品還欠甚麼。","Compare my work with the mission requirements."],difficulty:["入門","Easy"],minutes:5 },
  { id:"revision",topic:"creation",icon:"🛠️",title:["把退修變成下一步","Make a revision plan"],prompt:["把審核意見整理成可逐項完成的修改清單。","Turn review feedback into a revision checklist."],difficulty:["進階","Medium"],minutes:15 },
  { id:"portfolio",topic:"performance",icon:"🏅",title:["整理我的成長成果","Collect my progress"],prompt:["把已核實成果整理成作品集摘要，分享前逐項確認。","Summarize verified work for my portfolio; confirm before sharing."],difficulty:["入門","Easy"],minutes:10 },
];
