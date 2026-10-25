import dotenv from 'dotenv';
dotenv.config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const MY_PHONE_NUMBER = process.env.MY_PHONE_NUMBER;

const message = process.argv.slice(2).join(' ') || 'Notification from Antigravity: Task completed!';

if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.error('Error: WHATSAPP_TOKEN and PHONE_NUMBER_ID must be set in .env');
  process.exit(1);
}

if (!MY_PHONE_NUMBER) {
  console.error('Error: MY_PHONE_NUMBER must be set in .env (format: CountryCode+Number, e.g. 919876543210)');
  process.exit(1);
}

async function sendNotification() {
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
        to: MY_PHONE_NUMBER,
        type: 'text',
        text: { body: message }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Failed to send WhatsApp notification:', JSON.stringify(data, null, 2));
      process.exit(1);
    }
    console.log('Notification sent successfully to WhatsApp!');
  } catch (err) {
    console.error('Network error sending WhatsApp notification:', err.message);
    process.exit(1);
  }
}

sendNotification();
