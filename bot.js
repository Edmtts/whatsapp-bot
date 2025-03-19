const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// API Anahtarları
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IKAS_API_URL = process.env.IKAS_API_URL;
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;



app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🚀 1️⃣ Webhook Doğrulama (Facebook için)
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === VERIFY_TOKEN) {
        console.log("✅ Webhook doğrulandı!");
        res.status(200).send(challenge);
    } else {
        console.error("❌ Webhook doğrulaması başarısız.");
        res.sendStatus(403);
    }
});

// 🚀 2️⃣ İKAS API’den Access Token Alma
const getAccessToken = async () => {
    try {
        const response = await axios.post(`${IKAS_API_URL}/oauth/token`, 
            new URLSearchParams({
                grant_type: "client_credentials",
                client_id: IKAS_CLIENT_ID,
                client_secret: IKAS_CLIENT_SECRET
            }), 
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        console.log("✅ Access Token Alındı:", response.data.access_token);
        return response.data.access_token;
    } catch (error) {
        console.error("❌ Token Alma Hatası:", error.response ? error.response.data : error.message);
        return null;
    }
};

// 🚀 3️⃣ WhatsApp Kullanıcısından Sipariş Numarası Alma
const requestOrderNumber = async (to) => {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

    const data = {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: "📌 Lütfen sipariş numaranızı giriniz (örn: ADA1016)" }
    };

    try {
        await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        });
    } catch (error) {
        console.error("❌ Sipariş numarası isteme hatası:", error.response ? error.response.data : error.message);
    }
};

// 🚀 4️⃣ Sipariş Numarası ile Sipariş Getirme (İKAS API)
const getOrderById = async (whatsappNumber, orderId) => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
        sendWhatsAppMessage(whatsappNumber, "⚠️ Sipariş bilgilerinize ulaşılamıyor.");
        return;
    }

    const query = {
        query: `
        query {
            orderById(id: "${orderId}") {
                id
                status
                totalFinalPrice
                currencyCode
            }
        }`
    };

    try {
        const response = await axios.post(`${IKAS_API_URL}/graphql`, query, {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            }
        });

        console.log(`📨 İKAS API Yanıtı: ${JSON.stringify(response.data, null, 2)}`);

        if (!response.data || !response.data.data || !response.data.data.orderById) {
            sendWhatsAppMessage(whatsappNumber, `⚠️ Sipariş numaranız (${orderId}) bulunamadı.`);
            return;
        }

        const order = response.data.data.orderById;
        let message = `📦 **Sipariş Bilgileriniz:**\n\n`;
        message += `📌 **Sipariş ID:** ${order.id}\n🔹 **Durum:** ${order.status}\n💰 **Tutar:** ${order.totalFinalPrice} ${order.currencyCode}`;

        sendWhatsAppMessage(whatsappNumber, message);
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        sendWhatsAppMessage(whatsappNumber, "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.");
    }
};

// 🚀 5️⃣ WhatsApp Gelen Mesajları İşleme
app.post("/webhook", (req, res) => {
    try {
        console.log("📩 Gelen Webhook verisi:", JSON.stringify(req.body, null, 2));

        if (req.body.entry) {
            req.body.entry.forEach(entry => {
                entry.changes.forEach(change => {
                    if (change.field === "messages" && change.value.messages) {
                        change.value.messages.forEach(message => {
                            let from = message.from;
                            let text = message.text ? message.text.body.toUpperCase() : "";

                            console.log(`📩 Yeni mesaj alındı: "${text}" (Gönderen: ${from})`);

                            // 📌 Eğer sipariş butonuna basıldıysa, sipariş numarası isteyelim
                            if (message.type === "interactive" && message.interactive.type === "button_reply") {
                                let button_id = message.interactive.button_reply.id;

                                if (button_id === "siparisim") {
                                    requestOrderNumber(from);
                                }
                            }
                            // 📌 Kullanıcı bir sipariş numarası girdiyse, API'den sorgulama yap
                            else if (text.startsWith("ADA") || text.startsWith("SIP")) {
                                getOrderById(from, text);
                            }
                        });
                    }
                });
            });
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Webhook hata:", error);
        res.sendStatus(500);
    }
});

// 🚀 6️⃣ WhatsApp Düz Metin Mesaj Gönderme
const sendWhatsAppMessage = async (to, message) => {
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
        console.error("❌ Mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
};

// 🚀 7️⃣ Sunucuyu Başlat
app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});
