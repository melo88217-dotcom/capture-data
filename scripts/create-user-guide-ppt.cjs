const pptxgen = require('pptxgenjs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const asset = (name) => path.join(root, 'slide-deck', 'account-monitoring-guide', 'assets', name);
const out = path.join(root, 'output', 'ppt', '对标账号监控-同事使用指南.pptx');
const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Codex';
pptx.subject = '对标账号监控系统同事使用指南';
pptx.title = '对标账号监控：同事使用指南';
pptx.company = '润美居空间设计';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei', lang: 'zh-CN'
};
pptx.defineLayout({ name: 'CUSTOM_WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'CUSTOM_WIDE';

const C = { navy: '101B3D', blue: '2F6BFF', cyan: '1BC5E8', ink: '172033', muted: '68738A', light: 'F5F7FB', line: 'DDE3EF', green: '19A974', amber: 'E9A23B', red: 'E75454', white: 'FFFFFF' };
const W = 13.333, H = 7.5;

function addBg(slide, color = C.white) { slide.background = { color }; }
function addFooter(slide, n) {
  slide.addText('润美居空间设计 · 对标账号监控', { x: 0.45, y: 7.12, w: 4.4, h: 0.2, fontFace: 'Microsoft YaHei', fontSize: 7.5, color: '8A94A6', margin: 0 });
  slide.addText(String(n).padStart(2, '0'), { x: 12.35, y: 7.08, w: 0.5, h: 0.22, align: 'right', fontFace: 'Microsoft YaHei', fontSize: 8, color: '8A94A6', margin: 0 });
}
function addTitle(slide, kicker, title, subtitle) {
  slide.addText(kicker, { x: 0.6, y: 0.42, w: 4.5, h: 0.25, fontFace: 'Microsoft YaHei', fontSize: 9, bold: true, color: C.blue, charSpace: 1.3, margin: 0 });
  slide.addText(title, { x: 0.6, y: 0.76, w: 11.8, h: 0.55, fontFace: 'Microsoft YaHei', fontSize: 25, bold: true, color: C.ink, margin: 0, breakLine: false, fit: 'shrink' });
  if (subtitle) slide.addText(subtitle, { x: 0.6, y: 1.38, w: 11.5, h: 0.34, fontFace: 'Microsoft YaHei', fontSize: 11, color: C.muted, margin: 0, fit: 'shrink' });
}
function addShot(slide, image, x, y, w, h) {
  slide.addShape(pptx.ShapeType.roundRect, { x: x - 0.04, y: y - 0.04, w: w + 0.08, h: h + 0.08, rectRadius: 0.06, fill: { color: 'E9EEF8' }, line: { color: 'E0E6F2', transparency: 100 }, shadow: { type: 'outer', color: '6A7890', opacity: 0.16, blur: 2, angle: 45, distance: 1 } });
  slide.addImage({ path: asset(image), x, y, w, h, sizing: { type: 'contain', x, y, w, h } });
}
function addCard(slide, x, y, w, h, title, body, tone = C.blue) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: C.line, width: 0.7 } });
  slide.addShape(pptx.ShapeType.roundRect, { x: x + 0.22, y: y + 0.22, w: 0.1, h: h - 0.44, rectRadius: 0.04, fill: { color: tone }, line: { color: tone, transparency: 100 } });
  slide.addText(title, { x: x + 0.48, y: y + 0.23, w: w - 0.68, h: 0.28, fontFace: 'Microsoft YaHei', fontSize: 12.5, bold: true, color: C.ink, margin: 0 });
  slide.addText(body, { x: x + 0.48, y: y + 0.62, w: w - 0.68, h: h - 0.78, fontFace: 'Microsoft YaHei', fontSize: 10, color: C.muted, breakLine: false, margin: 0, fit: 'shrink', valign: 'mid' });
}
function addStep(slide, n, title, detail, x, y) {
  slide.addShape(pptx.ShapeType.ellipse, { x, y, w: 0.46, h: 0.46, fill: { color: C.blue }, line: { color: C.blue, transparency: 100 } });
  slide.addText(String(n), { x, y: y + 0.07, w: 0.46, h: 0.2, align: 'center', fontFace: 'Microsoft YaHei', fontSize: 10, bold: true, color: C.white, margin: 0 });
  slide.addText(title, { x: x + 0.63, y: y - 0.01, w: 2.55, h: 0.25, fontFace: 'Microsoft YaHei', fontSize: 12, bold: true, color: C.ink, margin: 0 });
  slide.addText(detail, { x: x + 0.63, y: y + 0.29, w: 2.55, h: 0.45, fontFace: 'Microsoft YaHei', fontSize: 9.5, color: C.muted, margin: 0, fit: 'shrink' });
}

