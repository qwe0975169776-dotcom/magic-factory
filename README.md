# 失控魔法工廠 🏭

5–10 人手機連線派對遊戲。每個人畫面上有 4 個魔法機關，但你的指令永遠在**別人**的機關上——只能大聲喊出來！

## 資料夾結構

```
magic-factory/
├─ server.js            後端（房間、分發機關、指令、驗證、計時）
├─ package.json
├─ data/devices.json    50 組機關題庫（可自己增減）
└─ public/
   ├─ index.html        手機介面
   ├─ css/style.css     羊皮紙、木紋、機關動畫
   ├─ js/client.js      連線與畫面邏輯、音效、震動
   └─ assets/           （放你用 AI 生成的底圖）
```

## 在自己的 Windows 電腦上跑（全班連同一個 Wi-Fi）

1. 到 https://nodejs.org 下載「LTS」版本，一路按「下一步」安裝。
2. 把 `magic-factory` 資料夾解壓縮到桌面。
3. 打開 `magic-factory` 資料夾，在上方網址列輸入 `cmd` 按 Enter，會跳出黑色視窗。
4. 輸入 `npm install` 按 Enter（第一次才需要，等它跑完）。
5. 輸入 `npm start` 按 Enter，看到「🏭 失控魔法工廠已開工」就成功了。如果 Windows 防火牆跳出詢問，按「允許存取」。
6. 在同一個黑色視窗再開一個新的 cmd，輸入 `ipconfig`，找到「IPv4 位址」（例如 `192.168.1.23`）。
7. 玩家手機打開瀏覽器，輸入 `http://192.168.1.23:3000`（換成你的 IP）。

> **只有幾支手機想先試玩？** 第 5 步改輸入 `set MIN_PLAYERS=2 && npm start`，2 人就能開局。

## 放到網路上（不用同一個 Wi-Fi）

GitHub Pages 只能放純網頁，**跑不了這個遊戲的伺服器**。可以改用 Render（有免費方案）：

1. 把整個資料夾上傳成一個 GitHub repository。
2. 到 https://render.com 用 GitHub 登入 → New → Web Service → 選這個 repo。
3. Build Command 填 `npm install`，Start Command 填 `npm start`，按建立。
4. 完成後會得到一個網址，玩家直接開就能玩。免費方案閒置後會休眠，第一次打開要等約一分鐘。

## 後台（主持人專用）

網址：`你的遊戲網址/admin`，或在遊戲首頁**長按標題「失控魔法工廠」3 秒**。預設密碼 `12345678`（可在 Render 的環境變數 `ADMIN_PASSWORD` 改掉）。

- **遊戲參數**：一局時間、開局與結尾的指令秒數（越玩越快）、最低人數、扣分與回復
- **題庫管理**：新增、修改、刪除、停用機關，可匯出／匯入 JSON
- **成績紀錄**：每局結果，可下載成 Excel 能開的 CSV

後台的修改只存在伺服器記憶體，伺服器休眠或更新後會恢復預設。

## 調整難度

打開 `server.js`，最上面的 `CONFIG` 區塊：

| 設定 | 預設 | 意思 |
|---|---|---|
| `INSTRUCTION_MS` | 15000 | 每條指令幾毫秒（15 秒） |
| `WRONG_PENALTY` | 5 | 亂按扣多少穩定度 |
| `WRONG_COOLDOWN_MS` | 1000 | 同一人狂按時，1 秒內只扣一次 |
| `TIMEOUT_PENALTY` | 8 | 指令逾時扣多少 |
| `SUCCESS_BONUS` | 2 | 完成一條指令回復多少 |

## 換成 AI 生成的底圖

把圖存到 `public/assets/`，再打開 `public/css/style.css` 最上面兩行，改成：

```css
--factory-art: url('../assets/factory-bg.png');
--panel-art: url('../assets/panel.png');
```

## 新增機關

在 `data/devices.json` 照格式加一筆即可，`id` 不能重複：

- `type`：`button`（按鈕）／`switch`（開關）／`slider`（滑桿）
- `target`：按鈕寫 `press`；開關寫 `on` 或 `off`；滑桿寫 `max`（頂）、`mid`（中）、`min`（底）
- 沒寫 `target` 也行，伺服器會從 `action` 文字判斷（「開啟／關閉」「推到頂端／中間／拉到底部」）

題庫至少要 40 個機關才能支援 10 人同時玩。
