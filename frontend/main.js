// webterm 前端：xterm.js + WebSocket 桥接，含密码认证
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

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  ws = new WebSocket('ws://' + location.host + '/ws');
  ws.binaryType = 'arraybuffer';

  ws.onopen = function () {
    send({ type: 'resize', cols: term.cols, rows: term.rows });
  };

  ws.onmessage = function (ev) {
    if (ev.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(ev.data));
    } else {
      var msg = JSON.parse(ev.data);
      if (msg.type === 'auth_ok') {
        authenticated = true;
      }
    }
  };

  ws.onclose = function () {
    if (authenticated) {
      term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n');
    }
  };

  term.onData(function (d) {
    send({ type: 'input', data: d });
  });
})();
