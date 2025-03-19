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

app.use(bodyParser.json({ strict: false }));
app.use(bodyParser.urlencoded({ extended: true }));

// 🚀 Webhook doğrulama
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

// 🚀 WhatsApp gelen mesajları yakalama
app.post('/webhook', (req, res) => {
    try {
        console.log("📩 Gelen Webhook verisi:", JSON.stringify(req.body, null, 2));

        if (req.body.entry) {
            req.body.entry.forEach(entry => {
                entry.changes.forEach(change => {
                    if (change.field === "messages" && change.value.messages) {
                        change.value.messages.forEach(message => {
                            let from = message.from;
                            let text = message.text ? message.text.body.toLowerCase() : "";

                            console.log(`📩 Yeni mesaj alındı: "${text}" (Gönderen: ${from})`);

                            // Eğer müşteri "Siparişlerim" yazarsa, İKAS API'den sipariş bilgisi al
                            if (text.includes("siparişlerim")) {
                                getOrders(from);
                            } else {
                                // Genel mesajlara otomatik yanıt
                                sendWhatsAppMessage(from, `Merhaba! "${text}" mesajınızı aldım.`);
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

// 🚀 WhatsApp mesaj gönderme fonksiyonu
const sendWhatsAppMessage = async (to, message) => {
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
                'Content-Type': 'application/json'
            }
        });
        console.log("✅ Mesaj gönderildi:", response.data);
    } catch (error) {
        console.error("❌ Mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
};

// 🚀 İKAS API ile siparişleri çekme fonksiyonu
const getOrders = async (whatsappNumber) => {
    const url = IKAS_API_URL;

    const query = {
        query: `
        query {
            orders(first: 5) {
                edges {
                    node {
                        id
                        status
                        totalPrice {
                            amount
                            currency
                        }
                    }
                }
            }
        }`
    };

    try {
        const response = await axios.post(url, query, {
            headers: {
                "Authorization": `Basic ${Buffer.from(`${IKAS_CLIENT_ID}:${IKAS_CLIENT_SECRET}`).toString("base64")}`,
                "Content-Type": "application/json"
            }
        });

        const orders = response.data.data.orders.edges;
        if (orders.length > 0) {
            let message = "📦 Son 5 siparişiniz:\n";
            orders.forEach(order => {
                message += `📌 **Sipariş ID:** ${order.node.id}\n🔹 **Durum:** ${order.node.status}\n💰 **Tutar:** ${order.node.totalPrice.amount} ${order.node.totalPrice.currency}\n\n`;
            });

            sendWhatsAppMessage(whatsappNumber, message);
        } else {
            sendWhatsAppMessage(whatsappNumber, "📦 Henüz siparişiniz bulunmamaktadır.");
        }
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? error.response.data : error.message);
        sendWhatsAppMessage(whatsappNumber, "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.");
    }
};

// 🚀 Sunucuyu başlat
app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});
