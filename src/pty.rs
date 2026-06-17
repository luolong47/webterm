// pty.rs —— 伪终端封装：打开 PTY、起 Shell、暴露读/写/master/child
use anyhow::Result;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};

/// 一条 PTY 会话持有的全部句柄。
/// 字段公开以便 session.rs 直接拆解、分别移入线程。
pub struct Pty {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// 打开一个 PTY 并在其中启动 shell。
/// `cmd` 优先；否则取 $SHELL；再否则回退 /bin/sh。
pub fn open(cols: u16, rows: u16, cmd: Option<&str>) -> Result<Pty> {
    let shell = cmd
        .map(str::to_string)
        .or_else(|| std::env::var("SHELL").ok())
        .unwrap_or_else(|| "/bin/sh".into());

    let system = native_pty_system();
    let pair = system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut builder = CommandBuilder::new(&shell);
    builder.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(builder)?;
    // 丢弃 slave 句柄：子进程退出后 reader 才能收到 EOF
    drop(pair.slave);

    let reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;

    Ok(Pty {
        master: pair.master,
        reader,
        writer,
        child,
    })
}
