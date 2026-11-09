# 四色领地大战 Four-Color Territory War · 弹珠出兵版

红、蓝、绿、黄四方全自动对战的 2D 网页小游戏。浏览器打开即可观看，无需安装。

在线观看：https://birdfry.github.io/four-color-war/

- 左侧为四方共用的第一弹珠框与各方第二模块，右侧为实时战场；手机竖屏也保留左右分栏，并在下方显示阵营卡片、AI 档案、战报和规则。
- 每方开局 2 条弹珠流，复制点数与场上军队不设总量上限。所有阵营共用第一模块：先经过中层的 ×16、×8、×4、×2 纯倍率选项（不发射），再经过底部的倍率选项或左、中、右三个发射槽之一，因此每次出兵前有两次倍率选择机会；倍率会累积并乘到当前基值上。只在第一模块倍率槽之间回环的弹珠保留累积倍率；进入对应阵营的第二模块完成兵种选择后，下一次发射才清零累积倍率。每次进入第一模块时，基值仍按当前比赛时间更新：0:00–2:59 为 1 点，3:00 为 5 点，此后每到整分钟再加 5 点（4:00 为 10、5:00 为 15、6:00 为 20）。
- 弹珠发射与回流动画已提速。点数以精确的大整数质量附在弹珠流上，不再生成待发小球；每次进入共享第一模块时按当前分钟更新基值，并乘上仍保留的累计倍率。进入第二模块完成兵种选择后，累计倍率才会重置；点数随流进入第二模块并形成对应战力。这样既保留无限复制，也避免入口队列堆积和过多物理对象拖慢浏览器。总点数统一用 K/M/B/T 表示（千/百万/十亿/万亿），不再用科学计数法；点数始终精确保留。
- 卡顿防护：事件历史采用固定容量环形缓冲，战斗/A*工作区复用；每帧最多补算 8 个固定模拟步或使用约 12 毫秒模拟预算，过载时丢弃滞后步以避免追帧循环。联盟查询使用缓存；A* 每个模拟步最多重算 24 条路径（高速时降低预算），按士兵轮转分配；拥挤格的目标扫描轮换采样各阵营最多 2 名真实士兵，军队仍无数量上限且每名士兵独立移动、战斗和受击；活跃单位超过 256 时，精灵改为批量绘制的彩色兵团点位（英雄保留金色描边、至多32个巨型兵标注），只简化外观、不合并或隐藏单位。特效与在途箭矢数量有上限；超限箭矢改为即时命中结算，不会丢失伤害或增加待发队列。
- 大质量弹珠更难进入共享第一模块的 ×2/×4/×8/×16 倍率槽：第一模块碰撞半径按 `6 + min(2.5, 0.11 × floor(log2(m)))` 像素增长，水平初速除以 `1 + 0.04 × log10(m)`；碰撞半径最高 8.5 像素，保证仍能通过针阵。卡住超过 12 秒的弹珠会自动回到起点；每次重新进入第一模块时按当前分钟基值与保留的累计倍率重新计算点数，进入第二模块完成选兵后累计倍率归一为 1。未进入倍率槽则不获得槽位加成。质量为 m 时，单位生命与攻击倍率为 `1 + min(3, 0.2 × log10(m))`（最高 4×），防御倍率为 `1 + min(0.5, 0.04 × log10(m))`（最高 1.5×，即最多减伤约 33%），兵的体型随弹珠质量增大，体型倍率为 `1 + min(0.6, 0.08 × log10(m))`（最高 1.6×）。例如 16M 兵团约有 2.44× 生命/攻击倍率、1.29× 防御倍率，头顶显示“16M + 兵种”；成长收益递减，避免巨量份数瞬间无敌。
- 奖励弹珠：中心广场占领超过 30% 可得 1 条弹珠流（每局一次）；累计出兵 20/50/90 各额外奖励 1 条。
- 8:00 开启决战风暴，10:00 领土裁决。
- 速度按钮可在 1×、2×、4×、8×、16× 间循环切换，默认 1×；加速推进模拟时钟，不改变游戏秒规则。设备负载过高时有单帧追赶上限，可能降低实际加速倍率，但不会让浏览器为补进度连续卡住。
- 实时按领地面积排名，第 2、3、4 名的弹珠速度各 +3%；并列阵营共享名次与加成。
- 己方领地内军队攻速 +5%，每秒恢复 5 点生命。国王塔基础射程为 8 格，会自动攻击射程内最近的敌军，每 1.5 秒造成 22 点伤害。
- 国王塔的最大生命和射程随本方实时占地按同一条曲线增长。占地份额 = 本方领地格数 / 全图 1,024 格；成长系数 = min(占地份额 / 40%, 1)。最大生命 = 2,000 × (1 + 20% × 成长系数)，射程 = 8 × (1 + 12.5% × 成长系数) 格；所以最多 2,400 生命、9 格射程。所有阵营使用同一公式，份额达到 40% 后封顶；未占领格（包括障碍格）不计入任何阵营。占地变化时保留已受的绝对伤害，不会因成长规则把旧伤免费治好。
- 圣盾的城堡治疗上限随国王塔最大生命同步提高。阵营被敌方攻破/淘汰时，其半径七格王塔保护圈转归有效击败方；普通城堡受击不会提前改色。
- 联盟按直接双边盟约判定：A–B、B–C 结盟时，A 与 C 仍是敌人，可以互相攻击、攻城和染色；联盟关系链最多三方，禁止四方全盟。盟友名单只显示直接盟友。若三方彼此都直接结盟且场上只剩一个共同敌方，三方会协调攻击该敌方城堡并优先选择共同敌方；这是进攻倾向，不是行动限制，各方仍可自由争夺广场、拾取技能、回防、拉扯或撤退。优势明显时可能背叛；盟约约持续 52–76 秒，到期后恢复敌对；若只剩两个阵营，会强制破盟避免终局僵持。若最后三方都互相结盟、没有敌人，士兵仍会争夺广场、拾取技能并在战场巡逻，不会停在原地。
- 背叛惩罚：背叛方现役及新部署军队的生命上限、当前生命、攻击、移动速度、攻速、攻击/侦测距离、护甲效果和治疗量降低 20%，持续 15 秒；到期恢复原始属性，重复触发只刷新计时、不叠加。
- 进攻目标会在所有存活敌方间轮换，包括非相邻和斜对角阵营；遇到近处敌军仍会优先交战。A* 网格寻路会结合拥挤度、敌方压力与绕行策略前往目标。
- 每局随机生成石块障碍；士兵不能穿石，只能绕行，斜向移动也不能切过障碍拐角。每次放置都会检查地图连通性，确保所有可行走区域仍有路线相通；障碍不会堵住城堡出生区和中心广场。
- 红色烈焰狂战士攻击伤害调整为 12（原为 14），生命值仍为 94、攻击间隔仍为 0.8 秒；近战命中仍会让被击中的敌方单位眩晕 2 秒，不造成溅射；每 5 秒触发 2 秒霸体/锁血，最多 3 次。绿色森灵树人治疗 4 点/秒；黄色曙光骑兵生命值 110、攻击 19。蓝色潮汐法师生命值提高至 58，攻击距离为 185，直击造成 7 点、周围溅射造成 6 点伤害，不再减速；每发射 10 次后转为剑士。
- 每方 AI 会结合敌方火力走廊、友军拥堵、城堡威胁、部队损耗和射程压力，持续学习攻塔、争夺中心、寻技、回防、低血撤退、远程拉扯与绕行偏好。另有最多 16 类局势记忆，将低血量、是否接敌、主城压力和排名组合成状态，并按发生在该局势中的奖励/惩罚更新。学习档案保存在本机；旧档案会自动补上空白情境记忆，已有权重不受影响。
- 内置 AI 按真实结果计奖惩：敌军实际损血每占目标最大生命值的 100% 奖攻击策略 +0.85，击杀再 +0.65；己方承伤按实际损血扣分（每损失 100% 最大生命值 −0.40，阵亡另 −0.70）。成功改色的地块每格 +0.035（中立）或 +0.055（敌方），城堡实际掉血按城堡生命比例奖攻方 +0.90、扣守方 −0.70，攻破城堡另 +1.2。实际拾取技能 +0.45；撤退中的单位只因真实回血获得小额奖励。未命中、未改色或未造成城堡损血不会得分；得分另按 0.60 倍归于目标路线、0.25 倍归于不同的战术路线、0.12 倍归于直进/迂回路线。
- 权重每 4 个模拟秒按“奖励 ÷ 该策略实际使用时间”平滑更新并限幅；局势记忆使用同一批事件奖励。胜局/败局只给实际用过的策略提供很轻的末局信号（每种策略至多计 60 秒），不把胜负任意归给所谓“最佳动作”。正向奖励增加 AI 经验，负向奖励降低对应权重；每 10 局冠军复制与实验突变保持不变。已注册策略插件仍控制所分配阵营，奖励学习不会替插件改写决策。
- AI 对未拾取的场上技能提高 35% 基础寻取权重（1.35×），仍按距离、敌方压力与技能剩余时间挑选；已拾取或过期技能会移出候选。回防、撤退与接敌决策优先，不会被寻技覆盖。
- 每 10 局进行一次 AI 进化：选出这 10 局获胜次数最多的 AI 为冠军，并把冠军的学习策略（包括情境记忆）复制给随机选出的 3 个不同阵营；剩下的阵营保留自己的学习记录，基于现有策略生成带有权重突变、新战术风格和轻微情境记忆变异的实验 AI，继续探索。胜场并列时按这 10 局累计表现分决胜；表现分仍相同时，按红、蓝、绿、黄的固定顺序决胜。每轮结束后重新累计 10 局；进化只复制策略，不改变各阵营的专属单位和规则。
- 右侧「四国 AI 学习档案」显示各方策略；桌面展示路线权重、战术代码和进化记录，手机简化为更易读的重点摘要。画布文字会按面板宽度自适配，战报和规则说明保留在各自区块内。
- 游戏只播放当前唯一领队阵营的英文歌曲，不播放弹珠碰撞、战斗、环境、胜利或其他音效。四方歌曲各有不同主创，逐曲来源与授权列于“Music credits”。并列领地时保持当前歌曲；新阵营唯一领先并稳定 2.5 秒后自动切换，采用 3 秒交叉淡化。首次普通页面交互会解锁音频，之后歌曲按需加载，领地变化会自动播放新歌，无需再手动点音乐开关。音乐开关与音量控制仍保留。

