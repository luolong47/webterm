// webterm 前端：xterm.js + WebSocket 桥接
// 上行(JSON): {type:"input",data} / {type:"resize",cols,rows}
// 下行(二进制): PTY 原始字节，直接 term.write
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
  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.binaryType = 'arraybuffer';

    ws.onopen = function () {
      send({ type: 'resize', cols: term.cols, rows: term.rows });
    };
    ws.onmessage = function (ev) {
      if (ev.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(ev.data));
      } else {
        term.write(ev.data);
      }
    };
    ws.onclose = function () {
      term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n');
    };
    ws.onerror = function () { /* 由 onclose 兜底 */ };
  }

  function send(m) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(m));
    }
  }

  term.onData(function (d) { send({ type: 'input', data: d }); });
  term.onResize(function () { send({ type: 'resize', cols: term.cols, rows: term.rows }); });
  window.addEventListener('resize', function () { try { fitAddon.fit(); } catch (e) {} });

  connect();
})();
