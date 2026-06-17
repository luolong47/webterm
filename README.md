# webterm —— 极简网页终端服务（纯 Rust）

一个跑在**目标机上**的轻量服务，用**浏览器**直接拿到那台机器的 Shell。
本质是"用 Rust 重写一个 ttyd"：浏览器加载内嵌的 xterm.js 前端 → 开 WebSocket →
后端 fork 一个伪终端（shell）→ 双向泵字节。

## 链路

```
浏览器 (xterm.js)  ──HTTP GET──▶  axum 返回 index.html（内嵌 xterm.js + ws 客户端）
                  ──WS upgrade─▶  spawn PTY($SHELL)
                  ◀──字节双向泵──▶ tokio 两个 task
                  ──resize JSON─▶ pty.resize()
```

- 上行（JSON）：`{"type":"input","data":"..."}` / `{"type":"resize","cols":80,"rows":24}`
- 下行（二进制）：PTY 原始字节，前端 `term.write(Uint8Array)`

## 安全模型

默认只监听 `127.0.0.1:7681`，**应用内不写认证**。要远程访问，走 SSH 隧道：

```bash
ssh -L 7681:127.0.0.1:7681 user@server   # 然后本地浏览器开 http://localhost:7681
```

由 SSH 兜底身份认证，最简单也最安全。

## 编译与运行

```bash
cargo build --release
./target/release/webterm                          # 监听 127.0.0.1:7681，起 $SHELL
./target/release/webterm --bind 0.0.0.0:7681      # 自定义绑定（请配合反代+TLS+认证）
./target/release/webterm --cmd /bin/bash          # 自定义 shell
```

## 目录结构

```
Cargo.toml            依赖：axum(ws) / tokio / portable-pty / rust-embed / clap / serde
src/main.rs           CLI 参数 + axum 路由
src/session.rs        核心：WebSocket ↔ PTY 双向桥接
src/pty.rs            打开 PTY、起 shell、暴露 master/reader/writer/child
src/frontend.rs       经 rust-embed 把前端内嵌进二进制
frontend/index.html   xterm.js 容器
frontend/main.js      xterm.js + WebSocket 客户端
frontend/vendor/      本地 vendor 的 xterm.js / xterm.css / xterm-addon-fit（不走 CDN）
scripts/smoke_test.sh 端到端验收脚本（agent-browser）
docs/screenshots/     验收截图
```

## 端到端验收

`scripts/smoke_test.sh` 用 agent-browser 驱动真实浏览器：打开 webterm 网页终端 →
`ssh luolong@127.0.0.1`（密码）→ 登录后 `echo done`。全程截图，并以
`/tmp/webterm_done_marker` 作为确定性校验。

验收截图见 [docs/screenshots/](docs/screenshots/)：
- `01-loaded.png` 网页终端加载、出现本地 shell
- `02-ssh-password-prompt.png` ssh 密码提示
- `03-ssh-logged-in.png` ssh 登录成功（Last login from 127.0.0.1）
- `04-echo-done.png` 执行 `echo done`，输出 `done`
- `05-back-to-local.png` exit 退回本地 shell

## 不做（YAGNI）

多 tab 管理 UI、内置 TLS（交给 nginx/caddy 反代）、会话录制、断线重连、多用户隔离。
每条都能独立叠加，不破坏核心。
