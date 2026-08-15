# dsh-preflight

> 安全边界：本工具只下载并解包候选产物，静态解析 JSON/YAML 和源码文本。它不安装插件、不执行候选代码或 install scripts，也不修改 DSH profile。网络候选只写入 `mkdtemp` 临时目录，用完即删。

`dsh-preflight` 在安装 DeepSeek Harness（DSH）插件前预演 entry、service、config、依赖和产物冲突。它只说明“已实现规则是否发现问题”，不提供安全性证明。

插件已经装坏、DSH 无法启动、需要快照或回滚时，请使用互补工具 [astra3294/dsh-doctor](https://github.com/astra3294/dsh-doctor)。本项目不实现恢复、boot probe、daemon 或自动修复。

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

常用参数：

- `--profile <name>`：profile 名，默认 `web`
- `--profile-dir <path>`：直接指定 profile 目录
- `--dsh-root <path>`：覆盖 DSH 安装根
- `--dsh-home <path>`：覆盖 `.dsh` 根目录
- `--registry <url>`：覆盖 npm registry
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

## 退出码

- `0`：没有 BLOCK；默认允许 WARN
- `1`：存在 BLOCK，或 `--strict` 下存在 WARN
- `2`：参数、下载、解包或基础 profile 读取失败

## 实现边界

- npm 来源读取 registry metadata 和 tarball，并校验可用的 `sha512` integrity。
- GitHub 来源使用 codeload archive；本地来源经过 `realpath` 后只读。
- tar 解包拒绝路径穿越和绝对路径，不创建 archive 中的 symlink 或 hardlink，并限制下载、解压、单文件和文件数量。
- YAML 的 `!!js` 只保留为字符串，绝不求值。
- service provider 只使用显式 manifest 声明；信息不足时报告 UNKNOWN。
- 源码扫描是有上限的正则匹配，只列事实，不判断恶意与否。

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
