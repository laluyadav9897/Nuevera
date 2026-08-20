const express = require("express");
const multer = require("multer");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
// Change this before deploying anywhere real. This is a simple shared
// password for the seller/admin panel, not a real auth system.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_TOKEN = "seller-session-token"; // fixed token issued after a correct password

const DB_PATH = path.join(__dirname, "db.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ---------- Tiny JSON "database" ----------
function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ---------- App setup ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || "";
      cb(null, `${nanoid(10)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Not authorized." });
  }
  next();
}

// ---------- Admin auth ----------
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ token: ADMIN_TOKEN });
  }
  res.status(401).json({ error: "Wrong password." });
});

// ---------- Products ----------
app.get("/api/products", (req, res) => {
  const db = readDB();
  res.json(db.products);
});

app.post("/api/admin/products", requireAdmin, upload.single("image"), (req, res) => {
  const { name, price, description, sku } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: "Name and price are required." });
  }
  const db = readDB();
  const product = {
    id: nanoid(8),
    name,
    price: Number(price),
    description: description || "",
    sku: sku || "",
    image: req.file ? `/uploads/${req.file.filename}` : "/uploads/placeholder.svg",
    createdAt: new Date().toISOString(),
  };
  db.products.unshift(product);
  writeDB(db);
  res.status(201).json(product);
});

app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const db = readDB();
  db.products = db.products.filter((p) => p.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ---------- Orders ----------
app.post("/api/orders", (req, res) => {
  const { productId, customerName, phone, address } = req.body || {};
  if (!productId || !customerName || !phone || !address) {
    return res.status(400).json({ error: "Missing order details." });
  }
  const db = readDB();
  const product = db.products.find((p) => p.id === productId);
  if (!product) return res.status(404).json({ error: "Product not found." });

  const order = {
    id: nanoid(8),
    productId,
    productName: product.name,
    productPrice: product.price,
    customerName,
    phone,
    address,
    status: "placed",
    createdAt: new Date().toISOString(),
  };
  db.orders.unshift(order);

  const welcomeMsg = {
    id: nanoid(10),
    orderId: order.id,
    sender: "system",
    text: `Order placed for ${product.name} (₹${product.price}). Say hello below to sort out delivery details with the seller.`,
    createdAt: new Date().toISOString(),
  };
  db.messages.push(welcomeMsg);
  writeDB(db);

  io.to(`order:${order.id}`).emit("chat message", welcomeMsg);
  io.to("admin-room").emit("new order", order);

  res.status(201).json(order);
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.orders);
});

// ---------- Chat ----------
app.get("/api/orders/:id/messages", (req, res) => {
  const db = readDB();
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const messages = db.messages.filter((m) => m.orderId === req.params.id);
  res.json({ order, messages });
});

function postMessage({ orderId, sender, text }) {
  const db = readDB();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return null;
  const msg = {
    id: nanoid(10),
    orderId,
    sender, // "customer" or "admin"
    text,
    createdAt: new Date().toISOString(),
  };
  db.messages.push(msg);
  writeDB(db);
  return msg;
}

// ---------- Sockets ----------
io.on("connection", (socket) => {
  socket.on("join order", (orderId) => {
    socket.join(`order:${orderId}`);
  });

  socket.on("join admin", (token) => {
    if (token === ADMIN_TOKEN) socket.join("admin-room");
  });

  socket.on("chat message", ({ orderId, sender, text, token }) => {
    if (!orderId || !text || !text.trim()) return;
    if (sender === "admin" && token !== ADMIN_TOKEN) return; // don't let anyone impersonate the seller
    const safeSender = sender === "admin" ? "admin" : "customer";
    const msg = postMessage({ orderId, sender: safeSender, text: text.trim() });
    if (!msg) return;
    io.to(`order:${orderId}`).emit("chat message", msg);
    io.to("admin-room").emit("chat message", msg);
  });
});

server.listen(PORT, () => {
  console.log(`Store running at http://localhost:${PORT}`);
  console.log(`Seller/admin panel at http://localhost:${PORT}/admin.html`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
});