// 1 cover
{
  const s = pptx.addSlide();
  s.background = { color: C.navy };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.navy }, line: { color: C.navy, transparency: 100 } });
  s.addImage({ path: asset('cover-visual.png'), x: 5.6, y: 0, w: 7.75, h: 7.5, sizing: { type: 'cover', x: 5.6, y: 0, w: 7.75, h: 7.5 }, transparency: 5 });
  s.addText('内部使用指南', { x: 0.72, y: 1.1, w: 2.4, h: 0.3, fontFace: 'Microsoft YaHei', fontSize: 10.5, bold: true, color: '79DFF2', charSpace: 1.5, margin: 0 });
  s.addText('对标账号监控', { x: 0.72, y: 1.7, w: 5, h: 0.6, fontFace: 'Microsoft YaHei', fontSize: 31, bold: true, color: C.white, margin: 0 });
  s.addText('同事使用指南', { x: 0.72, y: 2.42, w: 4.5, h: 0.45, fontFace: 'Microsoft YaHei', fontSize: 20, color: 'C9D5FF', margin: 0 });
  s.addText('从添加账号，到采集、分析与周度复盘', { x: 0.72, y: 3.28, w: 4.6, h: 0.32, fontFace: 'Microsoft YaHei', fontSize: 12, color: 'D6DCEF', margin: 0 });
  s.addShape(pptx.ShapeType.line, { x: 0.72, y: 4.05, w: 1.6, h: 0, line: { color: C.cyan, width: 2 } });
  s.addText('适用对象：运营与内容团队', { x: 0.72, y: 4.3, w: 3.5, h: 0.25, fontFace: 'Microsoft YaHei', fontSize: 10, color: 'B7C4DF', margin: 0 });
  s.addText('润美居空间设计', { x: 0.72, y: 6.75, w: 3.2, h: 0.22, fontFace: 'Microsoft YaHei', fontSize: 9, color: '9BB0D6', margin: 0 });
}

// 2 system map
{
  const s = pptx.addSlide(); addBg(s, C.light); addTitle(s, '01 / 先了解系统', '它帮你持续观察对标账号的公开数据', '把零散的公开页面数据，变成可追踪、可比较、可导出的运营信息。');
  const items = [ ['添加账号', '录入抖音或视频号主页'], ['自动采集', '按设定频率抓取公开指标'], ['查看变化', '按日、按周观察增长与互动'], ['导出复盘', '按筛选条件下载 CSV / Excel'] ];
  items.forEach((it, i) => { const x = 0.7 + i * 3.12; addCard(s, x, 2.35, 2.75, 1.5, it[0], it[1], [C.blue,C.cyan,C.green,C.amber][i]); if (i < 3) s.addShape(pptx.ShapeType.chevron, { x: x + 2.82, y: 2.9, w: 0.28, h: 0.35, fill: { color: 'B8C5DE' }, line: { color: 'B8C5DE', transparency: 100 } }); });
  s.addText('采集边界', { x: 0.72, y: 4.55, w: 2, h: 0.3, fontFace: 'Microsoft YaHei', fontSize: 13, bold: true, color: C.ink, margin: 0 });
  s.addText('只采集公开可见的账号与视频聚合指标；遇到登录、验证码或权限限制会停止。不会采集评论用户、粉丝列表、私信或视频文件。', { x: 0.72, y: 4.95, w: 11.8, h: 0.55, fontFace: 'Microsoft YaHei', fontSize: 12, color: C.muted, margin: 0, fit: 'shrink' });
  addFooter(s, 2);
}

// 3 overview
{
  const s = pptx.addSlide(); addBg(s); addTitle(s, '02 / 从概览开始', '左侧导航定位功能，概览页确认系统状态', '打开系统后，先确认数据更新时间、采集结果和待处理任务。');
  addShot(s, 'overview.png', 0.65, 1.95, 7.55, 4.65);
  addCard(s, 8.65, 2.1, 3.95, 1.02, '① 左侧导航', '切换概览、账号、视频、每日变化、爆款、任务、周汇总和设置。', C.blue);
  addCard(s, 8.65, 3.38, 3.95, 1.02, '② 顶部操作', '“刷新”重新拉取页面数据；“新增账号”打开录入表单。', C.cyan);
  addCard(s, 8.65, 4.66, 3.95, 1.02, '③ 先看三个信号', '数据更新时间、采集失败数、待处理任务。它们决定是否需要人工介入。', C.green);
  addFooter(s, 3);
}

