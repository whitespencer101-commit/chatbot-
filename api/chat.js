const MODEL = "gemini-flash-latest";

// ===== EDIT YOUR VERIFIED BUSINESS DATA =====
const BUSINESS = {
  name: "Lagos Fresh Fashion",
  agent: "Amaka",
  whatsapp: "2347016706259", // your number, format 234XXXXXXXXXX (no leading 0)
  location: "Lagos, Nigeria",
  hours: "Mon-Sat, 9am-6pm",
  delivery: "Lagos: 1-2 days. Other states: 3-5 days. Delivery fee is confirmed by the owner.",
  payment: "Pay on delivery in Lagos, or bank transfer. The owner confirms payment, not this chat.",
  returns: "7-day exchange policy."
};
const PRODUCTS = [
  { id: "p1", category: "Tops", name: "Ankara Shirt", price: 18000, stock: 25, sizes: ["S", "M", "L", "XL", "XXL"], desc: "Cotton Ankara, 6 prints.", video: false },
  { id: "p2", category: "Footwear", name: "Leather Slides", price: 12500, stock: 10, sizes: ["39", "40", "41", "42", "43", "44", "45"], desc: "Handmade leather, 3 colours.", video: false },
  { id: "v1", category: "Traditional", name: "Agbada Set", price: 65000, stock: 4, sizes: ["M", "L", "XL", "XXL"], desc: "3-piece embroidered set.", video: true }
];
const FAQS = [
  { q: "Where are you located?", a: "We are in Lagos." },
  { q: "Do you deliver outside Lagos?", a: "Yes, 3-5 days to other states." },
  { q: "Can I exchange an item?", a: "Yes, within 7 days." }
];
// ============================================

const naira = n => "₦" + n.toLocaleString("en-NG");

const SYSTEM = `You are ${BUSINESS.agent}, a friendly sales rep for ${BUSINESS.name}. Chat like a real person on WhatsApp: warm, natural, light Nigerian-friendly tone, max one emoji. Match the customer's language (English, Pidgin, etc.). If sincerely asked, say you are an AI assistant.

VERIFIED SHOP DATA (the only source for shop facts):
Location: ${BUSINESS.location}. Hours: ${BUSINESS.hours}.
Products: ${PRODUCTS.map(p => `${p.id}: ${p.name} [${p.category}], ${naira(p.price)}, stock ${p.stock}, sizes ${p.sizes.join("/")}, ${p.desc}${p.video ? " (has video)" : ""}`).join(" | ")}
Delivery: ${BUSINESS.delivery}
Payment: ${BUSINESS.payment}
Returns: ${BUSINESS.returns}
FAQs: ${FAQS.map(f => `Q: ${f.q} A: ${f.a}`).join(" | ")}

HOW TO ANSWER:
1. Answer EVERY question the customer asks, in the order asked. If a message has several questions, answer all of them in one reply. Never ignore a question.
2. Shop facts (prices, stock, sizes, colours, delivery, payment, location, hours, policies) must come ONLY from VERIFIED SHOP DATA. Never invent or guess them. If the answer is not there, say honestly that you are not sure and that the owner can confirm, and use action handoff. Still answer the other parts of the message.
3. General questions (style advice, sizing tips, fabric or leather care, what to wear for an occasion, etc.) answer helpfully from general knowledge, and connect to our products when it fits. Never claim a product has a feature that is not in VERIFIED SHOP DATA.
4. Unrelated questions: give a short helpful answer, then gently steer back to shopping. Do not answer harmful or illegal requests.
5. Keep replies short and clear: usually 1-4 short sentences. Use more only when several questions need it. Ask at most one question back, at the end.
6. If the customer mentions a category (like footwear or tops), tell them what we have in it with prices, and send one photo.
7. Never say an order is confirmed or paid. You only prepare an order request; the owner confirms it.
8. To prepare an order, collect: product, size, quantity, full name, phone, delivery address. Ask for one missing detail at a time. Use order_request only when ALL are collected and the customer agrees.
9. Use handoff if the customer asks for a human, complains, wants a discount, custom order, or you cannot answer from VERIFIED SHOP DATA.
10. Use capture_lead when you get the customer's name and phone but they are not ordering yet.
11. Send media only when it helps (max 1 per reply). Video only for products marked "has video".

Reply with ONLY one valid JSON object, no markdown:
{"reply":"text","send_media":[{"type":"img or vid","product_id":"p1"}],"action":{"type":"none|capture_lead|order_request|handoff","product_id":"","size":"","quantity":1,"name":"","phone":"","address":"","reason":""}}`;

