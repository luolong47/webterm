// webterm —— 极简网页终端服务
// 浏览器加载 / → 内嵌的 xterm.js 前端 → 连 /ws → 后端起一个 PTY(shell) → 双向泵字节
mod frontend;
mod pty;
mod session;

use clap::Parser;
use tracing::info;

/// 贯穿路由、下传到 session 的共享状态
#[derive(Clone)]
pub struct AppState {
    /// 覆盖默认 shell（默认用 $SHELL）
    pub cmd: Option<String>,
    /// 终端访问密码（None 表示无需密码，保持向后兼容）
    pub password: Option<String>,
}

#[derive(Parser)]
#[command(name = "webterm", version, about = "极简网页终端服务（纯 Rust）")]
struct Args {
    /// 监听地址
    #[arg(long, default_value = "127.0.0.1:7681")]
    bind: String,

    /// 要启动的 shell（默认取 $SHELL）
    #[arg(long)]
    cmd: Option<String>,

    /// 终端访问密码（留空表示无需密码）
    #[arg(long)]
    password: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    let state = AppState {
        cmd: args.cmd.clone(),
        password: args.password.clone(),
    };

    let app = axum::Router::new()
        .route("/", axum::routing::get(frontend::index))
        .route("/ws", axum::routing::get(session::handler))
        .route("/*path", axum::routing::get(frontend::static_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&args.bind).await?;
    info!("webterm 监听于 http://{}", args.bind);
    axum::serve(listener, app).await?;
    Ok(())
}