// 4 add account
{
  const s = pptx.addSlide(); addBg(s, C.light); addTitle(s, '03 / 添加账号', '用“新增账号”建立你的第一个观察对象', '建议先从最重要的 3–5 个同行、达人或品牌账号开始。');
  addShot(s, 'add-account.png', 7.55, 1.75, 4.85, 4.95);
  addStep(s, 1, '选择平台', '当前支持抖音和视频号。', 0.78, 2.1);
  addStep(s, 2, '填写名称与主页链接', '名称用于系统内识别；链接必须是账号主页。', 0.78, 3.05);
  addStep(s, 3, '设定采集规则', '选择频率、更新时间和每次更新的视频条数。', 0.78, 4.0);
  addStep(s, 4, '补充分组信息', '分类、标签、备注有助于后续筛选和复盘。', 0.78, 4.95);
  s.addShape(pptx.ShapeType.roundRect, { x: 0.78, y: 5.98, w: 5.5, h: 0.5, rectRadius: 0.06, fill: { color: 'E8F1FF' }, line: { color: 'C8DCFF', width: 0.6 } });
  s.addText('保存后，账号会出现在“对标账号”列表；首次可点“立即更新”拉取数据。', { x: 1.0, y: 6.13, w: 5.05, h: 0.18, fontFace: 'Microsoft YaHei', fontSize: 9.8, color: '2759A5', margin: 0, align: 'center' });
  addFooter(s, 4);
}

// 5 account strategy
{
  const s = pptx.addSlide(); addBg(s); addTitle(s, '04 / 配置采集策略', '频率决定时效，预警线帮助你发现值得复盘的视频', '这些设置都可以直接在“对标账号”列表内调整。');
  addShot(s, 'accounts.png', 0.65, 1.92, 7.8, 4.76);
  addCard(s, 8.85, 2.05, 3.75, 1.0, '自动采集频率', '可选择每 1 小时、每 6 小时、每天、每周或手动。日常建议“每天”。', C.blue);
  addCard(s, 8.85, 3.3, 3.75, 1.0, '更新时间与视频条数', '设定执行时段及单次更新范围，兼顾时效与数据量。', C.cyan);
  addCard(s, 8.85, 4.55, 3.75, 1.0, '点赞预警线', '达到阈值的视频会进入“爆款视频”，便于快速挑选复盘对象。填 0 表示不启用。', C.amber);
  s.addText('注意：清空数据会保留账号和采集设置；删除账号会移除该账号。两者都要谨慎操作。', { x: 8.87, y: 5.9, w: 3.66, h: 0.4, fontFace: 'Microsoft YaHei', fontSize: 9.5, color: C.red, margin: 0, fit: 'shrink' });
  addFooter(s, 5);
}

// 6 job tracking
{
  const s = pptx.addSlide(); addBg(s, C.light); addTitle(s, '05 / 立即更新与任务追踪', '需要最新数据时，点“立即更新”，再到“采集任务”确认结果', '立即更新不会改变原有自动采集计划。');
  const xs = [0.8, 3.95, 7.1, 10.25];
  const steps = [ ['1', '在账号行点击', '立即更新'], ['2', '系统创建', '采集任务'], ['3', '等待任务完成', '查看状态与时间'], ['4', '异常时查看', '结果说明 / 失败原因'] ];
  steps.forEach((st, i) => { s.addShape(pptx.ShapeType.roundRect, { x: xs[i], y: 2.4, w: 2.25, h: 1.65, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.line, width: 0.8 } }); s.addShape(pptx.ShapeType.ellipse, { x: xs[i] + 0.82, y: 2.58, w: 0.6, h: 0.6, fill: { color: [C.blue,C.cyan,C.green,C.amber][i] }, line: { color: [C.blue,C.cyan,C.green,C.amber][i], transparency: 100 } }); s.addText(st[0], { x: xs[i] + 0.82, y: 2.72, w: 0.6, h: 0.18, fontFace: 'Microsoft YaHei', fontSize: 10, bold: true, color: C.white, align: 'center', margin: 0 }); s.addText(st[1], { x: xs[i] + 0.2, y: 3.36, w: 1.85, h: 0.22, fontFace: 'Microsoft YaHei', fontSize: 10.8, bold: true, color: C.ink, align: 'center', margin: 0 }); s.addText(st[2], { x: xs[i] + 0.2, y: 3.65, w: 1.85, h: 0.2, fontFace: 'Microsoft YaHei', fontSize: 9.2, color: C.muted, align: 'center', margin: 0 }); if (i < 3) s.addShape(pptx.ShapeType.chevron, { x: xs[i] + 2.43, y: 3.0, w: 0.3, h: 0.34, fill: { color: 'B8C5DE' }, line: { color: 'B8C5DE', transparency: 100 } }); });
  s.addShape(pptx.ShapeType.roundRect, { x: 1.05, y: 4.85, w: 11.2, h: 0.95, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'D6E1F4', width: 0.8 } });
  s.addText('判断是否完成：任务状态为“成功”或“部分成功”且完成时间已更新。若为“失败”，先查看结果说明，确认是否因页面变化、网络、登录或权限限制导致。', { x: 1.35, y: 5.17, w: 10.6, h: 0.27, fontFace: 'Microsoft YaHei', fontSize: 11.2, color: C.ink, align: 'center', margin: 0, fit: 'shrink' });
  addFooter(s, 6);
}