function validateOrder(a) {
  const p = PRODUCTS.find(x => x.id === a.product_id);
  if (!p) return { error: "Which item would you like to order?" };
  if (p.stock < 1) return { error: `Sorry, ${p.name} is out of stock right now.` };
  const max = Math.min(p.stock, 20);
  const qty = parseInt(a.quantity, 10);
  if (!(qty >= 1 && qty <= max)) return { error: `How many would you like? I can take up to ${max}.` };
  const size = String(a.size || "").toUpperCase();
  if (p.sizes.length && !p.sizes.includes(size)) return { error: `Which size would you like? Available: ${p.sizes.join(", ")}.` };
  const name = String(a.name || "").trim().slice(0, 80);
  if (name.length < 2) return { error: "May I have your full name?" };
  const phone = String(a.phone || "").replace(/[\s-]/g, "");
  if (!/^(\+?234|0)[789][01]\d{8}$/.test(phone)) return { error: "Please send a valid Nigerian phone number, like 0803 123 4567." };
  const address = String(a.address || "").trim().slice(0, 200);
  if (address.length < 8) return { error: "What is your full delivery address?" };
  const total = p.price * qty;
  const summary =
    `NEW ORDER REQUEST (not yet confirmed)\n` +
    `Item: ${p.name} (${size || "no size"}) x${qty}\n` +
    `Total: ${naira(total)} (delivery fee to be confirmed)\n` +
    `Name: ${name}\nPhone: ${phone}\nAddress: ${address}`;
  return { ok: true, summary, total };
}

const waLink = text => `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(text)}`;

// Turn the model's text into an object, even if it is damaged or cut off
function parseModel(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  const m = cleaned.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
  let txt = "Sorry, could you say that again?";
  if (m) { try { txt = JSON.parse('"' + m[1] + '"'); } catch { txt = m[1]; } }
  return { reply: txt, send_media: [], action: { type: "none" } };
}

async function askGemini(contents) {
  const call = () => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.API_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents,
        generationConfig: {
          maxOutputTokens: 2000,
          temperature: 0.7,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    }
  );
  let r = await call();
  if (r.status === 429 || r.status >= 500) {
    await new Promise(s => setTimeout(s, 1200));
    r = await call();
  }
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; } catch {}

  const contents = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-20)
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content.slice(0, 1000) }] }));
  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return res.status(400).json({ error: "no messages" });
  }

  try {
    const data = await askGemini(contents);
    const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("");
    if (!raw) {
      console.error("PROVIDER_ERROR", JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: data.error?.message || "provider error" });
    }

    const out = parseModel(raw);
    const result = {
      reply: String(out.reply || "").slice(0, 1200),
      media: [],
      order: null,
      handoff: null
    };

    // validate media against the catalogue
    for (const m of (Array.isArray(out.send_media) ? out.send_media : []).slice(0, 1)) {
      const p = PRODUCTS.find(x => x.id === m.product_id);
      if (p && (m.type === "img" || (m.type === "vid" && p.video))) result.media.push({ type: m.type, id: p.id });
    }

    // validate the AI's proposed action against business rules
    const a = out.action || {};
    if (a.type === "order_request") {
      const v = validateOrder(a);
      if (v.ok) {
        result.order = { summary: v.summary, link: waLink(v.summary), total: v.total };
        console.log("ORDER_REQUEST", JSON.stringify({ t: new Date().toISOString(), summary: v.summary }));
      } else {
        result.reply = v.error;
        result.media = [];
      }
    } else if (a.type === "capture_lead") {
      console.log("LEAD", JSON.stringify({ t: new Date().toISOString(), name: String(a.name || "").slice(0, 80), phone: String(a.phone || "").slice(0, 20) }));
    } else if (a.type === "handoff") {
      const txt = `Hello ${BUSINESS.name}, I need help from a person. ${String(a.reason || "").slice(0, 150)}`;
      result.handoff = { link: waLink(txt) };
      console.log("HANDOFF", JSON.stringify({ t: new Date().toISOString(), reason: String(a.reason || "").slice(0, 150) }));
    }

    if (!result.reply && !result.order) result.reply = "Sorry, could you say that again?";
    return res.status(200).json(result);
  } catch (e) {
    console.error("CHAT_ERROR", e);
    return res.status(500).json({ error: "server error" });
  }
}
