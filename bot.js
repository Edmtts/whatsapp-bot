const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// API ENV Değişkenleri
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IKAS_API_TOKEN_URL = process.env.IKAS_API_TOKEN_URL;
const IKAS_API_GRAPHQL_URL = process.env.IKAS_API_GRAPHQL_URL;
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;

// Body-parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Kullanıcı state'leri
const userStates = {};

// **Sipariş Statü Çeviri**
function translateStatus(status) {
    const statusMap = {
        "created": "Sipariş oluşturuldu",
        "delivered": "Teslim edildi",
        "canceled": "İptal edildi",
        "shipped": "Kargoya verildi",
        "processing": "Hazırlanıyor"
    };
    return statusMap[status] || status;
}

// **WEBHOOK - Doğrulama**
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

// **WEBHOOK - Mesaj İşleme**
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

            let buttonId = "";
            let buttonTitle = "";

            if (messageData.button_reply) {
                buttonId = messageData.button_reply.id ? messageData.button_reply.id.toLowerCase().trim() : "";
                buttonTitle = messageData.button_reply.title ? messageData.button_reply.title.toLowerCase().trim() : "";
            } else if (messageData.text && messageData.text.body) {
                buttonTitle = messageData.text.body.toLowerCase().trim();
            }

            console.log(`📩 Buton ID: "${buttonId}", Buton Başlığı: "${buttonTitle}" (Gönderen: ${from})`);

            // **Ana Menü Daha Önce Gösterildi Mi?**
            if (!userStates[from].mainMenuShown) {
                sendMainMenu(from);
                userStates[from].mainMenuShown = true;
                return res.sendStatus(200);
            }

            // **Siparişlerim**
            if (buttonId === "siparislerim" || buttonTitle === "siparişlerim") {
                const orders = await getOrdersByPhone(from);
                if (!orders || orders.length === 0) {
                    sendWhatsAppMessage(from, "Telefon numaranıza kayıtlı sipariş bulunamadı. Sipariş numaranızı girerek kontrol edebilirsiniz.");
                    userStates[from].awaitingOrderNumber = true;
                } else {
                    orders.forEach(order => sendOrderInteractiveMessage(from, order));
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

// **Ana Menü Gönder**
async function sendMainMenu(to) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "interactive",
        interactive: {
            type: "button",
            body: { text: "📌 Merhaba! Size nasıl yardımcı olabilirim?" },
            action: {
                buttons: [
                    { type: "reply", reply: { id: "siparislerim", title: "📦 Siparişlerim" } },
                    { type: "reply", reply: { id: "iade", title: "🔄 İade Talebi" } }
                ]
            }
        }
    };

    try {
        const response = await axios.post(url, data, {
            headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
        });
        console.log("✅ Ana Menü Gönderildi:", response.data);
    } catch (error) {
        console.error("❌ Ana Menü Gönderme Hatası:", error.response ? error.response.data : error.message);
    }
}

// **Siparişleri Telefon Numarasına Göre Çek**
async function getOrdersByPhone(phone) {
    const token = await getAccessToken();
    if (!token) return null;
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

        return response.data.data.listOrder.data.filter(order => order.customer.phone === normalizedPhone);
    } catch (error) {
        console.error("❌ IKAS API hata:", error.response ? error.response.data : error.message);
        return null;
    }
}

// **WhatsApp Mesaj Gönderme**
async function sendWhatsAppMessage(to, message) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const data = { messaging_product: "whatsapp", to, type: "text", text: { body: message } };

    await axios.post(url, data, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" } });
}

// **Sunucuyu Başlat**
app.listen(port, () => console.log(`🚀 Bot ${port} portunda çalışıyor!`));
