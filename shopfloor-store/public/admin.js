let token = sessionStorage.getItem("adminToken") || null;
let socket = null;
let selectedOrderId = null;
let orders = [];

const loginScreen = document.getElementById("loginScreen");
const dashboard = document.getElementById("dashboard");

function fmt(price) {
  return "₹" + Number(price).toLocaleString("en-IN");
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------- Login ----------
document.getElementById("loginBtn").addEventListener("click", login);
document.getElementById("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});

async function login() {
  const password = document.getElementById("loginPassword").value;
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const errEl = document.getElementById("loginError");
  if (!res.ok) {
    errEl.textContent = "That password isn't right.";
    errEl.classList.remove("hidden");
    return;
  }
  const data = await res.json();
  token = data.token;
  sessionStorage.setItem("adminToken", token);
  enterDashboard();
}

function enterDashboard() {
  loginScreen.classList.add("hidden");
  dashboard.classList.remove("hidden");
  connectSocket();
  loadProducts();
  loadOrders();
}

function connectSocket() {
  socket = io();
  socket.emit("join admin", token);
  socket.on("new order", (order) => {
    orders.unshift(order);
    renderOrders();
  });
  socket.on("chat message", (msg) => {
    if (msg.orderId === selectedOrderId) {
      appendThreadMessage(msg);
    }
  });
}

if (token) enterDashboard();

// ---------- Products ----------
async function loadProducts() {
  const res = await fetch("/api/products");
  const products = await res.json();
  const list = document.getElementById("productList");
  list.innerHTML = "";
  if (products.length === 0) {
    list.innerHTML = '<div class="empty">No products yet.</div>';
    return;
  }
  products.forEach((p) => {
    const row = document.createElement("div");
    row.className = "prod-list-row";
    row.innerHTML = `
      <div class="prod-list-left">
        <img src="${p.image}" alt="" />
        <div>
          <div style="font-weight:600;font-size:13.5px;">${escapeHtml(p.name)}</div>
          <div class="mono" style="font-size:12px;color:var(--ink-soft);">${fmt(p.price)}</div>
        </div>
      </div>
      <button class="btn danger" data-id="${p.id}" style="font-size:11px;padding:6px 10px;">Remove</button>
    `;
    row.querySelector("button").addEventListener("click", () => deleteProduct(p.id));
    list.appendChild(row);
  });
}

document.getElementById("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append("name", document.getElementById("pName").value.trim());
  fd.append("price", document.getElementById("pPrice").value);
  fd.append("sku", document.getElementById("pSku").value.trim());
  fd.append("description", document.getElementById("pDesc").value.trim());
  const fileInput = document.getElementById("pImage");
  if (fileInput.files[0]) fd.append("image", fileInput.files[0]);

  const res = await fetch("/api/admin/products", {
    method: "POST",
    headers: { "x-admin-token": token },
    body: fd,
  });
  if (!res.ok) {
    alert("Could not upload the product.");
    return;
  }
  e.target.reset();
  loadProducts();
});

async function deleteProduct(id) {
  if (!confirm("Remove this product from the store?")) return;
  await fetch(`/api/admin/products/${id}`, {
    method: "DELETE",
    headers: { "x-admin-token": token },
  });
  loadProducts();
}

// ---------- Orders ----------
async function loadOrders() {
  const res = await fetch("/api/admin/orders", { headers: { "x-admin-token": token } });
  orders = await res.json();
  renderOrders();
}

function renderOrders() {
  const list = document.getElementById("orderList");
  list.innerHTML = "";
  if (orders.length === 0) {
    list.innerHTML = '<div class="empty">No orders yet.</div>';
    return;
  }
  orders.forEach((o) => {
    const row = document.createElement("div");
    row.className = "order-row" + (o.id === selectedOrderId ? " active" : "");
    row.innerHTML = `
      <div>
        <div class="name">${escapeHtml(o.customerName)}</div>
        <div class="sub">${escapeHtml(o.productName)} · ${fmt(o.productPrice)}</div>
      </div>
      <div class="mono sub">${o.id}</div>
    `;
    row.addEventListener("click", () => selectOrder(o.id));
    list.appendChild(row);
  });
}

async function selectOrder(orderId) {
  selectedOrderId = orderId;
  renderOrders();
  document.getElementById("noOrderSelected").classList.add("hidden");
  const thread = document.getElementById("thread");
  thread.classList.remove("hidden");

  const res = await fetch(`/api/orders/${orderId}/messages`);
  const { order, messages } = await res.json();
  document.getElementById("threadCustomer").textContent = order.customerName;
  document.getElementById("threadDetails").innerHTML =
    `${escapeHtml(order.phone)}<br>${escapeHtml(order.address)}<br>${escapeHtml(order.productName)} — ${fmt(order.productPrice)}`;

  const body = document.getElementById("threadBody");
  body.innerHTML = "";
  messages.forEach(appendThreadMessage);

  socket.emit("join order", orderId);
}

function appendThreadMessage(msg) {
  if (msg.orderId !== selectedOrderId) return;
  const body = document.getElementById("threadBody");
  const div = document.createElement("div");
  div.className = "msg " + msg.sender;
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  div.innerHTML = `${escapeHtml(msg.text)}<span class="meta">${msg.sender} · ${time}</span>`;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

document.getElementById("threadSend").addEventListener("click", sendReply);
document.getElementById("threadText").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendReply();
});

function sendReply() {
  const input = document.getElementById("threadText");
  const text = input.value.trim();
  if (!text || !selectedOrderId) return;
  socket.emit("chat message", { orderId: selectedOrderId, sender: "admin", text, token });
  input.value = "";
}
