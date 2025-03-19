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

// 🚀 1️⃣ Webhook Doğrulama
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

// 🚀 2️⃣ WhatsApp'tan Gelen Mesajları İşleme
app.post('/webhook', (req, res) => {
    try {
        console.log("📩 Gelen Webhook verisi:", JSON.stringify(req.body, null, 2));

        if (req.body.entry) {
            req.body.entry.forEach(entry => {
                entry.changes.forEach(change => {
                    if (change.field === "messages" && change.value.messages) {
                        change.value.messages.forEach(message => {
                            let from = message.from;
                            console.log(`📩 Yeni mesaj alındı (Gönderen: ${from})`);

                            // 📌 Butona basıldıysa
                            if (message.type === "interactive" && message.interactive.type === "button_reply") {
                                let button_id = message.interactive.button_reply.id;

                                if (button_id === "siparisim") {
                                    getOrders(from);
                                }
                            } else {
                                sendWhatsAppInteractiveMessage(from);
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

// 🚀 3️⃣ WhatsApp Butonlu Mesaj Gönderme
const sendWhatsAppInteractiveMessage = async (to) => {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

    const data = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "interactive",
        interactive: {
            type: "button",
            header: {
                type: "text",
                text: "Merhaba! Size nasıl yardımcı olabilirim?"
            },
            body: {
                text: "Lütfen bir seçenek seçin:"
            },
            action: {
                buttons: [
                    { type: "reply", reply: { id: "siparisim", title: "📦 Siparişim" } },
                    { type: "reply", reply: { id: "siparisim_nerede", title: "🚚 Siparişim Nerede?" } },
                    { type: "reply", reply: { id: "iade_iptal", title: "🔄 İade ve İptal" } }
                ]
            }
        }
    };

    try {
        await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error("❌ Butonlu mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
};

// 🚀 4️⃣ İKAS API Token Alma Fonksiyonu
const getToken = async () => {
    try {
        const response = await axios.post('https://api.myikas.com/api/v1/admin/auth/token', {
            clientId: IKAS_CLIENT_ID,
            clientSecret: IKAS_CLIENT_SECRET
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log("✅ Token alındı:", response.data.accessToken);
        return response.data.accessToken; // Bearer Token döndür
    } catch (error) {
        console.error("❌ Token alma hatası:", error.response ? error.response.data : error.message);
        return null;
    }
};

// 🚀 5️⃣ İKAS API’den Siparişleri Getirme
const getOrders = async (whatsappNumber) => {
    const url = IKAS_API_URL;
    const token = await getToken(); // Önce API token al

    if (!token) {
        sendWhatsAppMessage(whatsappNumber, "⚠️ Sipariş bilgilerinize ulaşılamıyor.");
        return;
    }

    const query = {
        query: `
        query {
            listOrder {
                data {
                    id
                    status
                    totalFinalPrice
                    currencyCode
                }
            }
        }`
    };

    try {
        console.log(`📡 İKAS API’ye sipariş listesi isteği gönderiliyor: ${JSON.stringify(query, null, 2)}`);

        const response = await axios.post(url, query, {
            headers: {
                "Authorization": `Bearer ${token}`, // Bearer Token kullanıyoruz
                "Content-Type": "application/json"
            }
        });

        console.log(`📨 İKAS API Yanıtı: ${JSON.stringify(response.data, null, 2)}`);

        if (!response.data || !response.data.data || !response.data.data.listOrder) {
            sendWhatsAppMessage(whatsappNumber, "⚠️ Siparişlerinize ulaşılamıyor.");
            return;
        }

        const orders = response.data.data.listOrder.data;
        if (orders.length > 0) {
            let message = "📦 Son siparişleriniz:\n";
            orders.forEach(order => {
                message += `📌 **Sipariş ID:** ${order.id}\n🔹 **Durum:** ${order.status}\n💰 **Tutar:** ${order.totalFinalPrice} ${order.currencyCode}\n\n`;
            });

            sendWhatsAppMessage(whatsappNumber, message);
        } else {
            sendWhatsAppMessage(whatsappNumber, "📦 Henüz siparişiniz bulunmamaktadır.");
        }
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        sendWhatsAppMessage(whatsappNumber, "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.");
    }
};

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
                'Content-Type': 'application/json'
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
