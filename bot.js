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

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

            if (messageData.type === "interactive") {
                const buttonId = messageData.interactive.button_reply.id;
                if (buttonId === "siparisim") {
                    const orders = await getOrdersByPhone(from);
                    await sendWhatsAppOrderMessages(from, orders);
                } else {
                    await sendWhatsAppMessage(from, `Merhaba! Size nasıl yardımcı olabilirim?`);
                }
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

// ✅ **3. WhatsApp Mesaj Gönderme**
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

// ✅ **4. Siparişleri Ayrı Ayrı Mesaj Olarak Gönderme ve Buton Ekleme**
async function sendWhatsAppOrderMessages(to, orders) {
    for (const order of orders) {
        const message = `Sipariş Tarihi: ${order.date}\nSipariş No: ${order.orderNumber}\nÜrün: ${order.productName}\nFiyat: ${order.price}`;
        await sendWhatsAppInteractiveOrderMessage(to, message, order.orderNumber);
    }
}

// ✅ **5. Sipariş Detayları İçin İnteraktif Mesaj Gönderme**
async function sendWhatsAppInteractiveOrderMessage(to, message, orderId) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "interactive",
        interactive: {
            type: "button",
            body: { text: message },
            action: {
                buttons: [
                    { type: "reply", reply: { id: `detay_${orderId}`, title: "Sipariş Detayı" } }
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
        console.log("✅ İnteraktif sipariş mesajı gönderildi:", response.data);
    } catch (error) {
        console.error("❌ İnteraktif sipariş mesajı gönderme hatası:", error.response ? error.response.data : error.message);
    }
}

// ✅ **6. Telefon Numarasına Göre Siparişleri Getirme**
async function getOrdersByPhone(phone) {
    const token = await getAccessToken();
    if (!token) {
        return "⚠️ Sipariş bilgilerinize ulaşılamıyor.";
    }

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
                    customer {
                        phone
                    }
                    orderLineItems {
                        finalPrice
                        quantity
                        variant {
                            name
                            mainImageId
                        }
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

        const orders = response.data.data.listOrder.data.filter(order => order.customer && order.customer.phone === normalizedPhone);
        return orders.map(order => ({
            date: new Date(order.date).toLocaleDateString(), // Assuming 'date' is available and needs formatting
            orderNumber: order.orderNumber,
            productName: order.orderLineItems.map(item => item.variant.name).join(", "),
            price: `${order.totalFinalPrice} ${order.currencyCode}`
        }));
    } catch (error) {
        console.error("Error retrieving orders:", error.message);
        return [];
    }
}

// ✅ **7. Access Token Alma**
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

// **Sunucuyu Başlat**
app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});
