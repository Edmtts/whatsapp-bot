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

// ✅ Webhook doğrulama
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log("✅ Webhook doğrulandı");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 📩 Gelen mesajı yakalama
app.post('/webhook', async (req, res) => {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const from = message?.from;
  if (!message || !from) return res.sendStatus(200);

  const msgText =
    message.button_reply?.id?.toLowerCase().trim() ||
    message.text?.body?.toLowerCase().trim() ||
    "";

  console.log(`📩 [${from}] mesaj:`, msgText);

  if (!['siparislerim', 'siparisim_nerede', 'iade_iptal'].includes(msgText)) {
    await sendMainMenu(from);
    return res.sendStatus(200);
  }

  switch (msgText) {
    case 'siparislerim':
      const orders = await getOrdersByPhone(from);
      if (!orders || orders.length === 0) {
        await sendMessage(from, "📭 Telefon numaranıza kayıtlı siparişler bulunamadı, dilerseniz sipariş numaranızı yazarak işlem sağlayabilirsiniz.");
      } else {
        for (const order of orders) {
          const orderInfo = `Sipariş no: ${order.orderNumber}\nSipariş Tarihi: ${order.createdAt}\nÜrün: ${order.productName}\nFiyat: ${order.totalFinalPrice} ${order.currencyCode}\nDurum: ${order.status}`;
          await sendMessage(from, orderInfo);
        }
      }
      break;
    default:
      await sendMessage(from, "ℹ️ Lütfen aşağıdaki menüden bir seçenek seçin.");
      await sendMainMenu(from);
      break;
  }

  res.sendStatus(200);
});

// 📤 Menü gönder
async function sendMainMenu(to) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Merhaba size nasıl yardımcı olabilirim?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "siparislerim", title: "Siparişlerim" } },
          { type: "reply", reply: { id: "siparisim_nerede", title: "Siparişim Nerede" } },
          { type: "reply", reply: { id: "iade_iptal", title: "İade ve İptal" } }
        ]
      }
    }
  };

  await axios.post(url, data, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

// 📤 Düz mesaj gönder
async function sendMessage(to, message) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { body: message }
  };

  await axios.post(url, data, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

// 🔐 IKAS Access Token
async function getAccessToken() {
  try {
    const response = await axios.post(
      IKAS_TOKEN_URL,
      `grant_type=client_credentials&client_id=${IKAS_CLIENT_ID}&client_secret=${IKAS_CLIENT_SECRET}`,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return response.data.access_token;
  } catch (err) {
    console.error("❌ Token hatası:", err.response?.data || err.message);
    return null;
  }
}

// ☎️ Telefona göre siparişleri çek
async function getOrdersByPhone(phone) {
  const token = await getAccessToken();
  if (!token) return [];

  const normalizedPhone = "+90" + phone.replace(/\D/g, "").slice(-10);
  const query = {
    query: `
      query {
        listOrder {
          data {
            orderNumber
            createdAt
            productName
            totalFinalPrice
            currencyCode
            status
            customer { phone }
          }
        }
      }
    `
  };

  try {
    const response = await axios.post(IKAS_GRAPHQL_URL, query, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const allOrders = response.data.data.listOrder.data;
    const filtered = allOrders.filter(o => o.customer?.phone === normalizedPhone);
    return filtered;
  } catch (err) {
    console.error("❌ Sipariş çekme hatası:", err.response?.data || err.message);
    return [];
  }
}

// 🔥 Sunucu başlat
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot ${PORT} portunda çalışıyor.`);
});
