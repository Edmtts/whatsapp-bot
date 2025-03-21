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
    "canceled": "İptal edildi"
    // Gerekirse diğer durumlar eklenebilir
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
      
      // Debug: Gelen mesaj verisini loglayın
      console.log("Gelen mesaj verisi:", JSON.stringify(messageData, null, 2));
      
      let buttonId = "";
      let buttonTitle = "";
      // Eğer buton yanıtı varsa; id ve title'ı alıyoruz.
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
      console.log(`📩 Gelen: id="${buttonId}", title="${buttonTitle}" (Gönderen: ${from})`);

      // Eğer sipariş numarası girişi bekleniyorsa
      if (userStates[from].awaitingOrderNumber) {
        const orderNumber = buttonTitle; // Kullanıcının girdiği sipariş numarası
        const order = await getOrderByOrderNumber(orderNumber);
        if (order) {
          sendOrderInteractiveMessage(from, order);
          userStates[from].awaitingOrderNumber = false;
        } else {
          sendWhatsAppMessage(from, "Belirttiğiniz sipariş numarasına ait sipariş bulunamadı. Lütfen tekrar deneyiniz.");
        }
        return res.sendStatus(200);
      }
      
      // Eğer ana menü henüz gösterilmediyse
      if (!userStates[from].mainMenuShown) {
        sendWhatsAppInteractiveMessage(from);
        userStates[from].mainMenuShown = true;
        return res.sendStatus(200);
      }
      
      // Öncelikle buton id üzerinden kontrol edelim (eğer varsa)
      if (buttonId) {
        if (buttonId === "siparislerim") {
          const orders = await getOrdersByPhone(from);
          if (typeof orders === 'string' || orders.length === 0) {
            sendWhatsAppMessage(from, "Telefon numaranıza kayıtlı sipariş yok, sipariş numaranızı girerek kontrol sağlayabiliriz.");
            userStates[from].awaitingOrderNumber = true;
          } else {
            orders.forEach(order => {
              sendOrderInteractiveMessage(from, order);
            });
          }
        } else if (buttonId === "siparisim_nerede") {
          sendWhatsAppMessage(from, "Siparişinizin nerede olduğunu gösteren detaylı bilgi burada olacak.");
        } else if (buttonId === "iade_iptal") {
          sendWhatsAppMessage(from, "İade ve iptal işlemleriyle ilgili bilgi burada olacak.");
        }
        else if (buttonId === "kargo_takip") {
          const orderNumber = userStates[from].currentOrder;
          if (orderNumber) {
            sendTrackingInfoMessage(from, orderNumber);
          } else {
            sendWhatsAppMessage(from, "Lütfen önce siparişinizi seçiniz.");
          }
        } else if (buttonId === "siparis_durumu") {
          const orderNumber = userStates[from].currentOrder;
          if (orderNumber) {
            sendOrderStatusMessage(from, orderNumber);
          } else {
            sendWhatsAppMessage(from, "Lütfen önce siparişinizi seçiniz.");
          }
        } else if (buttonId === "iade") {
          const orderNumber = userStates[from].currentOrder;
          if (orderNumber) {
            sendReturnConfirmationMessage(from, orderNumber);
          } else {
            sendWhatsAppMessage(from, "Lütfen önce siparişinizi seçiniz.");
          }
        } else if (buttonId === "onayliyorum") {
          const orderNumber = userStates[from].currentOrder;
          if (orderNumber) {
            initiateReturnRequest(from, orderNumber);
          } else {
            sendWhatsAppMessage(from, "Sipariş bilgisi bulunamadı.");
          }
        } else if (buttonId === "vazgec") {
          sendWhatsAppInteractiveMessage(from);
        } else if (buttonId === "baska bir sorum var") {
          sendCustomerServiceMessage(from);
        } else if (buttonId.startsWith("order_detail_")) {
          // Buton id'si "order_detail_<orderNumber>" şeklinde geliyor.
          const orderNumber = buttonId.replace("order_detail_", "");
          userStates[from].currentOrder = orderNumber;
          sendOrderDetailInteractiveMenu(from, orderNumber);
        } else {
          sendWhatsAppMessage(from, "Lütfen menüdeki butonlardan birini seçiniz.");
        }
      }
      // Eğer id yoksa, buton title üzerinden kontrol edelim (bu genellikle metinle yazılırsa çalışır)
      else {
        if (buttonTitle === "siparişlerim") {
          const orders = await getOrdersByPhone(from);
          if (typeof orders === 'string' || orders.length === 0) {
            sendWhatsAppMessage(from, "Telefon numaranıza kayıtlı sipariş yok, sipariş numaranızı girerek kontrol sağlayabiliriz.");
            userStates[from].awaitingOrderNumber = true;
          } else {
            orders.forEach(order => {
              sendOrderInteractiveMessage(from, order);
            });
          }
        } else if (buttonTitle === "siparişim nerede?") {
          sendWhatsAppMessage(from, "Siparişinizin nerede olduğunu gösteren detaylı bilgi burada olacak.");
        } else if (buttonTitle === "iade ve iptal") {
          sendWhatsAppMessage(from, "İade ve iptal işlemleriyle ilgili bilgi burada olacak.");
        } else {
          sendWhatsAppMessage(from, "Lütfen menüdeki butonlardan birini seçiniz.");
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook işleme hatası:", error);
    res.sendStatus(500);
  }
});