- 可在 AI 学习档案面板点击「重置 AI 学习」，确认后恢复四方默认策略并清除 AI 战绩与进化历史；不会重置当前战局、游戏控制或其他本机设置。
- 远程兵会依照射程、生命值和敌情拉扯；城堡受威胁或受损时会动态增加回防兵力，低血量部队会向己方安全方向撤退并尝试在己方领土恢复。
- 国王塔周围半径 7 格是本方永久保护区，敌军经过或技能染色都不能改变颜色。炸弹只在不同颜色领地交界处出现；加速在中心，圣盾在危急城堡附近，王冠在前线。

## 外部 AI 策略插件

其他策略代码可通过运行时 API `window.FourColorWarAI` 接入；游戏没有策略粘贴或导入界面。先注册策略对象，再把它分配给阵营（0 红、1 蓝、2 绿、3 黄）。例如：

```js
window.FourColorWarAI.register('example', {
  name: 'Example strategy',
  apiVersion: '1.0.0',
  decide(ctx) {
    const enemy = ctx.enemies[0];
    const nearby = ctx.nearbyEnemies[0];
    return {
      mode: ctx.signals.homePressure > 0.35 ? 'defend' : 'attack',
      goal: enemy ? { x: [78, 742, 78, 742][enemy.f], y: [78, 78, 742, 742][enemy.f] } : { x: 410, y: 410 },
      goalKind: enemy ? 'tower' : 'plaza',
      targetFaction: enemy?.f,
      targetId: nearby?.id,
      routeStyle: 'direct',
      refreshAfter: 0.75
    };
  },
  onMatchEnd(result) { /* 可选 */ }
});
window.FourColorWarAI.setFactionStrategy(1, 'example');
```

