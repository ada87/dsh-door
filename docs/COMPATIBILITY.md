# dsh 兼容策略与测试记录

## 1. 兼容窗口（RC 阶段）

- 按 **minor 线** 兼容，忽略 `alpha` / `rc` 后缀：`0.2.2-rc.1`、`0.2.2-rc.3` 都属于 `0.2.2`。
- 基线：**0.2.2**。0.2.0 / 0.2.1 不再纳入支持窗口。
- 窗口：始终维护 **最近 3 个 minor 线**。
  - 现在：`0.2.2`
  - 0.2.3 发布：`0.2.2` + `0.2.3`
  - 0.2.4 发布：`0.2.2` + `0.2.3` + `0.2.4`
  - 0.2.5 发布：`0.2.3` + `0.2.4` + `0.2.5`
- 同一 minor 内至少测试：
  - npm `latest` 指向的版本（现在 `0.2.2-rc.1`）
  - 该 minor 的最新发布版本（现在 `0.2.2-rc.3`）
- dsh 发布正式版后，再切换成正式版的兼容策略；RC 阶段不按 patch 号卡接口。

## 2. 代码标注约定

版本相关代码必须带可搜索的 TSDoc 标签：

```ts
/**
 * @since 0.2.2
 * 新 Host 才有的字段/接口。
 */
cursor?: number
```

```ts
/**
 * @deprecated 0.2.2 — 0.2.1 fallback only; drop with the 0.2.1 floor.
 * 旧版本兼容分支。
 */
```

约定：

| 标签 | 含义 |
|---|---|
| `@since 0.2.2` | 该能力从 dsh 0.2.2 开始提供 |
| `@deprecated 0.2.2` | 只为更老 dsh 保留的兼容代码，0.2.2 基线后应删除 |
| `@deprecated 0.2.3` | 计划在 0.2.3 窗口移除的代码 |

搜索与管理：

```bash
rg "@since|@deprecated" apps/dsh-door/src apps/app-dsh-door/src
```

删除旧窗口时，按 `@deprecated` 列表逐项清理，并同步删除对应的 compat 测试。

## 3. 当前版本测试记录

记录文件：`compat/versions.json`。

当前包版本为 **0.1.5**（新增跨设备已读水位 `/read-state`）；0.1.4 已发布，0.1.5 待发布。页面里的版本号只作记录，功能以 `features` 探测为准，不看版本号。

静态对照页（类似 electron-release 的简版）：

```bash
npm run compat:site
# 输出 compat/site/index.html
```

页面列出 dsh 版本、minor 线、dsh-door 版本、App 版本、protocol、测试结果和时间。市场站启动后可直接复用这份 JSON。

状态含义：

- `pass`：自动化/真机冒烟全部通过
- `partial`：部分通过，或有版本只做了静态审查
- `pending`：尚未测试
- `fail`：存在已知不兼容

## 4. 0.2.1 兼容代码位置

以下代码是 0.2.1 专用兼容分支，已标记 `@deprecated 0.2.2`：

| 位置 | 作用 |
|---|---|
| `src/host.ts` `SessionEventsPage.cursor` | 0.2.1 没有分页 cursor |
| `src/host.ts` `SessionControllerService.state` | 0.2.1 没有 state() |
| `src/sessions.ts` transcript cursor fallback | 用 projection watermark 代替 cursor |
| `src/sessions.ts` state synthesis | 从 projections + list 合成 running/queue |
| `src/config.ts` `dshVersionRange` 默认值 | 仍写着 0.2.1 下限 |
| `tests/compat.test.ts` | 0.2.1 兼容测试套件 |
| `apps/app-dsh-door/src/api/tokenClient.ts` | token 模式的分页兼容注释/逻辑 |

过渡建议：

1. 先保留 0.2.1 兼容代码，但标记 `@deprecated 0.2.2`，并在 `/health` 里把 0.2.1 标为 `dshTested: false`。
2. 下一个 minor（0.2.3）发布时删除这些分支，把 `engines.dsh` / `dshVersionRange` 下限提到 `0.2.2-0`。
3. 如果确认 VPS 已升级到 0.2.2+，可以提前删除。
