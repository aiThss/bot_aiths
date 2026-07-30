# Thông báo deployment Dokploy qua bot Telegram

Bot nhận Custom Notification từ Dokploy tại endpoint:

```text
POST /webhook/dokploy
```

Webhook chỉ gửi thông báo Telegram cho deployment có `status: success` và `type: build`. Payload kiểm tra kết nối của Dokploy cũng được hỗ trợ.

## 1. Cấu hình ENV cho ứng dụng bot

Trong Dokploy, mở ứng dụng `bot_aiths` và thêm:

```env
DOKPLOY_WEBHOOK_SECRET=mot-chuoi-bi-mat-dai-va-ngau-nhien
```

Bot tiếp tục dùng các biến hiện có:

```env
BOT_TOKEN=...
ADMIN_CHAT_ID=...
ADMIN_CHAT_IDS=123456789,987654321
```

`ADMIN_CHAT_IDS` có thể chứa nhiều Telegram Chat ID, ngăn cách bằng dấu phẩy. Không commit secret vào repository.

Sau khi lưu ENV, redeploy ứng dụng bot để endpoint được kích hoạt.

## 2. Tạo Custom Notification trong Dokploy

Vào **Settings → Notifications → Add Notification → Custom** và nhập:

- **Name:** `Bot Telegram - Deploy Success`
- **Endpoint:** `https://<domain-cua-bot>/webhook/dokploy`
- **Header key:** `X-Dokploy-Secret`
- **Header value:** cùng giá trị với `DOKPLOY_WEBHOOK_SECRET`
- Bật **Application Deploy**
- Tắt các loại sự kiện không cần thiết

Nhấn **Test Connection**. Bot sẽ gửi tin nhắn:

```text
🧪 Kết nối Dokploy thành công
```

Sau đó lưu notification.

## 3. Nội dung thông báo

Khi deployment thành công, bot gửi:

- Project
- Application
- Environment nếu Dokploy có gửi trường này
- Application type
- Domain
- Thời gian hoàn tất theo múi giờ Việt Nam
- Nút mở deployment logs
- Nút mở tối đa bốn domain

Thông báo được gửi tới toàn bộ Chat ID trong `ADMIN_CHAT_IDS`. Nếu một người nhận lỗi, bot vẫn tiếp tục gửi cho các người nhận còn lại.

## 4. Kiểm tra thủ công

```bash
curl -X POST 'https://<domain-cua-bot>/webhook/dokploy' \
  -H 'Content-Type: application/json' \
  -H 'X-Dokploy-Secret: <DOKPLOY_WEBHOOK_SECRET>' \
  -d '{
    "title": "Build Success",
    "message": "Build completed successfully",
    "projectName": "Babyress",
    "applicationName": "bot_aiths",
    "applicationType": "application",
    "buildLink": "https://dokploy.example/deployments/example",
    "timestamp": "2026-07-15T07:00:00.000Z",
    "domains": "bot.example.com",
    "status": "success",
    "type": "build"
  }'
```

Kết quả thành công:

```json
{
  "success": true,
  "sent": 1,
  "failed": 0
}
```

Request sai secret trả về HTTP `401`. Nếu chưa cấu hình `DOKPLOY_WEBHOOK_SECRET`, endpoint trả về HTTP `503`.
