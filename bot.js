const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// API Anahtarları ve URL'ler
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IKAS_API_TOKEN_URL = `https://adadunyaoptik.myikas.com/api/admin/oauth/token`; // Sabit mağaza
const IKAS_API_GRAPHQL_URL = 'https://api.myikas.com/api/v1/admin/graphql';
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;

// Body-parser ayarları
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Webhook doğrulama
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

// Gelen mesajları işleme
app.post('/webhook', async (req, res) => {
    try {
        const entry = req.body.entry && req.body.entry[0];
        const change = entry && entry.changes && entry.changes[0];
        const messageData = change && change.value && change.value.messages && change.value.messages[0];

        if (messageData && messageData.from) {
            const from = messageData.from;
            const messageText = messageData.text ? messageData.text.body.toLowerCase() : "";

            console.log(`📩 Yeni mesaj alındı: "${messageText}" (Gönderen: ${from})`);

            if (messageText.includes("merhaba")) {
                sendWhatsAppInteractiveMessage(from);
            } else if (messageText.includes("siparişlerim")) {
                const orders = await getOrdersByPhone(from);
                sendWhatsAppMessage(from, orders);
            } else {
                sendWhatsAppMessage(from, `Merhaba! Size nasıl yardımcı olabilirim?`);
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Webhook işleme hatası:", error);
        res.sendStatus(500);
    }
});

// **WhatsApp Butonlu Mesaj Gönderme**
async function sendWhatsAppInteractiveMessage(to) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

    const data = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "interactive",
        interactive: {
            type: "button",
            body: { text: "Merhaba! Size nasıl yardımcı olabilirim?" },
            action: {
                buttons: [
                    { type: "reply", reply: { id: "siparisim", title: "📦 Siparişlerim" } },
                    { type: "reply", reply: { id: "siparisim_nerede", title: "🚚 Siparişim Nerede?" } },
                    { type: "reply", reply: { id: "iade_iptal", title: "🔄 İade ve İptal" } }
                ]
            }
        }
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        });
        console.log("✅ Butonlu mesaj gönderildi:", response.data);
    } catch (error) {
        console.error("❌ Butonlu mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
}

// **İKAS API'den Access Token Alma**
async function getAccessToken() {
    try {
        const response = await axios.post(IKAS_API_TOKEN_URL, 
            `grant_type=client_credentials&client_id=${IKAS_CLIENT_ID}&client_secret=${IKAS_CLIENT_SECRET}`,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
        console.log("✅ Access Token alındı:", response.data.access_token);
        return response.data.access_token;
    } catch (error) {
        console.error("❌ Access Token alma hatası:", error.response ? error.response.data : error.message);
        return null;
    }
}

// **İKAS API'den Telefon Numarasına Göre Sipariş Getirme**
async function getOrdersByPhone(phone) {
    const token = await getAccessToken();
    if (!token) {
        return "⚠️ Sipariş bilgilerinize ulaşılamıyor.";
    }

    // Telefon numarasını normalize et
    const normalizedPhone = "+90" + phone.replace(/\D/g, "").slice(-10);

    // GraphQL sorgusu
    const query = {
        query: `
        query {
            listOrder {
                data {
                    orderNumber
                    status
                    totalFinalPrice
                    currencyCode
                    customer {
                        phone
                    }
                }
            }
        }`
    };

    try {
        const response = await axios.post(IKAS_API_GRAPHQL_URL, query, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        const orders = response.data.data.listOrder.data;
        const userOrders = orders.filter(order => order.customer && order.customer.phone === normalizedPhone);

        if (userOrders.length === 0) {
            return "Telefon numaranıza ait sipariş bulunmamaktadır.";
        }

        let orderList = "📦 Siparişleriniz:\n";
        userOrders.forEach(order => {
            orderList += `📌 Sipariş No: ${order.orderNumber}, Durum: ${order.status}, Tutar: ${order.totalFinalPrice} ${order.currencyCode}\n`;
        });

        return orderList;
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? error.response.data : error.message);
        return "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.";
    }
}

// **WhatsApp Mesajı Gönderme**
async function sendWhatsAppMessage(to, message) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

    const data = {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message }
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        });
        console.log("✅ Mesaj gönderildi:", response.data);
    } catch (error) {
        console.error("❌ WhatsApp mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
}

// **Sunucuyu Başlat**
app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});
