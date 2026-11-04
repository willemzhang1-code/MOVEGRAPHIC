# AI 图→角色 测试集（20 张）

用途：M3 前验证"单张角色图 → 拆件 + 遮挡补全 + 骨骼 + 网格 + 权重"的可行性。
画风和难度刻意拉开：前 8 张是常规输入，9–20 张是困难样本（非人形、遮挡、特殊画风）。

## 统一规格

- 单个角色，**全身完整入画**，四周留白
- **纯色浅灰背景**（便于分割），无地面阴影、无文字、无边框
- 竖图 2:3，≥1024px 长边
- 除特别说明外：侧面或 3/4 侧面朝右（横版游戏默认朝向），四肢与躯干略分开

每条提示词末尾统一追加：

```
Full-body 2D game character, entire body visible with margin, isolated on a plain flat light-gray background, no ground shadow, no text, no frame, 2:3 portrait.
```

## 提示词

| # | 难度点 | 提示词 |
|---|---|---|
| 01 | 基线·日系 | Anime-style young swordswoman, cel shading, clean lineart, short jacket and boots, 3/4 view facing right, relaxed A-pose with arms slightly away from body, sword sheathed at hip. |
| 02 | 基线·Q 版 | Chibi mage with oversized head (1:2.5 proportion), flat colors, thick soft outlines, pointed hat and short robe, standing side view facing right, holding a small staff at her side. |
| 03 | 基线·美漫 | Western cartoon knight, bold black outlines, flat saturated colors, rounded shapes, side view facing right, neutral standing pose, arms slightly out. |
| 04 | 基线·半写实 | Semi-realistic female soldier, painted digital illustration, tactical vest, cargo pants, 3/4 view facing right, standing neutral pose, arms relaxed and visible. |
| 05 | 基线·厚涂 | Painterly fantasy orc warrior, thick brush strokes, muted earthy palette, side view facing right, neutral stance, arms slightly away from torso, axe hanging from belt. |
| 06 | 基线·扁平矢量 | Minimal flat-vector robot character, geometric shapes, 4-color palette, no gradients, side view facing right, standing with arms apart. |
| 07 | 基线·国风 | Chinese wuxia martial artist, ink-wash and gongbi hybrid style, long flowing sleeves and ponytail, 3/4 view facing right, calm standing pose, hands visible. |
| 08 | 基线·兽人 | Anthropomorphic cat adventurer with a long tail, storybook illustration, vest and satchel, side view facing right, standing upright, tail clearly separated from legs. |
| 09 | 像素风 | 32-bit pixel art ranger, crisp pixels, limited palette, no anti-aliasing, side view facing right, idle standing pose, large readable sprite. |
| 10 | 线稿 | Black-and-white lineart sketch of a street dancer, no fill colors, clean confident lines, 3/4 view facing right, neutral pose with arms apart. |
| 11 | 伪 3D | Stylized low-poly 3D rendered character, game-ready look, soft studio lighting, side view facing right, standing T-pose-like with arms lowered 45 degrees. |
| 12 | 四足 | Watercolor-style red fox, quadruped, side view facing right, standing on all four legs, tail extended behind, all legs visible and separated. |
| 13 | 无肢体 | Cute slime monster, glossy translucent jelly body with two eyes and a small crown, simple cartoon style, front 3/4 view. |
| 14 | 机甲 | Hard-surface mech pilot suit, many separate armor plates and pistons, concept-art rendering, side view facing right, neutral stance, arms away from body. |
| 15 | 翅膀 | Griffin creature with wings fully spread, fantasy illustration, side view facing right, standing on four legs, both wings visible. |
| 16 | 披风遮挡 | Wanderer wearing a long cape that covers most of the body down to the ankles, only head, hands and boots visible, side view facing right, painterly style. |
| 17 | 盾牌遮挡 | Guard holding a large round shield in front of the torso and a spear upright, cartoon style, 3/4 view facing right. |
| 18 | 自遮挡 | Teenage boy with arms crossed over the chest, anime style, 3/4 view facing right, standing, legs slightly apart. |
| 19 | 细长肢体 | Dark-fantasy skeleton warrior with thin bony limbs, rusty sword, gothic ink style with heavy black shadows, side view facing right. |
| 20 | 复杂服饰 | Gacha-game style idol character with elaborate layered costume, ribbons, floating ornaments and long twin-tails, cel shading, 3/4 view facing right, standing pose. |

## 评估标准（每张）

| 项 | 通过条件 |
|---|---|
| 拆件 | 头、躯干、上臂/前臂/手、大腿/小腿/脚（非人形按对应结构）分离，边缘无明显残缺 |
| 遮挡补全 | 被遮挡区域补出的内容在部件转动 ±30° 时不露破绽 |
| 骨骼 | 关节位置误差 < 部件长度 10% |
| 网格 + 权重 | idle / walk 模板动作套用后无明显撕裂、穿插 |
| 结论 | 动画师判断"可直接进入动画环节" → 计为通过；目标 ≥ 70%（14/20） |

生成结果放 `assets/ai-testset/`（PNG，按编号命名 `01.png` … `20.png`）。
