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
            const messageText = messageData.text ? messageData.text.body.toLowerCase() : "";
            const buttonId = messageData.button && messageData.button.payload;

            console.log(`📩 Yeni mesaj alındı: "${messageText}" (Gönderen: ${from})`);

            if (buttonId === "siparislerim" || messageText.includes("siparişlerim")) {
                const orders = await getOrdersByPhone(from);
                if (orders.includes("Telefon numaranıza ait sipariş bulunmamaktadır")) {
                    await sendWhatsAppMessage(from, orders); // Sipariş numarası iste
                } else {
                    await sendOrderList(from, orders); // Sipariş listesini gönder
                }
            } else if (buttonId && buttonId.startsWith("siparis_detay_")) {
                const orderNumber = buttonId.replace("siparis_detay_", "");
                const orderDetails = await getOrderDetails(orderNumber);
                await sendWhatsAppMessage(from, orderDetails); // Sipariş detaylarını gönder
            } else if (buttonId && buttonId.startsWith("kargo_takip_")) {
                const orderNumber = buttonId.replace("kargo_takip_", "");
                const trackingUrl = await getTrackingUrl(orderNumber);
                await sendWhatsAppMessage(from, `Kargo takip linkiniz: ${trackingUrl}`);
            } else if (messageText.includes("merhaba")) {
                await sendWhatsAppInteractiveMessage(from); // Butonlu mesaj gönder
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

// ✅ **5. İKAS API'den Access Token Alma**
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

// ✅ **6. Telefon Numarasına Göre Siparişleri Getirme**
async function getOrdersByPhone(phone) {
    const token = await getAccessToken();
    if (!token) {
        return "⚠️ Sipariş bilgilerinize ulaşılamıyor.";
    }

    const normalizedPhone = "+90" + phone.replace(/\D/g, "").slice(-10);
    console.log(`📞 İşlenen Telefon Numarası: ${normalizedPhone}`);

    const query = {
        query: `
        query {
            listOrder {
                data {
                    orderNumber
                    status
                    createdAt
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

        const orders = response.data.data.listOrder.data;
        const userOrders = orders.filter(order => order.customer && order.customer.phone === normalizedPhone);

        if (userOrders.length === 0) {
            return "📦 Telefon numaranıza ait sipariş bulunmamaktadır. Lütfen sipariş numaranızı girin:";
        }

        return userOrders;
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        return "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.";
    }
}

// ✅ **7. Sipariş Listesi Gönderme (Her Sipariş Ayrı Ayrı)**
async function sendOrderList(to, orders) {
    for (const order of orders) {
        const orderMessage = `🆔 **Sipariş No:** ${order.orderNumber}\n` +
                            `🔹 **Durum:** ${translateStatus(order.status)}\n` +
                            `📅 **Sipariş Tarihi:** ${order.createdAt || "Bilinmiyor"}\n\n` +
                            `🔍 Detayları görmek için butona basın:`;

        const data = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "interactive",
            interactive: {
                type: "button",
                body: { text: orderMessage },
                action: {
                    buttons: [
                        { type: "reply", reply: { id: `siparis_detay_${order.orderNumber}`, title: "📋 Sipariş Detayları" } }
                    ]
                }
            }
        };

        try {
            const response = await axios.post(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, data, {
                headers: {
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                    "Content-Type": "application/json"
                }
            });
            console.log("✅ Sipariş mesajı gönderildi:", response.data);
        } catch (error) {
            console.error("❌ Sipariş mesajı gönderme hatası:", error.response ? error.response.data : error.message);
        }
    }
}

// ✅ **8. Sipariş Detaylarını Getirme**
async function getOrderDetails(orderNumber) {
    const token = await getAccessToken();
    if (!token) {
        return "⚠️ Sipariş bilgilerinize ulaşılamıyor.";
    }

    const query = {
        query: `
        query {
            listOrder {
                data {
                    orderNumber
                    status
                    createdAt
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
                    shipping {
                        trackingUrl
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
        const order = orders.find(order => order.orderNumber === orderNumber);

        if (!order) {
            return "⚠️ Sipariş bulunamadı.";
        }

        let orderDetails = `🆔 **Sipariş No:** ${order.orderNumber}\n`;
        orderDetails += `🔹 **Durum:** ${translateStatus(order.status)}\n`;
        orderDetails += `📅 **Sipariş Tarihi:** ${order.createdAt || "Bilinmiyor"}\n`;
        orderDetails += `💰 **Toplam Fiyat:** ${order.totalFinalPrice} ${order.currencyCode}\n\n`;
        orderDetails += `📦 **Ürünler**:\n`;

        order.orderLineItems.forEach(item => {
            orderDetails += `📌 **Ürün:** ${item.variant.name}\n`;
            orderDetails += `🖼️ **Görsel:** https://cdn.myikas.com/${item.variant.mainImageId}\n`;
            orderDetails += `🔢 **Adet:** ${item.quantity}\n`;
            orderDetails += `💵 **Birim Fiyat:** ${item.finalPrice} ${order.currencyCode}\n\n`;
        });

        // Kargoya verildiyse kargo takip butonu ekle
        if (order.status === "SHIPPED" && order.shipping.trackingUrl) {
            orderDetails += `🚚 **Kargoyu Takip Et:** [Kargo Takip Linki](${order.shipping.trackingUrl})\n`;
        }

        return orderDetails;
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        return "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.";
    }
}

// ✅ **9. Kargo Takip URL'sini Getirme**
async function getTrackingUrl(orderNumber) {
    const token = await getAccessToken();
    if (!token) {
        return "⚠️ Sipariş bilgilerinize ulaşılamıyor.";
    }

    const query = {
        query: `
        query {
            listOrder {
                data {
                    orderNumber
                    shipping {
                        trackingUrl
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
        const order = orders.find(order => order.orderNumber === orderNumber);

        if (!order || !order.shipping.trackingUrl) {
            return "⚠️ Kargo takip linki bulunamadı.";
        }

        return order.shipping.trackingUrl;
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        return "⚠️ Kargo bilgilerinize ulaşırken hata oluştu.";
    }
}

// ✅ **10. Sipariş Durumlarını Türkçeye Çevir**
function translateStatus(status) {
    const statusMap = {
        "PENDING": "Beklemede",
        "PROCESSING": "Hazırlanıyor",
        "SHIPPED": "Kargoya Verildi",
        "DELIVERED": "Teslim Edildi",
        "CANCELLED": "İptal Edildi",
        "RETURNED": "İade Edildi",
        "FAILED": "Başarısız"
    };
    return statusMap[status] || status;
}

// **Sunucuyu Başlat**
app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});