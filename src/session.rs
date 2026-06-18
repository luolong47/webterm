// session.rs —— WebSocket 与 PTY 之间的双向桥接（核心），含密码认证
use crate::pty;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use portable_pty::PtySize;
use serde::Deserialize;
use tracing::{info, warn};

/// 客户端上行消息（JSON）。
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientMsg {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
    Auth { password: String },
}

/// 服务端下行消息（JSON）。
#[derive(serde::Serialize)]
enum ServerMsg {
    #[serde(rename = "auth_prompt")]
    AuthPrompt,
    #[serde(rename = "auth_ok")]
    AuthOk,
    #[serde(rename = "auth_fail")]
    AuthFail { message: String },
}

pub async fn handler(
    ws: WebSocketUpgrade,
    State(state): State<crate::AppState>,
) -> impl IntoResponse {
    let cmd = state.cmd.clone();
    let password = state.password.clone();
    ws.on_upgrade(move |socket| run_session(socket, cmd, password))
}

async fn run_session(mut socket: WebSocket, cmd: Option<String>, password: Option<String>) {
    // 如果需要密码，先走认证流程
    if let Some(ref expected) = password {
        // 发送认证提示
        let prompt = serde_json::to_string(&ServerMsg::AuthPrompt).unwrap();
        if socket.send(Message::Text(prompt)).await.is_err() {
            return;
        }

        // 等待客户端回传密码
        let authenticated = loop {
            match socket.recv().await {
                Some(Ok(Message::Text(t))) => {
                    match serde_json::from_str::<ClientMsg>(&t) {
                        Ok(ClientMsg::Auth { password }) => {
                            if password == *expected {
                                break true;
                            } else {
                                let _ = socket
                                    .send(Message::Text(
                                        serde_json::to_string(&ServerMsg::AuthFail {
                                            message: "密码错误".into(),
                                        })
                                        .unwrap(),
                                    ))
                                    .await;
                                continue;
                            }
                        }
                        _ => {
                            let _ = socket
                                .send(Message::Text(
                                    serde_json::to_string(&ServerMsg::AuthFail {
                                        message: "请先输入密码".into(),
                                    })
                                    .unwrap(),
                                ))
                                .await;
                        }
                    }
                }
                Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                _ => return,
            }
        };

        if !authenticated {
            return;
        }

        // 认证通过，发送确认
        let _ = socket
            .send(Message::Text(
                serde_json::to_string(&ServerMsg::AuthOk).unwrap(),
            ))
            .await;
    }

    // ---- 以下为 PTY 会话主逻辑（与之前一致）----
    let pty::Pty {
        master,
        mut reader,
        writer,
        mut child,
    } = match pty::open(80, 24, cmd.as_deref()) {
        Ok(p) => p,
        Err(e) => {
            let _ = socket
                .send(Message::Text(format!("\r\npty open error: {e}\r\n")))
                .await;
            let _ = socket.close().await;
            return;
        }
    };

    // 输出通道：reader 线程（阻塞读）→ 这里 → socket
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    let reader_handle = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF：子进程退出
                Ok(n) => {
                    if out_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break; // 接收端已 drop（会话结束）
                    }
                }
                Err(_) => break,
            }
        }
    });

    // 写线程：从 in_rx（阻塞）取字节写入 PTY stdin
    let (in_tx, in_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let writer_handle = tokio::task::spawn_blocking(move || {
        let mut writer = writer;
        while let Ok(data) = in_rx.recv() {
            if writer.write_all(&data).is_err() || writer.flush().is_err() {
                break;
            }
        }
    });

    // 主循环：socket 与 pty 输出二选一
    loop {
        tokio::select! {
            msg = socket.recv() => match msg {
                Some(Ok(Message::Text(t))) => {
                    match serde_json::from_str::<ClientMsg>(&t) {
                        Ok(ClientMsg::Input { data }) => { let _ = in_tx.send(data.into_bytes()); }
                        Ok(ClientMsg::Resize { cols, rows }) => {
                            let _ = master.resize(PtySize { cols, rows, pixel_width: 0, pixel_height: 0 });
                        }
                        Ok(ClientMsg::Auth { .. }) => {} // 认证阶段已过，忽略
                        Err(e) => warn!("解析客户端消息失败: {e}"),
                    }
                }
                Some(Ok(Message::Binary(b))) => { let _ = in_tx.send(b.to_vec()); }
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => break,
                Some(Err(e)) => { warn!("websocket 接收错误: {e}"); break; }
            },
            out = out_rx.recv() => match out {
                Some(bytes) => {
                    if socket.send(Message::Binary(bytes)).await.is_err() { break; }
                }
                None => {
                    // reader EOF：进程已退出
                    let _ = socket
                        .send(Message::Text("\r\n\x1b[2m[process exited]\x1b[0m\r\n".into()))
                        .await;
                    let _ = socket.close().await;
                    break;
                }
            },
        }
    }

    // 清理：关输入通道→写线程退出；杀子进程；收尸；等两个线程
    drop(in_tx);
    let _ = child.kill();
    let _ = child.wait();
    let _ = reader_handle.await;
    let _ = writer_handle.await;
    info!("session 结束");
}
