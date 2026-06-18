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
  });
  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal'));
  fitAddon.fit();

  var ws = null;
  var authenticated = false;
  var authBuffer = '';

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.binaryType = 'arraybuffer';

    ws.onopen = function () {
      // 连接建立后等待服务端发送 auth_prompt，不主动发 resize
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
            term.write('\r\n\x1b[1;36m   ┌─────────────────────────────┐\r\n');
            term.write('   │     webterm 需要密码认证    │\r\n');
            term.write('   └─────────────────────────────┘\x1b[0m\r\n');
            term.write('\x1b[1mPassword:\x1b[0m ');
            authBuffer = '';
            term.cursorStyle = 'bar';
            break;

          case 'auth_ok':
            authenticated = true;
            term.write('\r\n\x1b[1;32m  ✓ 认证成功\x1b[0m\r\n\r\n');
            term.cursorStyle = 'block';
            // 发送初始 resize
            send({ type: 'resize', cols: term.cols, rows: term.rows });
            break;

          case 'auth_fail':
            authenticated = false;
            term.write('\r\n\x1b[1;31m  ✗ ' + escapeHtml(msg.message || '认证失败') + '\x1b[0m\r\n');
            term.write('\x1b[1mPassword:\x1b[0m ');
            authBuffer = '';
            term.cursorStyle = 'bar';
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

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 认证阶段：拦截键盘输入，收集密码
  term.attachCustomKeyEvent(function (ev) {
    if (authenticated) return false; // 认证后走正常路径

    if (ev.type === 'keydown') {
      if (ev.key === 'Enter') {
        send({ type: 'auth', password: authBuffer });
        authBuffer = '';
        return true;
      } else if (ev.key === 'Backspace') {
        authBuffer = authBuffer.slice(0, -1);
        // 回显掩码字符
        term.write('\b \b');
        return true;
      } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        authBuffer += ev.key;
        term.write('*'); // 掩码显示
        return true;
      }
    }
    return false;
  });

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
