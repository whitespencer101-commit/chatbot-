const MODEL = "gemini-flash-latest";

// ===== EDIT YOUR VERIFIED BUSINESS DATA =====
const BUSINESS = {
  name: "Lagos Fresh Fashion",
  agent: "Amaka",
  whatsapp: "2348000000000", // your number, format 234XXXXXXXXXX
  delivery: "Lagos: 1-2 days. Other states: 3-5 days.",
  payment: "Pay on delivery in Lagos, or bank transfer. The owner confirms payment, not this chat.",
  returns: "7-day exchange policy."
};
const PRODUCTS = [
  { id: "p1", name: "Ankara Shirt", price: 18000, stock: 25, sizes: ["S", "M", "L", "XL", "XXL"], desc: "Cotton Ankara, 6 prints.", video: false },
  { id: "p2", name: "Leather Slides", price: 12500, stock: 10, sizes: ["39", "40", "41", "42", "43", "44", "45"], desc: "Handmade leather, 3 colours.", video: false },
  { id: "v1", name: "Agbada Set", price: 65000, stock: 4, sizes: ["M", "L", "XL", "XXL"], desc: "3-piece embroidered set.", video: true }
];
const FAQS = [
  { q: "Where are you located?", a: "We are in Lagos." },
  { q: "Do you deliver outside Lagos?", a: "Yes, 3-5 days to other states." }
];
// ============================================

const naira = n => "₦" + n.toLocaleString("en-NG");

const SYSTEM = `You are ${BUSINESS.agent}, a friendly sales rep for ${BUSINESS.name}. Chat like a real person on WhatsApp: 1-3 short sentences, warm, light Nigerian-friendly tone, max one emoji, one question at a time. If sincerely asked, say you are an AI assistant.

VERIFIED DATA (the only source of truth):
Products: ${PRODUCTS.map(p => `${p.id}: ${p.name}, ${naira(p.price)}, stock ${p.stock}, sizes ${p.sizes.join("/")}, ${p.desc}${p.video ? " (has video)" : ""}`).join(" | ")}
Delivery: ${BUSINESS.delivery}
Payment: ${BUSINESS.payment}
Returns: ${BUSINESS.returns}
FAQs: ${FAQS.map(f => `Q: ${f.q} A: ${f.a}`).join(" | ")}

RULES:
- Never invent prices, stock, discounts, delivery times, payment status or order confirmations. If something is not in VERIFIED DATA, say you will check and set action handoff.
- Never say an order is confirmed or paid. You only prepare an order request; the owner confirms it.
- Goal: understand the need, recommend, handle objections, then collect for an order: product, size, quantity, full name, phone, delivery address. Ask one thing at a time.
- Use order_request only when ALL fields are collected and the customer agrees to place it.
- Use handoff if the customer asks for a human, complains, wants a discount or custom order, or you cannot answer from VERIFIED DATA.
- Use capture_lead when you get the customer's name and phone but they are not ordering yet.
- Send media only when it helps (max 1 per reply). Video only for products marked "has video".

Reply with ONLY valid JSON, no markdown:
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const contents = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-20)
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content.slice(0, 1000) }] }));
  if (!contents.length) return res.status(400).json({ error: "no messages" });

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { maxOutputTokens: 600, responseMimeType: "application/json" }
        })
      }
    );
    const data = await r.json();
    const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text).join("");
    if (!raw) return res.status(502).json({ error: data.error?.message || "provider error" });

    let out;
    try { out = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
    catch { out = { reply: raw, send_media: [], action: { type: "none" } }; }

    const result = { reply: String(out.reply || "").slice(0, 800), media: [], order: null, handoff: null };

    // validate media
    for (const m of (out.send_media || []).slice(0, 1)) {
      const p = PRODUCTS.find(x => x.id === m.product_id);
      if (p && (m.type === "img" || (m.type === "vid" && p.video))) result.media.push({ type: m.type, id: p.id });
    }

    // validate action
    const a = out.action || {};
    if (a.type === "order_request") {
      const v = validateOrder(a);
      if (v.ok) {
        result.order = { summary: v.summary, link: waLink(v.summary), total: v.total };
        console.log("ORDER_REQUEST", JSON.stringify({ t: new Date().toISOString(), summary: v.summary }));
      } else {
        result.reply = v.error; // AI proposal rejected by business rules
      }
    } else if (a.type === "capture_lead") {
      console.log("LEAD", JSON.stringify({ t: new Date().toISOString(), name: String(a.name || "").slice(0, 80), phone: String(a.phone || "").slice(0, 20) }));
    } else if (a.type === "handoff") {
      const txt = `Hello ${BUSINESS.name}, I need help from a person. ${String(a.reason || "").slice(0, 150)}`;
      result.handoff = { link: waLink(txt) };
      console.log("HANDOFF", JSON.stringify({ t: new Date().toISOString(), reason: String(a.reason || "").slice(0, 150) }));
    }

    return res.status(200).json(result);
  } catch (e) {
    console.error("CHAT_ERROR", e);
    return res.status(500).json({ error: "server error" });
  }
}