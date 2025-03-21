const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// .env dosyasından ayarlar
const PORT = process.env.PORT || 10000;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IKAS_TOKEN_URL = 'https://adadunyaoptik.myikas.com/api/admin/oauth/token';
const IKAS_GRAPHQL_URL = 'https://api.myikas.com/api/v1/admin/graphql';
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;

// Kullanıcı durumlarını tutan obje
const userStates = {};

// 1. Webhook Doğrulama
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log("✅ Webhook doğrulandı");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// 2. Webhook POST: Gelen mesajların işlenmesi
app.post('/webhook', async (req, res) => {
  // Mesaj yapısını güvenli şekilde alıyoruz.
  const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) {
    return res.sendStatus(200);
  }

  const from = message.from;
  // Buton tıklaması varsa button_reply; yoksa text body'den alıyoruz.
  const msgText = message.button_reply?.id?.toLowerCase().trim() ||
                  message.text?.body?.toLowerCase().trim() || "";

  console.log(`Received message from ${from}: ${msgText}`);

  // Eğer kullanıcı bir sipariş numarası girmesi gerekiyorsa
  if (userStates[from]?.awaitingOrderNumber) {
    const order = await getOrderByNumber(msgText);
    if (order) {
      const orderDetail = formatOrderDetail(order);
      await sendMessage(from, orderDetail);
    } else {
      // Sipariş bulunamadı, müşteri temsilcisine bağlan butonlu mesaj gönder
      await sendMessage(from, "Girdiğin sipariş numarasına ait sipariş bulunamadı. Dilersen müşteri temsilcisine bağlanabilirsin.");
      await sendCustomerServiceButton(from);
    }
    userStates[from].awaitingOrderNumber = false;
    return res.sendStatus(200);
  }

  // Eğer sipariş detay butonuna basılmışsa (id: order_detail_{orderNumber})
  if (msgText.startsWith("order_detail_")) {
    const orderNumber = msgText.replace("order_detail_", "");
    const order = await getOrderByNumber(orderNumber);
    if (order) {
      const orderDetail = formatOrderDetail(order);
      await sendMessage(from, orderDetail);
    } else {
      await sendMessage(from, "Sipariş detayları bulunamadı.");
    }
    return res.sendStatus(200);
  }

  // Ana Menü seçenekleri
  if (msgText === "siparislerim") {
    // Kullanıcının telefonuna kayıtlı siparişleri getir
    const orders = await getOrdersByPhone(from);
    if (!orders || orders.length === 0) {
      await sendMessage(from, "📭 Telefon numaranıza kayıtlı siparişler bulunamadı, dilersen sipariş numaranızı yazarak işlem sağlayabilirsiniz.");
      userStates[from] = { awaitingOrderNumber: true };
    } else {
      // Her sipariş için detayları ve 'Bu Siparişi İncele' butonunu gönder
      for (const order of orders) {
        const orderInfo = formatOrderSummary(order);
        await sendOrderInteractiveMessage(from, order, orderInfo);
      }
    }
    return res.sendStatus(200);
  }

  // Diğer buton seçenekleri için (örneğin "siparisim nerede", "iade ve iptal") şimdilik ana menü gösteriliyor.
  await sendMainMenu(from);
  return res.sendStatus(200);
});

// Ana menüyü gönder: Herhangi bir metin yazıldığında veya bilinmeyen durumda
async function sendMainMenu(to) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Merhaba, size nasıl yardımcı olabilirim?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "siparislerim", title: "Siparişlerim" } },
          { type: "reply", reply: { id: "siparisim_nerede", title: "Siparişim Nerede" } },
          { type: "reply", reply: { id: "iade_iptal", title: "İade ve İptal" } }
        ]
      }
    }
  };

  try {
    await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Ana menü gönderme hatası:", error.response?.data || error.message);
  }
}

// Düz metin mesaj gönderme fonksiyonu
async function sendMessage(to, message) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { body: message }
  };

  try {
    await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Mesaj gönderme hatası:", error.response?.data || error.message);
  }
}

// Sipariş detay butonlu interaktif mesaj gönderme
async function sendOrderInteractiveMessage(to, order, orderInfo) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: orderInfo },
      action: {
        buttons: [
          { type: "reply", reply: { id: `order_detail_${order.orderNumber}`, title: "Bu Siparişi İncele" } }
        ]
      }
    }
  };

  try {
    await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Sipariş detay butonlu mesaj gönderme hatası:", error.response?.data || error.message);
  }
}

// Müşteri temsilcisine bağlan butonlu mesaj gönderme
async function sendCustomerServiceButton(to) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Müşteri temsilcisine bağlanmak ister misiniz?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "musteri_temsilci", title: "Müşteri Temsilcisine Bağlan" } }
        ]
      }
    }
  };

  try {
    await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Müşteri temsilcisi mesajı gönderme hatası:", error.response?.data || error.message);
  }
}

// Sipariş detaylarını getir (tek sipariş sorgulama)
async function getOrderByNumber(orderNumber) {
  const token = await getAccessToken();
  if (!token) return null;

  const query = {
    query: `
      query ($orderNumber: String!) {
        order(orderNumber: $orderNumber) {
          orderNumber
          createdAt
          totalFinalPrice
          currencyCode
          status
          customer { phone }
          orderLineItems {
            product {
              name
            }
            quantity
            unitPrice
          }
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
  } catch (error) {
    console.error("Tek sipariş sorgulama hatası:", error.response?.data || error.message);
    return null;
  }
}

// Telefona göre siparişleri getir (liste sorgulama)
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
            totalFinalPrice
            currencyCode
            status
            customer { phone }
            orderLineItems {
              product {
                name
              }
              quantity
              unitPrice
            }
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
    // Her sipariş için ürün bilgilerini birleştiriyoruz.
    return filtered.map(order => ({
      ...order,
      productName: order.orderLineItems.map(item => `${item.quantity}x ${item.product.name}`).join(", ")
    }));
  } catch (error) {
    console.error("Sipariş çekme hatası:", error.response?.data || error.message);
    return [];
  }
}

// IKAS API'den access token alma fonksiyonu
async function getAccessToken() {
  try {
    const response = await axios.post(
      IKAS_TOKEN_URL,
      `grant_type=client_credentials&client_id=${IKAS_CLIENT_ID}&client_secret=${IKAS_CLIENT_SECRET}`,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return response.data.access_token;
  } catch (error) {
    console.error("Token alma hatası:", error.response?.data || error.message);
    return null;
  }
}

// Sipariş özet formatını oluşturma (liste halinde gönderilecek mesaj)
function formatOrderSummary(order) {
  return `Sipariş no: ${order.orderNumber}\nSipariş Tarihi: ${order.createdAt}\nÜrün: ${order.productName}\nFiyat: ${order.totalFinalPrice} ${order.currencyCode}\nDurum: ${order.status}`;
}

// Sipariş detay formatını oluşturma (tek sipariş sorgulama için)
function formatOrderDetail(order) {
  return `Sipariş no: ${order.orderNumber}\nSipariş Tarihi: ${order.createdAt}\nÜrün: ${order.orderLineItems.map(item => `${item.quantity}x ${item.product.name}`).join(", ")}\nFiyat: ${order.totalFinalPrice} ${order.currencyCode}\nDurum: ${order.status}`;
}

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot ${PORT} portunda çalışıyor.`);
});
