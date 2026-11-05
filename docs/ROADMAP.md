# 路线图

| 里程碑 | 内容 | 退出标准 |
|---|---|---|
| **M0 内核地基** ✅ | Rust 内核：骨骼/5 种继承/Slot/Skin/Region/Mesh/加权网格/IK/Transform/全部常用 timeline/AnimationState 混合；Spine 4.x JSON 导入；atlas 解析；C ABI；WASM；WebGL2 运行时；演示页 | 演示角色在浏览器正确播放 idle/walk/wave 及混合；单元测试通过 |
| **M1 内核完整**（大部分完成） | Path、Physics、Clipping、Sequence、事件音频、状态机内核、`.snw` 二进制格式、Spine skel 导入、对照测试框架 | Spine 官方示例资源对照测试达标 |
| **M2 Studio Alpha**（进行中） | Rig 模式（骨骼/网格/自动权重/约束）、Animate 模式（Dopesheet/曲线）、PSD 导入、导出、本地 CRDT 文档、Undo | 能从 PSD 手工做完一个可导出角色 |
| **M3 AI Alpha**（进行中） | 图→角色管线、人形骨架模板、动作库 + 重定向 | 20 张盲测图中 ≥70% 可直接进入动画环节 |
| **M4 引擎运行时** | Godot GDExtension、Unity 包、Web npm 包 | 三引擎示例工程自动化回归 |
| **M5 协作 + Hub** | 实时多人、版本分支、评论、分享页、资产市场 v1 | 外部团队日常使用 |
| **M6 扩展** | 视频→动作、文本→动作、Logic 模式完整版、Unreal、Tauri 桌面版 | — |

## 已知差异

- 旋转混合走最短路径，crossfade 期间不记忆方向（大角度差混合可能翻转）。
- `AnimationState.apply` 每帧从 setup pose 开始：未被任何动画 key 的属性回到 setup（Spine 会保留上一帧值）。宿主手动覆盖应放在 apply 之后。
- 时间用 f32：帧时间恰好落在 key 上时（如 6×1/60 vs key 0.1）可能与官方 JS 运行时（f64）差一帧。
- 未实现：`.skel` 二进制、Spine 3.x；Spine 4.3 格式变化未验证；order 不在 [0, n) 的畸形约束（官方会跳过）。

## 官方示例对照（Spine 4.2，20 个示例 / 105 个动画，官方 spine-webgl 为基准）

方法：黑盒系统辨识，不读官方源码。`web/parity/physics.html` 里约 200 个合成用例（物理阶跃/正弦、IK、继承模式、路径约束、曲线）逐帧对比官方输出拟合模型，再对全部示例做**逐骨骼世界矩阵**对照（比轮廓 IoU 严格，排除渲染差异）。

本地：`node tools/fetch-spine-examples.mjs` → `npm run dev` → `/parity/physics.html?scan=1&dt=0.0166683`（逐骨骼）或 `/parity/`（轮廓 IoU）。

| 逐骨骼最大误差（位置单位 / 矩阵×100） | 动画数 |
|---|---|
| < 0.05（与官方一致） | 99 / 105：alien、chibi-stickers、coin、dragon、goblins、hero、mix-and-match、owl、powerup、raptor、snowglobe、speedy、spineboy、stretchyman、vine、windmill 全部动画；cloud-pot、celestial-circus 大部分 |
| 0.1 – 5 | sack 4 个动画（多级物理 + 非均匀缩放下的累积漂移）、tank shoot 末帧 0.75 |
| 17 | celestial-circus wind-idle：首帧差 4e-5（f32 精度），被高增益风力物理放大 |

已拟合到与官方逐帧一致的行为：物理（弹簧/阻尼/惯性/limit/风/重力/referenceScale/reset 时间轴）、贝塞尔 10 段折线、两骨 IK（softness/stretch/子骨偏移/非均匀缩放）、noScale/noScaleOrReflection、路径约束（4 弦长曲线长度、10 弦恒速表、chain 尖端衔接、越界外推）。

## 当前状态（2026-11-05）

已上线：https://rabbit-studio.willemzhang1.workers.dev/studio/

| 模块 | 已完成 | 未完成 |
|---|---|---|
| 内核 | 骨骼/5 种继承、Slot/Skin、Region/Mesh/加权/Linked、IK、Transform、Path、Physics、Clipping、Sequence、多轨混合、事件、Spine 4.2 JSON 导入；官方 105 个示例动画中 99 个逐骨骼一致 | 状态机内核、`.snw` 二进制、Spine `.skel` 导入 |
| Studio | 单图抠图/网格/骨架/权重、分层 PSD（每层网格 + 按图层名推关节）、尾巴/头发/披风自动物理、AI 关节（Workers AI 部位框）、动作库（人形 8 / 四足 5 / 团子 3）、时间轴打关键帧 + 逐 key 缓动（linear/smooth/stepped）、手动加骨（可开物理）、权重笔刷（热力图、按图层限定）、撤销、导出 Spine 4.2 zip + GIF | 改网格、曲线编辑器、状态机编辑、协作 |
| AI | 部位框 → 关节 | 拆件 + 遮挡补全、视频/文本 → 动作 |
| 运行时 | Web（WASM + WebGL2）、Godot 4.4+（GDExtension：逐批次混合模式 + 双色 tint，Godot 4.7 自动测试通过）、Unity 2021.3+（UPM 包：C# 层 .NET 实测、Unity 2021.3 参考程序集编译检查；Win/Mac/Linux/Android/iOS 原生库由 CI 构建） | Unity 编辑器内实机验证、Unreal |
