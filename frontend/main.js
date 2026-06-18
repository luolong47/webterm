// webterm 前端：xterm.js + WebSocket 桥接，含密码认证
// 上行(JSON): {type:"input",data} / {type:"resize",cols,rows} / {type:"auth",password}
// 下行(JSON): {type:"auth_prompt"} / {type:"auth_ok"} / {type:"auth_fail",message}
//             (二进制): PTY 原始字节，直接 term.write
(function () {
  var term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
    fontSize: 14,
    scrollback: 5000,
    allowProposedApi: true,
  });
  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal'));
  fitAddon.fit();

  var ws = null;
  var authenticated = false;

  // 密码输入覆盖层
  var overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;justify-content:center;align-items:center;';
  var box = document.createElement('div');
  box.style.cssText = 'background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:32px;width:340px;font-family:monospace;';
  box.innerHTML = '<div style="color:#0af;font-size:16px;margin-bottom:16px;font-weight:bold;">webterm 需要密码认证</div>' +
    '<div style="color:#aaa;font-size:13px;margin-bottom:12px;">请输入访问密码</div>' +
    '<input id="auth-pass" type="password" style="width:100%;padding:8px;font-size:16px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;box-sizing:border-box;" autofocus>' +
    '<div id="auth-msg" style="margin-top:8px;font-size:13px;"></div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  var passInput = document.getElementById('auth-pass');
  var authMsg = document.getElementById('auth-msg');

  function showAuth() {
    overlay.style.display = 'flex';
    passInput.value = '';
    authMsg.textContent = '';
    authMsg.style.color = '#f44';
    passInput.focus();
  }

  function hideAuth() {
    overlay.style.display = 'none';
  }

  passInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      sendAuth(passInput.value);
    }
  });

  function sendAuth(password) {
    send({ type: 'auth', password: password });
  }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.binaryType = 'arraybuffer';

    ws.onopen = function () {
      // 连接建立后等待服务端发送 auth_prompt
    };

    ws.onmessage = function (ev) {
      if (ev.data instanceof ArrayBuffer) {
        // 二进制数据：PTY 输出
        term.write(new Uint8Array(ev.data));
      } else {
        // JSON 控制消息
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }

        switch (msg.type) {
          case 'auth_prompt':
            authenticated = false;
            showAuth();
            break;

          case 'auth_ok':
            authenticated = true;
            hideAuth();
            // 发送初始 resize
            send({ type: 'resize', cols: term.cols, rows: term.rows });
            break;

          case 'auth_fail':
            authenticated = false;
            authMsg.textContent = msg.message || '认证失败，请重试';
            authMsg.style.color = '#f44';
            passInput.value = '';
            passInput.focus();
            break;
        }
      }
    };

    ws.onclose = function () {
      if (authenticated) {
        term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n');
      }
    };
    ws.onerror = function () { /* 由 onclose 兜底 */ };
  }

  function send(m) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(m));
    }
  }

  // 认证后的正常输入
  term.onData(function (d) {
    if (authenticated) {
      send({ type: 'input', data: d });
    }
  });

  term.onResize(function () {
    if (authenticated) {
      send({ type: 'resize', cols: term.cols, rows: term.rows });
    }
  });

  window.addEventListener('resize', function () { try { fitAddon.fit(); } catch (e) {} });

  connect();
})();
