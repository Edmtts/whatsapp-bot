const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

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


// 🚀 Express Middleware
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
app.post('/webhook', async (req, res) => {
    try {
        console.log("📩 Gelen Webhook verisi:", JSON.stringify(req.body, null, 2));

        if (req.body.entry) {
            for (let entry of req.body.entry) {
                for (let change of entry.changes) {
                    if (change.field === "messages" && change.value.messages) {
                        for (let message of change.value.messages) {
                            let from = message.from;
                            let text = message.text ? message.text.body.toLowerCase() : "";

                            console.log(`📩 Yeni mesaj alındı: "${text}" (Gönderen: ${from})`);

                            if (text === "siparişlerim") {
                                await sendOrdersWithImages(from);
                            } else {
                                await sendWhatsAppInteractiveMessage(from);
                            }
                        }
                    }
                }
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Webhook işleme hatası:", error);
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
            body: {
                text: "Merhaba! Size nasıl yardımcı olabilirim?"
            },
            action: {
                buttons: [
                    { type: "reply", reply: { id: "siparisim", title: "📦 Siparişlerim" } }
                ]
            }
        }
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("✅ Butonlu mesaj gönderildi:", response.data);
    } catch (error) {
        console.error("❌ Butonlu mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
};

// 🚀 4️⃣ İKAS API’den Siparişleri Çekme ve Resim Gönderme
const sendOrdersWithImages = async (whatsappNumber) => {
    try {
        // 📌 API'ye erişim için token al
        const token = await getAccessToken();
        const url = `https://api.myikas.com/api/v1/admin/graphql`;

        // 🔹 Kullanıcının telefon numarasına göre siparişleri getir
        const query = {
            query: `query {
                listOrder {
                    data {
                        id
                        status
                        totalFinalPrice
                        currencyCode
                        orderLineItems {
                            finalPrice
                            variant {
                                name
                                mainImageId
                            }
                        }
                    }
                }
            }`
        };

        console.log(`📡 İKAS API’ye istek gönderiliyor: ${JSON.stringify(query, null, 2)}`);

        const response = await axios.post(url, query, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        const orders = response.data.data.listOrder.data;
        if (orders.length > 0) {
            for (let order of orders) {
                for (let item of order.orderLineItems) {
                    await sendWhatsAppImage(whatsappNumber, item.variant.mainImageId);
                    await sendWhatsAppMessage(whatsappNumber, `📦 **Sipariş ID:** ${order.id}\n🔹 **Durum:** ${order.status}\n💰 **Tutar:** ${order.totalFinalPrice} ${order.currencyCode}\n🛒 **Ürün:** ${item.variant.name}`);
                }
            }
        } else {
            await sendWhatsAppMessage(whatsappNumber, "📦 Henüz siparişiniz bulunmamaktadır.");
        }
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        await sendWhatsAppMessage(whatsappNumber, "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.");
    }
};

// 🚀 5️⃣ WhatsApp Resimli Mesaj Gönderme
const sendWhatsAppImage = async (to, imageUrl) => {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

    const data = {
        messaging_product: "whatsapp",
        to: to,
        type: "image",
        image: {
            link: imageUrl
        }
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("✅ Resimli mesaj gönderildi:", response.data);
    } catch (error) {
        console.error("❌ Resimli mesaj gönderme hatası:", error.response ? error.response.data : error.message);
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

// 🚀 7️⃣ İKAS API için Access Token Alma Fonksiyonu
const getAccessToken = async () => {
    try {
        const response = await axios.post(`https://${IKAS_STORE_NAME}.myikas.com/api/admin/oauth/token`, null, {
            params: {
                grant_type: 'client_credentials',
                client_id: IKAS_CLIENT_ID,
                client_secret: IKAS_CLIENT_SECRET
            },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        return response.data.access_token;
    } catch (error) {
        console.error("❌ Erişim Belirteci alma hatası:", error.response ? error.response.data : error.message);
        throw new Error("İKAS API erişim belirteci alınamadı!");
    }
};

// 🚀 8️⃣ Sunucuyu Başlat
app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});