// 7 videos
{
  const s = pptx.addSlide(); addBg(s); addTitle(s, '06 / 看视频数据并导出', '筛选后再阅读，导出时会沿用当前筛选条件', '视频数据页适合回答：最近发了什么、互动如何、哪些内容值得拆解。');
  addShot(s, 'videos.png', 0.6, 1.85, 8.4, 4.9);
  addCard(s, 9.35, 2.0, 3.25, 1.08, '① 账号 + 时间范围', '先选对标账号，再选择最近 7 / 30 / 90 天或自定义区间。', C.blue);
  addCard(s, 9.35, 3.32, 3.25, 1.08, '② 读三项互动指标', '点赞、评论、收藏反映不同类型的内容反馈。收藏未公开时会明确标记。', C.cyan);
  addCard(s, 9.35, 4.64, 3.25, 1.08, '③ 导出 CSV / Excel', '下载前确认筛选条件；导出的内容与当前页面条件一致。', C.green);
  addFooter(s, 7);
}

// 8 daily weekly
{
  const s = pptx.addSlide(); addBg(s, C.light); addTitle(s, '07 / 用“每日变化”和“周汇总”完成复盘', '日看波动，周看趋势：不要只看单条视频的绝对值', '更值得关注的是一段时间内账号、作品量和互动量的变化。');
  addShot(s, 'daily.png', 0.6, 2.0, 5.85, 3.95);
  addShot(s, 'weekly.png', 6.85, 2.0, 5.85, 3.95);
  s.addText('每日变化', { x: 0.85, y: 6.18, w: 1.7, h: 0.25, fontFace: 'Microsoft YaHei', fontSize: 13, bold: true, color: C.ink, margin: 0 });
  s.addText('按日期观察粉丝、作品、赞评藏的增减；可按账号筛选并导出。', { x: 0.85, y: 6.48, w: 5.3, h: 0.25, fontFace: 'Microsoft YaHei', fontSize: 9.8, color: C.muted, margin: 0, fit: 'shrink' });
  s.addText('周汇总', { x: 7.1, y: 6.18, w: 1.7, h: 0.25, fontFace: 'Microsoft YaHei', fontSize: 13, bold: true, color: C.ink, margin: 0 });
  s.addText('对比本周与上周，优先复盘连续增长、作品变化大或互动异常的账号。', { x: 7.1, y: 6.48, w: 5.3, h: 0.25, fontFace: 'Microsoft YaHei', fontSize: 9.8, color: C.muted, margin: 0, fit: 'shrink' });
  addFooter(s, 8);
}

