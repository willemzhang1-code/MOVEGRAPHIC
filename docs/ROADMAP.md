# 路线图

| 里程碑 | 内容 | 退出标准 |
|---|---|---|
| **M0 内核地基** ✅ | Rust 内核：骨骼/5 种继承/Slot/Skin/Region/Mesh/加权网格/IK/Transform/全部常用 timeline/AnimationState 混合；Spine 4.x JSON 导入；atlas 解析；C ABI；WASM；WebGL2 运行时；演示页 | 演示角色在浏览器正确播放 idle/walk/wave 及混合；单元测试通过 |
| **M1 内核完整** | Path、Physics、Clipping、Sequence、事件音频、状态机内核、`.snw` 二进制格式、Spine skel 导入、对照测试框架 | Spine 官方示例资源对照测试达标 |
| **M2 Studio Alpha** | Rig 模式（骨骼/网格/自动权重/约束）、Animate 模式（Dopesheet/曲线）、PSD 导入、导出、本地 CRDT 文档、Undo | 能从 PSD 手工做完一个可导出角色 |
| **M3 AI Alpha** | 图→角色管线、人形骨架模板、动作库 + 重定向 | 20 张盲测图中 ≥70% 可直接进入动画环节 |
| **M4 引擎运行时** | Godot GDExtension、Unity 包、Web npm 包 | 三引擎示例工程自动化回归 |
| **M5 协作 + Hub** | 实时多人、版本分支、评论、分享页、资产市场 v1 | 外部团队日常使用 |
| **M6 扩展** | 视频→动作、文本→动作、Logic 模式完整版、Unreal、Tauri 桌面版 | — |

## M0 已知差异（对照测试前需验证）

- IK softness 采用独立推导的指数软限位，数值与 Spine 不同。
- `noScale` / `noRotationOrReflection` 继承模式为独立推导，非均匀缩放 / 斜切父骨骼下可能有偏差。
- 旋转混合走最短路径，crossfade 期间不记忆方向（大角度差混合可能翻转）。
- `AnimationState.apply` 每帧从 setup pose 开始：未被任何动画 key 的属性回到 setup（Spine 会保留上一帧值）。宿主手动覆盖应放在 apply 之后。
- 未实现：Path / Physics 约束、Clipping、Sequence、`.skel` 二进制、Spine 3.x；Spine 4.3 格式变化未验证。

## 官方示例兼容性（Spine 4.2，20 个）

`node tools/fetch-spine-examples.mjs` 下载到本地（不入库），`cargo run --release -p sinew-core --example compat` 扫描。

| 状态 | 示例 |
|---|---|
| 导入 + 全部动画无错误，静态/动态画面目测正确 | spineboy, raptor, goblins, stretchyman, owl, hero, powerup, speedy, windmill, alien, chibi-stickers, snowglobe（静态）, celestial-circus（静态） |
| 依赖未实现功能，画面有缺失或变形 | tank / vine / hero / stretchyman / mix-and-match（Path 约束）, coin / tank（Clipping）, celestial-circus / cloud-pot / sack / snowglobe（Physics）, dragon（Sequence） |

M1 实现顺序按影响面：Path → Clipping → Physics → Sequence。