`decide(ctx)` 是同步函数，返回 0–820 世界坐标中的 `goal`；还可指定 `mode`（`attack`、`kite`、`defend`、`retreat`、`skill`）、`goalKind`（`tower`、`plaza`、`power`、`defend`、`retreat`、`kite`、`patrol`）、敌方 `targetFaction`、从 `ctx.nearbyEnemies` 中选择的近身敌军 `targetId`、路线风格 `routeStyle`（`direct`/`flank`）及重新决策间隔 `refreshAfter`（0.25–5 秒）。只读上下文提供单位、阵营/敌方/盟友概况、可检测到的附近敌军、技能点、地图格查询，以及该阵营当前学习到的策略权重。可选的 `onMatchEnd(result)` 会在赛后调用。插件返回无效结果或抛出异常时，该单位会回退到内置策略；每次注册最多记录一次插件错误。

用 `window.FourColorWarAI.setFactionStrategy(1, null)` 恢复该阵营的内置策略；`list()` 可查看注册项，`unregister('example')` 可移除插件。注册和分配只在当前页面运行期间有效，需由插件脚本在每次加载时执行。插件以普通页面 JavaScript 运行，并非安全沙箱，只接入可信代码。即使阵营使用插件，游戏原有奖励回馈、本机持久化学习档案和每十局进化仍会继续运行。

## Music credits

All four embedded tracks have individual ccMixter upload pages that label the track **Creative Commons Attribution 3.0 (CC BY 3.0)**. CC BY 3.0 permits copying, redistribution and commercial use, including bundling and playback in a game, provided the attribution and license link are retained. The ccMixter site-wide footer applies to site text and images; each linked audio upload page separately states the license for that track. The source recordings were re-encoded to 128 kbps MP3 for browser delivery; no other musical edits were made. Artist-page source credits:

- **Red — “Ol’ Man Clothes” by Jeris** (ccMixter account VJ_Memes), with contributors spinningmerkaba, Morusque, CSoul and Alex Beroza. [Track page](https://ccmixter.org/files/VJ_Memes/33403) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- **Blue — “Probably Shouldn’t” by Stefan Kartenberg**, featuring Mr_Yesterday on vocals; the English lyrics are by D. A. Ayer. [Full blues-rock remix page](https://ccmixter.org/files/JeffSpeed68/55527) · [original vocal/lyrics page](https://ccmixter.org/files/Mr_Yesterday/55515) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- **Green — “Freedom to Share” by gurdonark.** The embedded file is the upload’s “vox and instrument” version. [Track page](https://ccmixter.org/files/gurdonark/27900) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- **Yellow — “Slippin’ & Slidin’” by unreal_dm**, featuring SackJo22 on vocals. [Full country/blues remix page](https://ccmixter.org/files/unreal_dm/30468) · [original vocal/lyrics page](https://ccmixter.org/files/SackJo22/30330) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

The four primary track authors are Jeris, Stefan Kartenberg, gurdonark and unreal_dm. Their individual source pages provide English lyrics or link to the source vocal/lyrics pages named above. Four Color War does not claim ownership of these songs.
