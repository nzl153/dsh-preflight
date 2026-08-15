# dsh-preflight

> 安全边界：本工具只下载并解包候选产物，静态解析 JSON/YAML 和源码文本。它不安装插件、不执行候选代码或 install scripts，也不修改 DSH profile。网络候选只写入 `mkdtemp` 临时目录，用完即删。

`dsh-preflight` 在安装 DeepSeek Harness（DSH）插件前预演 entry、service、config、依赖和产物冲突。它只说明“已实现规则是否发现问题”，不提供安全性证明。

本项目不实现 daemon 和自动修复：所有输出都是只读结论，需要改动时由你自己执行给出的命令。

## 要求

- Windows 优先；Node.js 22.19 或更高版本
- 默认 DSH 安装根：`E:\dsh`（用 `--dsh-root` 或环境变量 `DSH_ROOT` 覆盖）
- 默认 profile：`%USERPROFILE%\.dsh\profiles\web`
- 设置 `DSH_HOME` 可覆盖 `.dsh` 根目录

## 使用

```bash
dsh-preflight check dsh-web-search-pro
```

```bash
dsh-preflight check github:owner/repo#main --profile web
```

```bash
dsh-preflight check "D:\work\my-plugin"
```

```bash
dsh-preflight audit
```

```bash
dsh-preflight diff dsh-web-search-pro --json
```

```bash
dsh-preflight explain
```

```bash
dsh-preflight explain --log "D:\logs\dsh.err.log" --json
```

`explain` 默认读取 DSH 安装根下的 `dsh.err.log`、`dsh.log`、`dsh.restart.log` 和 `launch-trace.log`。每个文件只读取尾部 2 MiB。日志不存在或为空时正常返回 INFO。

常用参数：

- `--profile <name>`：profile 名，默认 `web`
- `--profile-dir <path>`：直接指定 profile 目录
- `--dsh-root <path>`：覆盖 DSH 安装根
- `--dsh-home <path>`：覆盖 `.dsh` 根目录
- `--registry <url>`：覆盖 npm registry
- `--log <path>`：`explain` 只分析指定日志
- `--json`：输出机器可读 JSON
- `--strict`：存在 WARN 时也返回退出码 1

## 检查项

| Finding | 级别 | 含义 |
|---|---:|---|
| `ENTRY_ID_COLLISION` | BLOCK | 候选 entry id 已被现有 bundle 使用 |
| `UNRESOLVABLE_AFTER_INSTALL` | BLOCK / UNKNOWN | 安装后仍无法证明 `insert[].name` 可解析 |
| `CONFIG_OVERRIDE_SILENT` | WARN | profile 后置层会整段替换候选同 id 的 config |
| `SERVICE_PROVIDER_DUPLICATE` | WARN / UNKNOWN | 显式 service 重复，或 manifest 信息不足 |
| `MISSING_BUNDLE_MANIFEST` | BLOCK | 缺少可读取的 `dsh.bundle.patch` |
| `ENTRY_MISSING_IN_ARTIFACT` | BLOCK | `main`、`module`、`bin` 或递归 `exports` 目标不在产物中 |
| `BUILD_APPROVAL_REQUIRED` | INFO | Git 来源包含需要人工授权的构建脚本 |
| `VERSION_RANGE_MISMATCH` | WARN | `@deepseek-ai/*` peer range 与本机版本不匹配 |
| `UNPINNED_SOURCE` | WARN | GitHub ref 不是完整 commit SHA |
| `SENSITIVE_API_SURFACE` | INFO | 静态文本匹配到子进程、文件写入或外联 URL |
| `INSTALL_SCRIPT_PRESENT` | WARN | 安装时存在生命周期脚本 |
| `BUNDLES_DEPS_DRIFT` | BLOCK | profile 的 bundles、dependencies 与磁盘状态漂移 |
| `UNMET_PEER` | WARN | 当前 profile 的 peer 缺失或版本不匹配 |

## 运行时日志模式

| Finding | 级别 | 含义 |
|---|---:|---|
| `PORT_ALREADY_IN_USE` | BLOCK | 端口被旧进程占用，新实例未启动，插件错误是连锁表象 |
| `BUNDLE_UNRESOLVED_AT_BOOT` | BLOCK | 启动时无法解析 bundle；会与 profile 交叉判断卸载残骸 |
| `ENTRY_ID_COLLISION_AT_BOOT` | BLOCK | 启动日志显示 entry id 被重复注册或覆盖 |
| `MODULE_ENTRY_MISSING` | BLOCK | 已安装包的内部入口文件不在发布产物中 |
| `UNRECOGNIZED_ERROR` | UNKNOWN | 日志有错误，但确定性规则无法归类 |
| `NO_LOGS_TO_ANALYZE` | INFO | 默认日志或指定日志不存在、为空 |
| `NO_RECOGNIZED_RUNTIME_ERROR` | INFO | 日志有内容，但没有匹配到错误或已实现模式 |

## 退出码

- `0`：没有 BLOCK；默认允许 WARN
- `1`：存在 BLOCK，或 `--strict` 下存在 WARN
- `2`：参数、下载、解包或基础 profile 读取失败

## 验证状态

规则的可信度并不一致，这里如实标注。

**已在真实故障上验证**（隔离测试台复现 + 真实归档日志）：

- `ENTRY_ID_COLLISION`、`BUNDLES_DEPS_DRIFT`、`ENTRY_MISSING_IN_ARTIFACT`、`UNMET_PEER`
- `PORT_ALREADY_IN_USE`、`ENTRY_ID_COLLISION_AT_BOOT`、`BUNDLE_UNRESOLVED_AT_BOOT`、`MODULE_ENTRY_MISSING`

**只有单元测试覆盖，尚未在真实场景触发过**：

- `CONFIG_OVERRIDE_SILENT`、`SERVICE_PROVIDER_DUPLICATE`、`BUILD_APPROVAL_REQUIRED`、`VERSION_RANGE_MISMATCH`、`UNPINNED_SOURCE`、`SENSITIVE_API_SURFACE`、`INSTALL_SCRIPT_PRESENT`、`MISSING_BUNDLE_MANIFEST`、`UNRESOLVABLE_AFTER_INSTALL`

**已知局限**：

- `explain` 的日志模式按当前 DSH 版本的措辞编写。DSH 若改动日志文案，相关规则会**静默失效**——不会报错，只是不再命中。
- 本工具只说明「已实现的规则是否发现问题」，不构成安全性证明，也不能替代人工审阅插件源码。
- 输出为 CLEAR 只意味着这些规则没有命中，不意味着插件没有问题。

## 实现边界

- npm 来源读取 registry metadata 和 tarball，并校验可用的 `sha512` integrity。
- GitHub 来源使用 codeload archive；本地来源经过 `realpath` 后只读。
- tar 解包拒绝路径穿越和绝对路径，不创建 archive 中的 symlink 或 hardlink，并限制下载、解压、单文件和文件数量。
- YAML 的 `!!js` 只保留为字符串，绝不求值。
- service provider 只使用显式 manifest 声明；信息不足时报告 UNKNOWN。
- 源码扫描是有上限的正则匹配，只列事实，不判断恶意与否。
- 日志分析只读取文件尾部，不查询端口或进程。处方只作为命令文本输出，从不自动执行。

## 开发

```bash
pnpm install
```

```bash
pnpm check
```

```bash
node lib/cli.js --help
```

许可证：MIT。