// ANA MENÜ – Interaktif mesaj gönderimi
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
          { type: "reply", reply: { id: "siparislerim", title: "Siparişlerim" } },
          { type: "reply", reply: { id: "siparisim_nerede", title: "Siparişim Nerede?" } },
          { type: "reply", reply: { id: "iade_iptal", title: "İade ve İptal" } }
        ]
      }
    }
  };
  try {
    const response = await axios.post(url, data, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log("✅ Ana menü mesajı gönderildi:", response.data);
  } catch (error) {
    console.error("❌ Ana menü mesajı gönderme hatası:", error.response ? error.response.data : error.message);
  }
}

// IKAS API – Access Token alma
async function getAccessToken() {
  try {
    const response = await axios.post(
      IKAS_API_TOKEN_URL,
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

// IKAS API – Telefon numarasına göre sipariş sorgulama (orderItems ekleniyor)
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

// IKAS API – Sipariş numarasına göre tek sipariş sorgulama (orderItems ekleniyor)
async function getOrderByOrderNumber(orderNumber) {
  const token = await getAccessToken();
  if (!token) return null;
  const query = {
    query: `
      query ($orderNumber: String!) {
        order(orderNumber: $orderNumber) {
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
      }`,
    variables: { orderNumber }
  };
  try {
    const response = await axios.post(IKAS_API_GRAPHQL_URL, query, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
    return response.data.data.order;
  } catch (error) {
    console.error("❌ IKAS API (order by orderNumber) hata:", error.response ? error.response.data : error.message);
    return null;
  }
}

// Her sipariş için interaktif mesaj gönderimi (sipariş detayı)
async function sendOrderInteractiveMessage(to, order) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "Bilinmiyor";
  const status = translateStatus(order.status || "Bilinmiyor");
  const productName =
    order.orderItems && order.orderItems.length > 0 && order.orderItems[0].product && order.orderItems[0].product.name
      ? order.orderItems[0].product.name
      : "Ürün bilgisi yok";
  const bodyText = `Sipariş No: ${order.orderNumber}\nSipariş Tarihi: ${orderDate}\nDurumu: ${status}\nÜrün: ${productName}\nFiyat: ${order.totalFinalPrice} ${order.currencyCode}`;
  
  // Seçilen sipariş numarasını state'e kaydediyoruz.
  userStates[to].currentOrder = order.orderNumber;
  
  // Eğer resim URL'si varsa header eklenir; yoksa header eklenmez.
  const imageUrl = ""; // Geçerli bir URL varsa buraya ekleyin
  const interactiveObj = {
    type: "button",
    body: { text: bodyText },
    action: {
      buttons: [
        { type: "reply", reply: { id: `order_detail_${order.orderNumber}`, title: "Bu Siparişi İncele" } }
      ]
    }
  };
  if (imageUrl && imageUrl.trim() !== "") {
    interactiveObj.header = { type: "image", image: { link: imageUrl } };
  }
  
  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: interactiveObj
  };
  try {
    const response = await axios.post(url, data, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log(`✅ Sipariş ${order.orderNumber} için interaktif mesaj gönderildi:`, response.data);
  } catch (error) {
    console.error(`❌ Sipariş ${order.orderNumber} için interaktif mesaj gönderme hatası:`, error.response ? error.response.data : error.message);
  }
}

// Sipariş detay menüsü: "Bu siparişi hakkında ne yapmak istiyorsun?"
async function sendOrderDetailInteractiveMenu(to, orderNumber) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Bu siparişi hakkında ne yapmak istiyorsun?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "kargo_takip", title: "Kargo takip no" } },
          { type: "reply", reply: { id: "siparis_durumu", title: "Sipariş durumu" } },
          { type: "reply", reply: { id: "iade", title: "İade" } }
        ]
      }
    }
  };
  try {
    const response = await axios.post(url, data, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log(`✅ Sipariş ${orderNumber} detay interaktif mesaj gönderildi:`, response.data);
  } catch (error) {
    console.error(`❌ Sipariş ${orderNumber} detay interaktif mesaj gönderme hatası:`, error.response ? error.response.data : error.message);
  }
}

