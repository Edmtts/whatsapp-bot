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

const userStates = {}; // kullanıcı durumları

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

  // 🔍 Buton tıklaması veya düz mesajı yakala
  const msgText =
    message.button_reply?.id?.toLowerCase().trim() ||
    message.text?.body?.toLowerCase().trim() ||
    "";

  console.log(`📩 [${from}] mesaj:`, msgText);

  if (!userStates[from]) userStates[from] = {};

  // İlk karşılama menüsü
  if (!userStates[from].mainMenuShown) {
    await sendMainMenu(from);
    userStates[from].mainMenuShown = true;
    return res.sendStatus(200);
  }

  // Siparişlerim butonu
  if (msgText === "siparislerim") {
    const orders = await getOrdersByPhone(from);
    if (!orders || orders.length === 0) {
      await sendMessage(from, "📭 Kayıtlı sipariş bulunamadı. Lütfen sipariş numaranızı manuel olarak yazın:");
      userStates[from].awaitingOrderNumber = true;
    } else {
      for (const order of orders) {
        await sendMessage(from, `📦 Sipariş No: ${order.orderNumber}\nDurum: ${order.status}`);
      }
    }
  } else if (userStates[from].awaitingOrderNumber) {
    const order = await getOrderByNumber(msgText);
    if (order) {
      await sendMessage(from, `📦 Sipariş No: ${order.orderNumber}\nDurum: ${order.status}`);
    } else {
      await sendMessage(from, "❌ Sipariş bulunamadı, lütfen tekrar deneyin.");
    }
    userStates[from].awaitingOrderNumber = false;
  } else {
    await sendMessage(from, "ℹ️ Lütfen aşağıdaki menüden bir seçenek seçin.");
    await sendMainMenu(from);
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
      body: { text: "Merhaba! Size nasıl yardımcı olabilirim?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "siparislerim", title: "Siparişlerim" } }
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

// 🔍 Sipariş numarasına göre tek sipariş getir
async function getOrderByNumber(orderNumber) {
  const token = await getAccessToken();
  if (!token) return null;

  const query = {
    query: `
      query ($orderNumber: String!) {
        order(orderNumber: $orderNumber) {
          orderNumber
          status
        }
      }
    `,
    variables: { orderNumber }
  };

  try {
    const response = await axios.post(IKAS_GRAPHQL_URL, query, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return response.data.data.order;
  } catch (err) {
    console.error("❌ Tek sipariş hatası:", err.response?.data || err.message);
    return null;
  }
}

// 🔥 Sunucu başlat
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot ${PORT} portunda çalışıyor.`);
});