// 9 status
{
  const s = pptx.addSlide(); addBg(s); addTitle(s, '08 / 看懂状态，避免误读数据', '“没有数据”不一定是失败；先识别状态，再决定是否处理', '系统会显式区分公开程度、采集结果和数据是否足够。');
  const data = [ ['成功', '已采到核心公开指标，可正常分析。', C.green], ['部分成功', '只采到部分公开信息，部分字段可能为空。', C.amber], ['平台未公开', '页面可访问，但该字段没有公开展示；不等于 0。', '8090A7'], ['采集失败', '页面访问或解析未成功；查看任务说明后再处理。', C.red], ['数据不足', '缺少有效历史数据，暂不宜做趋势判断。', C.blue] ];
  data.forEach((d, i) => { const y = 1.95 + i * 0.88; s.addShape(pptx.ShapeType.roundRect, { x: 0.82, y, w: 11.7, h: 0.63, rectRadius: 0.06, fill: { color: i % 2 ? 'F8FAFD' : 'FFFFFF' }, line: { color: C.line, width: 0.5 } }); s.addShape(pptx.ShapeType.ellipse, { x: 1.08, y: y + 0.18, w: 0.24, h: 0.24, fill: { color: d[2] }, line: { color: d[2], transparency: 100 } }); s.addText(d[0], { x: 1.55, y: y + 0.16, w: 1.65, h: 0.22, fontFace: 'Microsoft YaHei', fontSize: 12, bold: true, color: C.ink, margin: 0 }); s.addText(d[1], { x: 3.1, y: y + 0.15, w: 8.7, h: 0.24, fontFace: 'Microsoft YaHei', fontSize: 10.5, color: C.muted, margin: 0, fit: 'shrink' }); });
  s.addShape(pptx.ShapeType.roundRect, { x: 0.82, y: 6.56, w: 11.7, h: 0.35, rectRadius: 0.04, fill: { color: 'FFF6EA' }, line: { color: 'F4D19D', width: 0.5 } });
  s.addText('重要：请勿把“平台未公开”或“数据不足”按 0 处理；它们不能直接用于增长结论。', { x: 1.05, y: 6.66, w: 11.2, h: 0.14, fontFace: 'Microsoft YaHei', fontSize: 9.5, color: '9A5C13', align: 'center', margin: 0 });
  addFooter(s, 9);
}

// 10 checklist
{
  const s = pptx.addSlide(); addBg(s, C.navy); s.addText('09 / 日常使用清单', { x: 0.7, y: 0.55, w: 3.5, h: 0.25, fontFace: 'Microsoft YaHei', fontSize: 10, bold: true, color: '79DFF2', charSpace: 1.2, margin: 0 }); s.addText('用一个轻量节奏，把监控变成行动', { x: 0.7, y: 0.95, w: 8.5, h: 0.5, fontFace: 'Microsoft YaHei', fontSize: 25, bold: true, color: C.white, margin: 0 });
  const checks = [ ['每天 5 分钟', '查看概览的数据更新时间、采集失败数与待处理任务。'], ['每周 20 分钟', '进入周汇总，筛选重点账号，找出增长、互动与发文节奏的变化。'], ['发现爆款时', '进入视频数据或爆款视频，记录标题、形式、互动表现和可借鉴点。'], ['出现异常时', '打开采集任务查看原因；不要把未公开或数据不足误判成 0。'] ];
  checks.forEach((c, i) => { const y = 2.0 + i * 1.04; s.addShape(pptx.ShapeType.roundRect, { x: 0.85, y, w: 11.55, h: 0.78, rectRadius: 0.08, fill: { color: '1D2B55', transparency: 12 }, line: { color: '52668F', width: 0.6 } }); s.addShape(pptx.ShapeType.ellipse, { x: 1.18, y: y + 0.2, w: 0.36, h: 0.36, fill: { color: [C.cyan,C.green,C.amber,'EF7676'][i] }, line: { color: [C.cyan,C.green,C.amber,'EF7676'][i], transparency: 100 } }); s.addText('✓', { x: 1.18, y: y + 0.255, w: 0.36, h: 0.12, fontFace: 'Microsoft YaHei', fontSize: 8, bold: true, color: C.navy, align: 'center', margin: 0 }); s.addText(c[0], { x: 1.8, y: y + 0.18, w: 2.1, h: 0.22, fontFace: 'Microsoft YaHei', fontSize: 12.5, bold: true, color: C.white, margin: 0 }); s.addText(c[1], { x: 4.0, y: y + 0.19, w: 7.7, h: 0.22, fontFace: 'Microsoft YaHei', fontSize: 10.5, color: 'C7D3EE', margin: 0, fit: 'shrink' }); });
  s.addText('使用原则：先确认数据状态，再做判断；重点关注趋势，不只看单次数字。', { x: 0.9, y: 6.62, w: 11.5, h: 0.28, fontFace: 'Microsoft YaHei', fontSize: 12, bold: true, color: '9DDCF0', align: 'center', margin: 0 });
  s.addText('润美居空间设计 · 对标账号监控', { x: 0.7, y: 7.08, w: 4.4, h: 0.2, fontFace: 'Microsoft YaHei', fontSize: 7.5, color: '90A3C7', margin: 0 });
}

pptx.writeFile({ fileName: out });
