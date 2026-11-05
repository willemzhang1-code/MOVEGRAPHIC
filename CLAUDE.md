# RABBIT（内部代号 sinew）— 给 Claude Code 的项目说明

2D 骨骼动画工具：单张角色图 / 分层 PSD → 自动抠图、骨架、网格、权重、动作；兼容 Spine 4.2 JSON 导入导出；同一 Rust 内核跑 Web / Godot / Unity。
线上：https://rabbit-studio.willemzhang1.workers.dev/ （落地页）· `/studio/` · `/demo/`。产品与路线：`docs/PRODUCT.md`、`docs/ROADMAP.md`、`docs/ARCHITECTURE.md`。

## 目录

| 路径 | 内容 |
|---|---|
| `crates/sinew-core` | 内核：骨骼/约束(IK·Transform·Path·Physics)/裁剪/序列/AnimationState/渲染缓冲/Spine JSON 导入 |
| `crates/sinew-ffi` | C ABI（WASM 与原生共用）；`sinew_instance_update(dt: f64)` |
| `crates/sinew-godot` + `godot/` | Godot 4.4+ GDExtension `RabbitSkeleton2D` 与示例工程 |
| `unity/com.rabbit.runtime` | Unity 2021.3+ UPM 包；`unity/tests` 是 .NET 测试与编译检查 |
| `web/runtime` | TS 运行时（读 wasm 内存）+ WebGL2 渲染 |
| `web/studio` | Studio（React）。自动绑骨在 `src/autorig/`：`templates.ts`(关节猜测/视角)、`rig.ts`(权重)、`props.ts`(手持道具拆件)、`hints.ts`(图层名)、`ai.ts`(视觉模型部位框)；动作库 `src/motions.ts`；导出 `src/doc.ts` |
| `web/parity` | 对照官方 spine-webgl 的页面：`index.html`(轮廓 IoU)、`physics.html`(逐骨骼对照、合成探针、原始数据导出) |
| `tools/` | 部署、示例下载、AI 测试集、Unity/Godot 构建、`parity/*.cjs` 自动化脚本、`worker.js`+`wrangler.toml` |

## 本地准备

```bash
rustup target add wasm32-unknown-unknown
cd web && npm ci && npx playwright install chromium
node ../tools/fetch-spine-examples.mjs      # Spine 官方示例，仅本地对照用，已 gitignore，不得提交
npm run dev                                  # 构建 wasm 并启动 vite（http://127.0.0.1:5173）
```

可选：Godot 4.4+（`tools/build-godot.sh` 后 `godot --headless --path godot/example -s test.gd`，期望 `RABBIT_TEST PASS`）；.NET 8（Unity C# 层测试）。

## 常用验证

| 目的 | 命令 |
|---|---|
| 内核单测 | `cargo test --release -p sinew-core` |
| 20 个示例导入/NaN 扫描 | `cargo run --release -p sinew-core --example compat -- web/public/examples/4.2` |
| Studio 类型检查 | `cd web && npx tsc --noEmit -p .` |
| 逐骨骼对照全部示例 | `node tools/parity/check.cjs "scan=1&frames=150&dt=0.0166683"`（当前 99/105 < 0.05） |
| 合成 IK/继承/路径用例 | `node tools/parity/check.cjs "raw=1"`（应全部 0.000，`inh-noScale-skflipy`、`ik-noscale` 为已知例外） |
| 物理探针 | `node tools/parity/probe.cjs out.json`（应全部 ≤ 0.001） |
| 轮廓 IoU | `node tools/parity/iou.cjs parity-out` |
| AI 测试集（20 张） | `node tools/fetch-ai-testset.mjs && BASE=http://127.0.0.1:5173 node tools/run-ai-testset.mjs`（AI 关节只在线上可用；本地加 `AI=0`）；CI 版见 `.github/workflows/ai-testset.yml`，结果拼图推到 `ai-testset-results` 分支 |
| Unity C# 层 | `dotnet build -c Release -o out unity/tests/CoreTests && cp target/release/libsinew_ffi.so out/ && (cd out && dotnet CoreTests.dll ../)` |