// Kargo takip no: İlgili siparişin kargo takip bilgisini gösterir.
async function sendTrackingInfoMessage(to, orderNumber) {
  const trackingInfo = await getTrackingInfo(orderNumber);
  const baseMessage = `Sipariş ${orderNumber} nolu takip kodun üzerinden takip edebilirsin: ${trackingInfo.trackingCode}`;
  if (trackingInfo.delivered && trackingInfo.trackingUrl) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: baseMessage },
        action: {
          buttons: [
            { type: "url", url: { title: "Takip Et", url: trackingInfo.trackingUrl } }
          ]
        }
      }
    };
    try {
      const response = await axios.post(url, data, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
      });
      console.log(`✅ Sipariş ${orderNumber} kargo takip mesajı gönderildi:`, response.data);
    } catch (error) {
      console.error(`❌ Sipariş ${orderNumber} kargo takip mesajı gönderme hatası:`, error.response ? error.response.data : error.message);
    }
  } else {
    sendWhatsAppMessage(to, baseMessage);
  }
}

// Sipariş durumu: "kargoda" bilgisi ve takip butonu.
async function sendOrderStatusMessage(to, orderNumber) {
  const trackingInfo = await getTrackingInfo(orderNumber);
  const baseMessage = `Sipariş ${orderNumber} nolu ürün "${translateStatus(trackingInfo.status)}" görünmektedir.\nKargo firması: ${trackingInfo.carrierName}, takip no: ${trackingInfo.trackingCode}`;
  if (trackingInfo.delivered && trackingInfo.trackingUrl) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: baseMessage },
        action: {
          buttons: [
            { type: "url", url: { title: "Takip Et", url: trackingInfo.trackingUrl } }
          ]
        }
      }
    };
    try {
      const response = await axios.post(url, data, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
      });
      console.log(`✅ Sipariş ${orderNumber} durum mesajı gönderildi:`, response.data);
    } catch (error) {
      console.error(`❌ Sipariş ${orderNumber} durum mesajı gönderme hatası:`, error.response ? error.response.data : error.message);
    }
  } else {
    sendWhatsAppMessage(to, baseMessage);
  }
}

// İade: Sipariş "teslim edildi" ise onay mesajı gönder, aksi halde uyarı.
async function sendReturnConfirmationMessage(to, orderNumber) {
  const orderDetails = await getTrackingInfo(orderNumber);
  if (orderDetails.status !== "delivered") {
    sendWhatsAppMessage(
      to,
      `Not: Sipariş ${orderNumber} nolu ürün "${translateStatus(orderDetails.status)}" aşamasında olduğu için iade başlatılamaz. Teslim edildikten 14 gün içerisinde iade talebinde bulunabilirsiniz.`
    );
    return;
  }
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: `Sipariş ${orderNumber} nolu ürün için iade talebi oluşturduğunu onaylıyor musun?` },
      action: {
        buttons: [
          { type: "reply", reply: { id: "onayliyorum", title: "Onaylıyorum" } },
          { type: "reply", reply: { id: "vazgec", title: "Vazgeç" } },
          { type: "reply", reply: { id: "baska bir sorum var", title: "Başka bir sorum var" } }
        ]
      }
    }
  };
  try {
    const response = await axios.post(url, data, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log(`✅ İade onay mesajı gönderildi for order ${orderNumber}:`, response.data);
  } catch (error) {
    console.error(`❌ İade onay mesajı gönderme hatası for order ${orderNumber}:`, error.response ? error.response.data : error.message);
  }
}

// İade Onay: API çağrısı simülasyonu
async function initiateReturnRequest(to, orderNumber) {
  console.log(`API üzerinden iade talebi başlatılıyor: Order ${orderNumber}`);
  sendWhatsAppMessage(to, `Sipariş ${orderNumber} nolu ürün için iade talebiniz oluşturulmuştur.`);
}

// Müşteri temsilcisine bağlanma mesajı
function sendCustomerServiceMessage(to) {
  sendWhatsAppMessage(to, "Müşteri temsilcisine bağlanılıyor... Lütfen bekleyiniz.");
}

// Düz metin mesajı gönderme
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
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log("✅ Mesaj gönderildi:", response.data);
  } catch (error) {
    console.error("❌ WhatsApp mesaj gönderme hatası:", error.response ? error.response.data : error.message);
  }
}

// Simülasyon: Kargo takip bilgilerini döndüren fonksiyon
async function getTrackingInfo(orderNumber) {
  // Burada gerçek API'den gelen statü "delivered" vs. yerine örnek değerler döndürüyoruz.
  return {
    trackingCode: "ABC123",
    trackingUrl: "https://tracking.example.com/ABC123",
    delivered: true,
    carrierName: "XYZ Kargo",
    status: "delivered" // API'den gelen değer, çeviri fonksiyonuyla Türkçeye çevrilecek.
  };
}

app.listen(port, () => {
  console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});
