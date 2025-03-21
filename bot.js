const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IKAS_TOKEN_URL = 'https://adadunyaoptik.myikas.com/api/admin/oauth/token';
const IKAS_GRAPHQL_URL = 'https://api.myikas.com/api/v1/admin/graphql';
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const message = req.body.entry[0].changes[0].value.messages[0];
  const from = message.from;
  const msgText = message.button_reply ? message.button_reply.id : "";

  console.log(`Received message from ${from}: ${msgText}`);

  switch (msgText) {
    case 'siparislerim':
      const orders = await getOrdersByPhone(from);
      if (!orders || orders.length === 0) {
        await sendMessage(from, "Telefon numaranıza kayıtlı sipariş bulunamadı.");
      } else {
        orders.forEach(order => {
          const message = `Sipariş No: ${order.orderNumber}\nSipariş Tarihi: ${order.createdAt}\nÜrünler: ${order.productName}\nFiyat: ${order.totalFinalPrice} ${order.currencyCode}\nDurum: ${order.status}`;
          sendMessage(from, message);
        });
      }
      break;
    default:
      sendMainMenu(from);
      break;
  }

  res.sendStatus(200);
});

async function sendMainMenu(to) {
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "Merhaba! Size nasıl yardımcı olabilirim?"
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "siparislerim", title: "Siparişlerim" } },
          { type: "reply", reply: { id: "siparisim_nerede", title: "Siparişim Nerede" } },
          { type: "reply", reply: { id: "iade_iptal", title: "İade ve İptal" } }
        ]
      }
    }
  };

  await axios.post(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, data, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
  });
}

async function sendMessage(to, message) {
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { body: message }
  };

  await axios.post(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, data, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
  });
}

// Siparişlerin çekilmesi ve diğer fonksiyonlar yukarıdaki gibi kalıyor

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
