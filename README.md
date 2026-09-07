# Travel Planner v13.5

## 檔案
- `index.html`：頁面結構
- `css/style.css`：自訂 CSS 與列印樣式
- `js/app.js`：行程、行前事項、預算、待辦、備份與 Google Drive 功能
- `config.js`：本機 Google API 設定（已由 `.gitignore` 排除）
- `.github/workflows/deploy.yml`：GitHub Pages 自動部署設定

## Google Cloud 必要設定
1. 啟用 **Google Drive API**。
2. 建立 **API Key** 與 OAuth 2.0 **Web application Client ID**。
3. OAuth consent screen 加入測試使用者（App 尚未正式發布時）。
4. Authorized JavaScript origins 加入實際網址，例如 `http://localhost:8000`。
5. 不要直接用 `file://` 開啟。可在資料夾執行：`python -m http.server 8000`。
6. 本機使用時，在 `config.js` 填入金鑰；GitHub Pages 部署時則由 GitHub Secrets 自動產生此檔案。

## GitHub Pages 部署
1. 在 GitHub repository 的 Secrets and variables → Actions 中設定：
   - `VITE_GOOGLE_API_KEY`
   - `VITE_GOOGLE_CLIENT_ID`
2. 將 Google OAuth 的 Authorized JavaScript origins 加入實際 GitHub Pages 網址。
3. 推送到 `main` 分支，workflow 會部署 `index.html`、`css/`、`js/`，並產生部署用的 `config.js`。

## 本次修正
- 移除 Google 初始化區的合併衝突與語法錯誤。
- 移除重複 token callback、重複登入請求與重複 UI 切換。
- 不再把 OAuth access token 當 JWT 解析（access token 通常是不透明字串）。
- 加入 SDK 載入等待、設定檢查、401/403 授權失效處理。
- 修正建立 Drive 檔案時重複 `resource` 的錯誤。
- 雲端檔案列表改用安全 DOM API 顯示檔名。
- HTML、CSS、JavaScript 拆檔，較容易維護。

## 注意
`drive.file` 權限只允許程式管理它建立或由使用者授權開啟的檔案，這是較安全的選擇。
