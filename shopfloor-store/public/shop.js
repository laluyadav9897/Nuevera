const grid = document.getElementById("grid");
const emptyEl = document.getElementById("empty");

let currentOrderId = localStorage.getItem("lastOrderId") || null;
let selectedProduct = null;
const socket = io();

function fmt(price) {
  return "₹" + Number(price).toLocaleString("en-IN");
}

async function loadProducts() {
  const res = await fetch("/api/products");
  const products = await res.json();
  grid.innerHTML = "";
  if (products.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  for (const p of products) {
    const card = document.createElement("div");
    card.className = "tag-card";
    card.innerHTML = `
      <div class="sku mono">${p.sku || ""}</div>
      <div class="thumb"><img src="${p.image}" alt="${p.name}" /></div>
      <h3>${escapeHtml(p.name)}</h3>
      <p class="desc">${escapeHtml(p.description || "")}</p>
      <div class="price-row">
        <span class="price">${fmt(p.price)}</span>
        <button class="btn" data-id="${p.id}">Buy now</button>
      </div>
    `;
    card.querySelector("button").addEventListener("click", () => openBuyModal(p));
    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Buy now modal ----------
const buyOverlay = document.getElementById("buyOverlay");
const buyForm = document.getElementById("buyForm");
const buySub = document.getElementById("buySub");

function openBuyModal(product) {
  selectedProduct = product;
  buySub.textContent = `${product.name} — ${fmt(product.price)}`;
  buyOverlay.classList.remove("hidden");
}
document.getElementById("cancelBuy").addEventListener("click", () => {
  buyOverlay.classList.add("hidden");
});

buyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    productId: selectedProduct.id,
    customerName: document.getElementById("custName").value.trim(),
    phone: document.getElementById("custPhone").value.trim(),
    address: document.getElementById("custAddress").value.trim(),
  };
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    alert("Could not place the order. Please try again.");
    return;
  }
  const order = await res.json();
  currentOrderId = order.id;
  localStorage.setItem("lastOrderId", order.id);
  buyOverlay.classList.add("hidden");
  buyForm.reset();
  openChat(order.id);
});

// ---------- Chat ----------
const chatFab = document.getElementById("chatFab");
const chatPanel = document.getElementById("chatPanel");
const chatBody = document.getElementById("chatBody");
const chatOrderIdEl = document.getElementById("chatOrderId");
const chatText = document.getElementById("chatText");

async function openChat(orderId) {
  currentOrderId = orderId;
  chatOrderIdEl.textContent = "order " + orderId;
  chatFab.classList.remove("hidden");
  chatPanel.classList.remove("hidden");
  socket.emit("join order", orderId);
  const res = await fetch(`/api/orders/${orderId}/messages`);
  if (!res.ok) return;
  const { messages } = await res.json();
  chatBody.innerHTML = "";
  messages.forEach(renderMessage);
  scrollChatToBottom();
}

function renderMessage(msg) {
  const div = document.createElement("div");
  div.className = "msg " + msg.sender;
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  div.innerHTML = `${escapeHtml(msg.text)}<span class="meta">${msg.sender === "customer" ? "you" : msg.sender} · ${time}</span>`;
  chatBody.appendChild(div);
}

function scrollChatToBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

chatFab.addEventListener("click", () => {
  if (currentOrderId) openChat(currentOrderId);
});
document.getElementById("closeChat").addEventListener("click", () => {
  chatPanel.classList.add("hidden");
});

document.getElementById("chatSend").addEventListener("click", sendChat);
chatText.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

function sendChat() {
  const text = chatText.value.trim();
  if (!text || !currentOrderId) return;
  socket.emit("chat message", { orderId: currentOrderId, sender: "customer", text });
  chatText.value = "";
}

socket.on("chat message", (msg) => {
  if (msg.orderId !== currentOrderId) return;
  renderMessage(msg);
  scrollChatToBottom();
});

// If the visitor already has an order from this browser, let them reopen the chat.
if (currentOrderId) {
  chatFab.classList.remove("hidden");
}

loadProducts();
