import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'antigravity_secret_token_123';
const MY_PHONE_NUMBER = process.env.MY_PHONE_NUMBER || '';

// Conversation memory per phone number for true back-and-forth context
const chatHistories = new Map();

const SYSTEM_PROMPT = {
  role: 'system',
  content: `You are Antigravity, a highly capable and friendly personal AI assistant talking with your user over WhatsApp.
Guidelines:
- Maintain natural, continuous conversational context.
- Keep answers concise, direct, and well-structured for easy reading on mobile screens.
- Use WhatsApp-friendly formatting (*bold*, _italic_, bullet points with emoji) where helpful.
- Help with questions, tasks, coding, brainstorms, planning, and regular conversation.`
};

// Send message via Meta WhatsApp Cloud API
export async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn('[WhatsApp] Warning: WHATSAPP_TOKEN or PHONE_NUMBER_ID is missing');
    return { success: false, error: 'Credentials missing' };
  }

  const cleanTo = String(to).replace(/\D/g, '');
  const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'text',
        text: { preview_url: false, body: text }
      })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[WhatsApp API Error]', JSON.stringify(data, null, 2));
      return { success: false, error: data };
    }
    return { success: true, data };
  } catch (err) {
    console.error('[WhatsApp Network Error]', err);
    return { success: false, error: err.message };
  }
}

// Generate back-and-forth conversation response via Groq
async function getGroqResponse(from, userMessage) {
  if (!chatHistories.has(from)) {
    chatHistories.set(from, [{ ...SYSTEM_PROMPT }]);
  }

  const history = chatHistories.get(from);
  history.push({ role: 'user', content: userMessage });

  // Keep the system prompt + last 14 back-and-forth messages for context
  if (history.length > 16) {
    const systemPrompt = history[0];
    const recent = history.slice(-14);
    chatHistories.set(from, [systemPrompt, ...recent]);
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: chatHistories.get(from),
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[Groq API Error]', data);
      return 'Sorry, I ran into an issue connecting to the AI model. Please check the logs.';
    }

    const reply = data.choices?.[0]?.message?.content || 'No response generated.';
    history.push({ role: 'assistant', content: reply });
    return reply;
  } catch (err) {
    console.error('[Groq Network Error]', err);
    return 'Network error connecting to Groq.';
  }
}

// 1. Meta Webhook Verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Webhook Verified] Meta webhook subscription confirmed!');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook Auth Failed] Provided token does not match VERIFY_TOKEN');
  return res.sendStatus(403);
});

// 2. Meta Incoming Message Event (POST)
app.post('/webhook', async (req, res) => {
  // Return 200 OK immediately as required by Meta Cloud API
  res.sendStatus(200);

  const body = req.body;
  if (body?.object === 'whatsapp_business_account') {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (value?.messages?.length) {
          const msg = value.messages[0];
          const from = msg.from; // Sender's phone number

          if (msg.type === 'text') {
            const incomingText = msg.text.body;
            console.log(`\n[Incoming WhatsApp] ${from}: "${incomingText}"`);

            // Generate AI response
            const aiReply = await getGroqResponse(from, incomingText);
            console.log(`[Replying] To ${from}: "${aiReply}"\n`);

            // Send back to the user
            await sendWhatsAppMessage(from, aiReply);
          } else {
            console.log(`[Incoming WhatsApp] Non-text message from ${from}: ${msg.type}`);
            await sendWhatsAppMessage(from, 'I currently support text messages. How can I help you?');
          }
        }
      }
    }
  }
});

// 3. Proactive Updates / Notification Endpoint (POST /notify)
app.post('/notify', async (req, res) => {
  const { message, to } = req.body;
  const target = to || MY_PHONE_NUMBER;

  if (!message) {
    return res.status(400).json({ error: 'message field is required' });
  }
  if (!target) {
    return res.status(400).json({ error: 'target phone number is required (set MY_PHONE_NUMBER in .env)' });
  }

  console.log(`[Sending Notification] To ${target}: "${message}"`);
  const result = await sendWhatsAppMessage(target, message);
  if (result.success) {
    res.json({ success: true, result });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

// Health check / diagnostic endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Antigravity WhatsApp Assistant',
    model: GROQ_MODEL,
    has_phone_number_id: Boolean(PHONE_NUMBER_ID),
    has_whatsapp_token: Boolean(WHATSAPP_TOKEN),
    target_user: MY_PHONE_NUMBER
  });
});

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`Antigravity WhatsApp Assistant running on port ${PORT}`);
  console.log(`Webhook endpoint: /webhook`);
  console.log(`Verify Token: ${VERIFY_TOKEN}`);
  console.log(`Target Phone: +${MY_PHONE_NUMBER}`);
  console.log(`Groq Model: ${GROQ_MODEL} (Free)`);
  console.log(`===============================================`);
});