对照扫描用 `dt=0.0166683` 而不是 1/60：帧时间恰好落在关键帧上时 f32/f64 取整不同，会制造假差异。

## 部署

- 站点：`./tools/build-deploy.sh` 构建 `web/dist` 并推到 `deploy` 分支；Worker 从 GitHub raw 读取，HTML 边缘缓存 5 分钟。
- Worker 代码（`tools/worker.js`，含 `/api/keypoints` 走 Workers AI Llama 4 Scout）：`npx wrangler deploy -c tools/wrangler.toml`。
- Unity 包：推 main 时 `.github/workflows/unity.yml` 构建 Win/Mac/Linux/Android/iOS 原生库并打 UPM tgz（Actions artifact；发 GitHub Release 会自动附上）。改动包内文件后跑 `python3 tools/unity-metas.py` 生成 .meta。

## 约束（务必遵守）

- **Clean-room**：不得复制、移植或反编译 Spine 运行时/编辑器源码。行为对齐只用黑盒方式：在 `web/parity/src/physics.ts` 里加合成用例，逐帧对比官方输出，离线拟合（`probe.cjs ... ?rawdump=` 导数据）。`@esotericsoftware/spine-webgl` 只作为开发期对照的黑盒。
- Spine 示例资源（`web/public/examples/`）不提交、不分发。
- 直接在 `main` 上提交并推送（用户已确认）。
- 不要让用户把密钥贴进对话。

## 现状与待办（按优先级）

1. **AI 测试集第 3 轮复核**：最新一轮（视觉模型判朝向 + 道具拆件）结果在 `ai-testset-results` 分支，按 `docs/AI_TESTSET.md` 评分标准打分并记录。第 1 轮基线 7/20，目标 ≥ 14/20。
2. **M3 拆件 + 遮挡补全**（AI 绑骨的天花板）：重叠肢体（侧面近/远腿、四足）和大幅弯曲撕扯都要求把单图拆成部件。方向：浏览器端 MobileSAM/SlimSAM（onnxruntime-web）以关节点为提示分割四肢/头/躯干 → 每部件独立网格（复用分层 PSD 管线，`splitProps` 是现成的拆件样板）→ 被遮挡区域用 Workers AI 的 SD inpainting 补全；模型权重放 R2 由 Worker 提供。硬切权重已试过（左右肢互斥）会产生锯齿撕裂，已回退——必须真正拆网格。
3. 四足：狮鹫翅膀分组与扇动动作；侧面前后腿重叠（依赖第 2 项）。
4. Studio：网格编辑、曲线编辑器、状态机编辑、协作。
5. 内核：`.skel` 二进制导入；AnimationState 对未被 key 的属性保留上一帧值（Spine 语义，现在每帧回 setup）；可选 f64 动画时间。
6. 剩余对照差异：sack（多级物理 + 非均匀缩放下的累积漂移，合成用例 `cape-scale` 可复现 0.12）、celestial-circus wind-idle（f32 精度被高增益物理放大）。
7. Unity：需要在真实 Unity 编辑器里实测（云端没有 Unity）；Godot screen 混合为近似。

## 调试小抄

- Studio 暴露 `window.__rabbit = { doc, src }`，自动化脚本可直接读当前文档/源图。
- 关节猜测可在 node 里单测：用 esbuild 打包一个调用 `TEMPLATES.humanoid.guess(mask, w, h)` 的小脚本（mask 为 0/1 的 Uint8Array）。
- 物理模型、贝塞尔 10 段折线、IK softness/stretch、noScale、路径 4 弦长/10 弦恒速表等结论的推导过程见 git log（"fitted to the reference" 相关提交）。
