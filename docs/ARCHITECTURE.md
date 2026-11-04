# 架构

## 仓库结构

```
sinew/
  crates/
    sinew-core/     Rust 内核：数据模型、求值、约束、动画、混合、渲染输出、导入
    sinew-ffi/      C ABI（WASM 与所有原生引擎共用同一套导出）
  web/
    runtime/        TS 运行时：WASM 加载、WebGL2 渲染器
    demo/           M0 演示 / 播放器
  tools/            资源生成、对照测试脚本
  docs/
```

## 内核求值管线（每帧）

```
reset pose → setup
  → AnimationState / StateMachine 应用通道（Replace / Add，带 alpha 与 hold 逻辑）
  → 运行时注入（外部输入）
  → update cache 顺序执行：Bone 世界变换 ⇄ 约束（IK / Transform / Path / Physics）
  → 网格变形（权重 + deform）
  → 渲染批次输出（顶点、索引、page、blend）
```

- **每帧重置到 setup pose**：混合结果确定、可复现；宿主对 slot 的手动覆盖放在 apply 之后。
- **update cache**：约束按 order 排序；约束执行前确保其读取的骨骼已计算；被约束骨骼的子孙在约束后重算。
- **Bone 三层 pose**：`pose`（动画输出）→ `applied`（约束修改后）→ `world`（世界矩阵）。
- **继承模式**：统一表达为"父基底 B"：`world.linear = B · local.linear`，`world.pos = parent.apply(local.pos)`。

## 跨平台接口

- `sinew-ffi` 导出纯 C ABI：句柄 + 指针/长度，无回调、无字符串所有权转移。
- WASM 直接用这套导出（无 wasm-bindgen）；JS 通过 `Float32Array` / `Uint32Array` 视图零拷贝读取顶点缓冲。
- 原生：同一 crate 编译 `cdylib` / `staticlib`，供 Godot GDExtension、Unity P/Invoke、Unreal 链接。
- 顶点格式：6 个 32-bit word / 顶点：`x, y, u, v (f32)`, `light rgba8`, `dark rgba8`。索引 u32。

## 渲染约定

- 着色器输出 PMA；straight-alpha 纹理在着色器内转换。
- 双色 tint：`rgb = tex.rgb * light.rgb + (tex.a - tex.rgb) * dark.rgb`，再乘 `light.a`。
- 混合（PMA）：normal `ONE, 1-SRC_ALPHA`；additive `ONE, ONE`；multiply `DST_COLOR, 1-SRC_ALPHA`；screen `ONE, 1-SRC_COLOR`。

## 数据格式

| 格式 | 用途 | 状态 |
|---|---|---|
| Spine 4.x JSON 导入 | 兼容 | M0 |
| Spine/libGDX atlas 文本格式 | 纹理图集 | M0 |
| `.snw` 二进制运行时格式 | 发布 | M1 |
| `.snw.json` 运行时格式 | 调试 / 版本管理 | M1 |
| `.sinew` 工程文档（CRDT 快照） | 编辑器 | M2 |
| Spine JSON 导出（子集） | 可回退 | M2 |

## 编辑器

- TypeScript + WebGL2（后续 WebGPU），内核通过 WASM 提供预览与求值。
- 文档层与运行时层分离：编辑操作作用于 CRDT 文档，增量编译为运行时数据推入内核。
- CRDT 选型（Yjs / Automerge / 自研）在 M2 决策；Undo 基于文档操作。
- 桌面版：Tauri 包装同一前端，本地文件系统 + 原生内核。

## AI 服务

- 独立服务（Python 推理 + TS 编排），输出为文档操作（新增骨骼、网格、关键帧），不直接写运行时数据。
- 管线：分割 → 遮挡补全 → 关节点估计 → 骨骼拟合 → 自动网格 → 权重（热扩散 / BBW）→ 动作库重定向。
- 文本 → 动作：LLM（Claude API）做动作规划，输出动作原语序列，由确定性求解器生成关键帧。

## Spine 兼容的 clean-room 规则

- 依据：官方公开的 JSON / binary 格式文档、用户手册中描述的行为语义。
- 不复制、不移植 Spine Runtimes 源码；不反编译 Spine 编辑器。
- 数值一致性用对照测试衡量：用户本机用自有 Spine 授权与官方 runtime 渲染同一资源，与 Spin 输出做像素比对。
- 公式在边界情况（非均匀缩放下的 IK、非 normal 继承模式）为独立推导，以对照测试结果迭代。
