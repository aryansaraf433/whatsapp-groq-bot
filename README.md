# WhatsApp Meta Cloud API + Groq AI Assistant

This service enables:
1. **Chatting back-and-forth on WhatsApp:** When you text your WhatsApp Business number, it responds with AI generated from Groq (using free model `openai/gpt-oss-120b` or `qwen/qwen3.8-27b`).
2. **Proactive WhatsApp Updates:** Antigravity or any script can run `node notify.js "Task finished!"` to message you on WhatsApp.

---

## 1. Setup Your Meta Credentials

Open `.env` in this directory and fill in:
- `PHONE_NUMBER_ID`: Found in [Meta Developer Portal](https://developers.facebook.com) > Your App > **WhatsApp** > **API Setup** under **Phone number ID**.
- `WHATSAPP_TOKEN`: Temporary or System User permanent Access Token.
- `MY_PHONE_NUMBER`: Your personal WhatsApp number with country code (e.g. `919876543210` for India, no `+` or spaces).

---

## 2. Start the Server

```bash
npm start
```
By default, the server runs on port 3000.

---

## 3. Configure the Meta Webhook

Meta requires a public HTTPS URL to send you incoming messages:

1. Expose port 3000 using Cloudflare Tunnel or ngrok:
   ```bash
   npx cloudflared tunnel --url http://localhost:3000
   # OR
   npx ngrok http 3000
   ```
2. Copy the generated HTTPS URL (e.g. `https://xyz.trycloudflare.com`).
3. In Meta Developer Portal:
   - Go to **WhatsApp** > **Configuration**.
   - Under **Webhook**, click **Edit**.
   - **Callback URL:** `https://xyz.trycloudflare.com/webhook`
   - **Verify Token:** `antigravity_secret_token_123` (or whatever is in your `.env`)
   - Click **Verify and save**.
   - Under **Webhook fields**, click **Manage** and subscribe to **`messages`**.

---

## 4. Sending Updates Anytime

From terminal or scripts:
```bash
node notify.js "Your task has completed!"
```
Or via HTTP:
```bash
curl -X POST http://localhost:3000/notify -H "Content-Type: application/json" -d "{\"message\": \"Build succeeded!\"}"
```
