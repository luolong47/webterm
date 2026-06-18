// webterm 前端：xterm.js + WebSocket 桥接，含密码认证
// 认证方式：HTML 密码框 → 提交时通过 auth 消息发送密码
(function () {
  var term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
    fontSize: 14,
    scrollback: 5000,
    cols: 80,
    rows: 24,
  });
  term.open(document.getElementById('terminal'));

  var ws = null;
  var authenticated = false;
  var authActive = false;

  var overlay = document.getElementById('auth-overlay');
  var passInput = document.getElementById('auth-pass');
  var authMsg = document.getElementById('auth-msg');

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function submitAuth() {
    var pw = passInput.value;
    send({ type: 'auth', password: pw });
  }

  passInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAuth();
    }
  });

  ws = new WebSocket('ws://' + location.host + '/ws');
  ws.binaryType = 'arraybuffer';

  ws.onopen = function () {};

  ws.onmessage = function (ev) {
    if (ev.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(ev.data));
    } else {
      var msg = JSON.parse(ev.data);
      if (msg.type === 'auth_prompt') {
        authActive = true;
        overlay.style.display = 'flex';
        passInput.value = '';
        authMsg.textContent = '';
        authMsg.className = '';
        passInput.focus();
      } else if (msg.type === 'auth_ok') {
        authenticated = true;
        authActive = false;
        overlay.style.display = 'none';
        term.write('\r\n\x1b[1;32m  ✓ 认证成功\x1b[0m\r\n\r\n');
        send({ type: 'resize', cols: term.cols, rows: term.rows });
      } else if (msg.type === 'auth_fail') {
        authMsg.textContent = msg.message || '密码错误';
        authMsg.className = 'error';
        passInput.value = '';
        passInput.focus();
      }
    }
  };

  ws.onclose = function () {
    if (authenticated) {
      term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n');
    }
  };

  term.onData(function (d) {
    if (authenticated) {
      send({ type: 'input', data: d });
    }
  });
})();
