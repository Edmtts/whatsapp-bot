const express = require('express');
require('dotenv').config();
const axios = require('axios');

const app = express();
const port = process.env.PORT || 10000;

// 🌍 API Anahtarları ve URL'ler
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IKAS_API_TOKEN_URL = `https://adadunyaoptik.myikas.com/api/admin/oauth/token`;
const IKAS_API_GRAPHQL_URL = 'https://api.myikas.com/api/v1/admin/graphql';
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ **1. Webhook Doğrulama**
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

// ✅ **2. Gelen Mesajları İşleme**
app.post('/webhook', async (req, res) => {
    try {
        const entry = req.body.entry && req.body.entry[0];
        const change = entry && entry.changes && entry.changes[0];
        const messageData = change && change.value && change.value.messages && change.value.messages[0];

        if (messageData && messageData.from) {
            const from = messageData.from;
            const messageReplyId = messageData.message && messageData.message.reply && messageData.message.reply.id;

            console.log(`📩 Yeni mesaj alındı: (Gönderen: ${from})`);

            if (messageReplyId === "siparislerim") {
                const orders = await getOrdersByPhone(from);
                await sendWhatsAppMessage(from, orders);
            } else if (messageReplyId === "siparisim_nerede") {
                // Sipariş durumu sorgulama fonksiyonunu çağır
            } else if (messageReplyId === "iade_iptal") {
                // İade ve iptal işlemleri için fonksiyonu çağır
            } else {
                await sendWhatsAppMessage(from, `Merhaba! Size nasıl yardımcı olabilirim?`);
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Webhook işleme hatası:", error);
        res.sendStatus(500);
    }
});

// ✅ **3. WhatsApp Butonlu Mesaj Gönderme**
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
                    { type: "reply", reply: { id: "siparislerim", title: "📦 Siparişlerim" } },
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

// ✅ **4. WhatsApp Metin Mesajı Gönderme**
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
