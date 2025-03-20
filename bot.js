const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// Ortam değişkenleri ve API URL'leri
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IKAS_API_TOKEN_URL = `https://adadunyaoptik.myikas.com/api/admin/oauth/token`;
const IKAS_API_GRAPHQL_URL = 'https://api.myikas.com/api/v1/admin/graphql';
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;

// Body-parser ayarları
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Kullanıcı state'lerini tutan obje
const userStates = {};

// Statü çeviri fonksiyonu
function translateStatus(status) {
  const map = {
    "created": "Sipariş oluşturuldu",
    "delivered": "Teslim edildi",
    "canceled": "İptal edildi",
    "shipped": "Kargoya verildi",
    "processing": "Hazırlanıyor"
  };
  return map[status] || status;
}

// WEBHOOK GET – Doğrulama
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token === VERIFY_TOKEN) {
    console.log("✅ Webhook doğrulandı!");
    res.status(200).send(challenge);
  } else {
    console.error("❌ Webhook doğrulaması başarısız.");
    res.sendStatus(403);
  }
});

// WEBHOOK POST – Mesajları İşleme
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry && req.body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const messageData = change && change.value && change.value.messages && change.value.messages[0];

    if (messageData && messageData.from) {
      const from = messageData.from;
      if (!userStates[from]) {
        userStates[from] = { mainMenuShown: false, awaitingOrderNumber: false, currentOrder: null };
      }

      console.log("📩 Gelen mesaj:", JSON.stringify(messageData, null, 2));

      let buttonId = "";
      let buttonTitle = "";

      if (messageData.button_reply) {
        if (messageData.button_reply.id) {
          buttonId = messageData.button_reply.id.toLowerCase().trim();
        }
        if (messageData.button_reply.title) {
          buttonTitle = messageData.button_reply.title.toLowerCase().trim();
        }
      } else if (messageData.text && messageData.text.body) {
        buttonTitle = messageData.text.body.toLowerCase().trim();
      }

      console.log(`📩 Buton ID: "${buttonId}", Buton Başlığı: "${buttonTitle}" (Gönderen: ${from})`);

      // **Siparişlerim Butonu Kontrolü**
      if (buttonId === "siparislerim" || buttonTitle === "siparişlerim") {
        const orders = await getOrdersByPhone(from);
        if (typeof orders === 'string' || orders.length === 0) {
          sendWhatsAppMessage(from, "Telefon numaranıza kayıtlı sipariş bulunamadı. Sipariş numaranızı girerek kontrol edebilirsiniz.");
          userStates[from].awaitingOrderNumber = true;
        } else {
          orders.forEach(order => {
            sendOrderInteractiveMessage(from, order);
          });
        }
        return res.sendStatus(200);
      }

      sendWhatsAppMessage(from, "Lütfen menüdeki butonlardan birini seçiniz.");
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook işleme hatası:", error);
    res.sendStatus(500);
  }
});

// IKAS API – Access Token alma
async function getAccessToken() {
  try {
    const response = await axios.post(
      IKAS_API_TOKEN_URL,
      `grant_type=client_credentials&client_id=${IKAS_CLIENT_ID}&client_secret=${IKAS_CLIENT_SECRET}`,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return response.data.access_token;
  } catch (error) {
    console.error("❌ Access Token alma hatası:", error.response ? error.response.data : error.message);
    return null;
  }
}

// Telefon numarasına göre siparişleri getirme
async function getOrdersByPhone(phone) {
  const token = await getAccessToken();
  if (!token) return "⚠️ Sipariş bilgilerinize ulaşılamıyor.";

  const normalizedPhone = "+90" + phone.replace(/\D/g, "").slice(-10);

  const query = {
    query: `
    query {
        listOrder {
            data {
                orderNumber
                status
                totalFinalPrice
                currencyCode
                createdAt
                orderItems {
                    product {
                        name
                    }
                }
                customer {
                    phone
                }
            }
        }
    }`
  };

  try {
    const response = await axios.post(IKAS_API_GRAPHQL_URL, query, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });

    const orders = response.data.data.listOrder.data;
    const userOrders = orders.filter(order => order.customer && order.customer.phone === normalizedPhone);

    return userOrders;
  } catch (error) {
    console.error("❌ IKAS API hata:", error.response ? error.response.data : error.message);
    return "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.";
  }
}

// Sipariş için interaktif mesaj gönderme
async function sendOrderInteractiveMessage(to, order) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "Bilinmiyor";
  const status = translateStatus(order.status || "Bilinmiyor");
  const productName = order.orderItems.length > 0 ? order.orderItems[0].product.name : "Ürün bilgisi yok";
  const bodyText = `📦 Sipariş No: ${order.orderNumber}\n📅 Sipariş Tarihi: ${orderDate}\n🔵 Durumu: ${status}\n🛍️ Ürün: ${productName}\n💰 Fiyat: ${order.totalFinalPrice} ${order.currencyCode}`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: [{ type: "reply", reply: { id: `order_detail_${order.orderNumber}`, title: "Bu Siparişi İncele" } }]
      }
    }
  };

  try {
    await axios.post(url, data, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error(`❌ Sipariş ${order.orderNumber} için mesaj gönderme hatası:`, error.response ? error.response.data : error.message);
  }
}

app.listen(port, () => console.log(`🚀 Sunucu ${port} portunda çalışıyor!`));
