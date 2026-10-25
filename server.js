import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

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

const INBOX_FILE = path.resolve('./antigravity_inbox.json');

// Helper to save instructions/tasks to inbox file
function logToInbox(from, text) {
  try {
    let inbox = [];
    if (fs.existsSync(INBOX_FILE)) {
      const content = fs.readFileSync(INBOX_FILE, 'utf-8');
      inbox = JSON.parse(content || '[]');
    }
    const newTask = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      from,
      task: text,
      status: 'pending'
    };
    inbox.push(newTask);
    fs.writeFileSync(INBOX_FILE, JSON.stringify(inbox, null, 2));
    console.log(`[Antigravity Inbox] Logged new task: "${text}"`);
    return newTask;
  } catch (err) {
    console.error('[Inbox Error] Failed to write inbox:', err.message);
    return null;
  }
}

// Conversation memory per phone number
const chatHistories = new Map();
// Active mode per phone number: 'normal' | 'antigravity'
const userModes = new Map();

const NORMAL_SYSTEM_PROMPT = {
  role: 'system',
  content: `You are a helpful, smart personal AI assistant connected to the user via WhatsApp.
Guidelines:
- Keep answers concise, clear, and friendly, suitable for quick reading on mobile chat.
- Use WhatsApp-friendly formatting (*bold*, _italic_, bullet points with emoji) where helpful.`
};

const ANTIGRAVITY_SYSTEM_PROMPT = {
  role: 'system',
  content: `You are Antigravity, the user's autonomous AI pair programming assistant working directly on their codebases and projects.
Mode: ANTIGRAVITY TALK ACTIVE
Guidelines:
- The user is messaging you directly from WhatsApp to assign coding tasks, review architecture, debug issues, or request project updates.
- Speak directly, technically, and concisely as their pair programmer.
- Every instruction the user gives here is recorded into your active workspace task queue.
- Clearly acknowledge their instructions, outline the immediate steps you will take, and confirm that the task is queued for execution.`
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
async function getGroqResponse(from, userMessage, isAntigravityMode) {
  const currentPrompt = isAntigravityMode ? ANTIGRAVITY_SYSTEM_PROMPT : NORMAL_SYSTEM_PROMPT;

  if (!chatHistories.has(from)) {
    chatHistories.set(from, [{ ...currentPrompt }]);
  } else {
    // Update system prompt based on mode
    const history = chatHistories.get(from);
    history[0] = { ...currentPrompt };
  }

  const history = chatHistories.get(from);
  history.push({ role: 'user', content: userMessage });

  // Keep last 14 messages
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
        temperature: 0.6,
        max_tokens: 1024
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[Groq API Error]', data);
      return 'Sorry, I ran into an issue connecting to the AI model. Please check the logs.';
    }

    const reply = data.choices?.[0]?.message?.content || 'Acknowledged.';
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

  return res.sendStatus(403);
});

// 2. Meta Incoming Message Event (POST)
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  if (body?.object === 'whatsapp_business_account') {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (value?.messages?.length) {
          const msg = value.messages[0];
          const from = msg.from;

          if (msg.type === 'text') {
            const rawText = msg.text.body.trim();
            console.log(`\n[Incoming WhatsApp] ${from}: "${rawText}"`);

            const isCurrentAntigravity = userModes.get(from) === 'antigravity';

            // Command: /antigravitytalk
            if (rawText.toLowerCase().startsWith('/antigravitytalk')) {
              userModes.set(from, 'antigravity');
              const extraInstruction = rawText.replace(/^\/antigravitytalk/i, '').trim();

              if (extraInstruction) {
                // User provided an instruction with the command
                logToInbox(from, extraInstruction);
                const aiReply = await getGroqResponse(from, extraInstruction, true);
                const responseMessage = `⚡ *Antigravity Mode Active*\n\n📝 *Task Logged:* "${extraInstruction}"\n\n${aiReply}\n\n_(Send /exit anytime to return to standard chat)_`;
                await sendWhatsAppMessage(from, responseMessage);
              } else {
                const welcomeMsg = `🚀 *Antigravity Talk Mode Activated!*\n\nYou are now talking directly to Antigravity as your AI pair programmer.\n\n• Every message you send here will be logged to your project task queue.\n• You can tell me to write code, fix bugs, run builds, or plan features.\n• Send */exit* to return to regular chat mode.`;
                await sendWhatsAppMessage(from, welcomeMsg);
              }
              continue;
            }

            // Command: /exit or /normal
            if (rawText.toLowerCase() === '/exit' || rawText.toLowerCase() === '/normal') {
              userModes.set(from, 'normal');
              const exitMsg = `🔙 *Exited Antigravity Mode.*\nYou are now back in standard assistant chat. Send */antigravitytalk* anytime to assign development tasks.`;
              await sendWhatsAppMessage(from, exitMsg);
              continue;
            }

            // If in Antigravity mode, log task and reply technically
            if (isCurrentAntigravity) {
              logToInbox(from, rawText);
              const aiReply = await getGroqResponse(from, rawText, true);
              const responseMsg = `🤖 *Antigravity:*\n\n${aiReply}\n\n✅ _Logged to task queue_`;
              await sendWhatsAppMessage(from, responseMsg);
            } else {
              // Standard assistant chat
              const aiReply = await getGroqResponse(from, rawText, false);
              await sendWhatsAppMessage(from, aiReply);
            }
          } else {
            await sendWhatsAppMessage(from, 'I currently support text messages.');
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

  if (!message) return res.status(400).json({ error: 'message is required' });
  if (!target) return res.status(400).json({ error: 'target number is required' });

  console.log(`[Sending Notification] To ${target}: "${message}"`);
  const result = await sendWhatsAppMessage(target, message);
  if (result.success) {
    res.json({ success: true, result });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

// 4. View Tasks / Inbox endpoint (GET /inbox)
app.get('/inbox', (req, res) => {
  try {
    if (fs.existsSync(INBOX_FILE)) {
      const tasks = JSON.parse(fs.readFileSync(INBOX_FILE, 'utf-8') || '[]');
      return res.json({ total: tasks.length, tasks });
    }
    res.json({ total: 0, tasks: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check endpoint
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
  console.log(`Target Phone: +${MY_PHONE_NUMBER}`);
  console.log(`Groq Model: ${GROQ_MODEL} (Free)`);
  console.log(`===============================================`);
});
