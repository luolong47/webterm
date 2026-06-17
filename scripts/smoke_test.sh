#!/usr/bin/env bash
# webterm 端到端验收脚本：用 agent-browser 驱动浏览器，
# 经 webterm 网页终端 ssh 到本机(luolong@127.0.0.1 / 1222)，执行 echo done。
# 全程截图，并以 /tmp/webterm_done_marker 作为确定性校验。
set -u

ROOT=/prjs/tmp
SHOT="$ROOT/docs/screenshots"
AB="npx -y agent-browser"
mkdir -p "$SHOT"

echo "###### 0. 准备 ######"
rm -f /tmp/webterm_done_marker
# 预置 127.0.0.1 主机密钥到 luolong 的 known_hosts，避免 ssh 首连问 yes/no
mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
ssh-keyscan -H 127.0.0.1 2>/dev/null >> "$HOME/.ssh/known_hosts" || true
sort -u "$HOME/.ssh/known_hosts" -o "$HOME/.ssh/known_hosts"

pkill -f 'target/release/webterm' 2>/dev/null || true
sleep 0.3

echo "###### 1. 启动 webterm ######"
"$ROOT/target/release/webterm" --bind 127.0.0.1:7681 >/tmp/webterm.log 2>&1 &
WPID=$!
for i in $(seq 1 40); do
  curl -s -o /dev/null http://127.0.0.1:7681/ && break
  sleep 0.25
done
echo "webterm pid=$WPID  log=/tmp/webterm.log"
ss -tlnp 2>/dev/null | grep 7681 || echo "WARN: 端口未监听"

echo "###### 2. 打开浏览器 ######"
$AB close --all >/dev/null 2>&1 || true
$AB open http://127.0.0.1:7681/ 2>&1 | tail -2
$AB wait 1800
$AB screenshot "$SHOT/01-loaded.png" 2>&1 | tail -1
echo "--- 聚焦终端 ---"
$AB focus ".xterm-helper-textarea" 2>&1 | tail -1
$AB wait 300

echo "###### 3. ssh luolong@127.0.0.1 ######"
$AB keyboard type "ssh luolong@127.0.0.1" 2>&1 | tail -1
$AB press Enter 2>&1 | tail -1
$AB wait 3000
$AB screenshot "$SHOT/02-ssh-password-prompt.png" 2>&1 | tail -1

echo "###### 4. 输入密码 1222 ######"
$AB keyboard type "1222" 2>&1 | tail -1
$AB press Enter 2>&1 | tail -1
$AB wait 3000
$AB screenshot "$SHOT/03-ssh-logged-in.png" 2>&1 | tail -1

echo "###### 5. echo done（同时写标记文件）######"
$AB keyboard type "echo done | tee /tmp/webterm_done_marker" 2>&1 | tail -1
$AB press Enter 2>&1 | tail -1
$AB wait 1800
$AB screenshot "$SHOT/04-echo-done.png" 2>&1 | tail -1

echo "###### 6. 退出 ssh ######"
$AB keyboard type "exit" 2>&1 | tail -1
$AB press Enter 2>&1 | tail -1
$AB wait 1200
$AB screenshot "$SHOT/05-back-to-local.png" 2>&1 | tail -1

echo "###### 7. 关闭浏览器 ######"
$AB close --all 2>&1 | tail -1

echo "###### 8. 校验标记 ######"
kill "$WPID" 2>/dev/null || true
if [ -f /tmp/webterm_done_marker ]; then
  echo "MARKER 内容: $(cat /tmp/webterm_done_marker)"
  echo "RESULT: PASS (echo done 经 webterm+ssh 成功执行)"
else
  echo "RESULT: FAIL (未生成标记文件)"
fi
echo "###### 截图列表 ######"
ls -la "$SHOT"
