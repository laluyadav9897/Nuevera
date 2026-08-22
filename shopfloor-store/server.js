const express = require("express");
const multer = require("multer");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_TOKEN = "seller-session-token";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI environment variable. Set it in Render > Environment.");
  process.exit(1);
}

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const client = new MongoClient(MONGODB_URI);
let products, orders, messages;

async function connectDB() {
  await client.connect();
  const db = client.db("shopfloor");
  products = db.collection("products");
  orders = db.collection("orders");
  messages = db.collection("messages");

  const count = await products.countDocuments();
  if (count === 0) {
    await products.insertMany([
      {
        id: "p1",
        name: "Dishwashing Gloves",
        price: 249,
        description: "Reinforced rubber gloves with a non-slip grip and cotton lining. Sold as one pair, size M/L.",
        image: "/uploads/seed-gloves.svg",
        sku: "HH-GLV-001",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "p2",
        name: "Tape Dispenser",
        price: 399,
        description: "Weighted desktop tape dispenser, holds standard 1-inch tape rolls. Non-skid base.",
        image: "/uploads/seed-tape.svg",
        sku: "HH-TPD-002",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  }
  console.log("Connected to MongoDB — data will persist across restarts.");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, "public")));

// Store uploaded images in memory, then save them as base64 text directly
// inside the product's database record. This is what makes photos survive
// restarts — nothing is written to disk, which Render wipes periodically.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB max per photo
});

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Not authorized." });
  }
  next();
}

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ token: ADMIN_TOKEN });
  }
  res.status(401).json({ error: "Wrong password." });
});

app.get("/api/products", async (req, res) => {
  const list = await products.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  res.json(list);
});

app.post("/api/admin/products", requireAdmin, upload.single("image"), async (req, res) => {
  const { name, price, description, sku } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: "Name and price are required." });
  }
  let image = "/uploads/placeholder.svg";
  if (req.file) {
    const base64 = req.file.buffer.toString("base64");
    image = `data:${req.file.mimetype};base64,${base64}`;
  }
  const product = {
    id: nanoid(8),
    name,
    price: Number(price),
    description: description || "",
    sku: sku || "",
    image,
    createdAt: new Date().toISOString(),
  };
  await products.insertOne(product);
  delete product._id;
  res.status(201).json(product);
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  await products.deleteOne({ id: req.params.id });
  res.json({ ok: true });
});

app.post("/api/orders", async (req, res) => {
  const { productId, customerName, phone, address } = req.body || {};
  if (!productId || !customerName || !phone || !address) {
    return res.status(400).json({ error: "Missing order details." });
  }
  const product = await products.findOne({ id: productId });
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
  await orders.insertOne(order);
  delete order._id;

  const welcomeMsg = {
    id: nanoid(10),
    orderId: order.id,
    sender: "system",
    text: `Order placed for ${product.name} (₹${product.price}). Say hello below to sort out delivery details with the seller.`,
    createdAt: new Date().toISOString(),
  };
  await messages.insertOne(welcomeMsg);
  delete welcomeMsg._id;

  io.to(`order:${order.id}`).emit("chat message", welcomeMsg);
  io.to("admin-room").emit("new order", order);

  res.status(201).json(order);
});

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  const list = await orders.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  res.json(list);
});

app.get("/api/orders/:id/messages", async (req, res) => {
  const order = await orders.findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!order) return res.status(404).json({ error: "Order not found." });
  const msgs = await messages.find({ orderId: req.params.id }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray();
  res.json({ order, messages: msgs });
});

async function postMessage({ orderId, sender, text }) {
  const order = await orders.findOne({ id: orderId });
  if (!order) return null;
  const msg = {
    id: nanoid(10),
    orderId,
    sender,
    text,
    createdAt: new Date().toISOString(),
  };
  await messages.insertOne(msg);
  delete msg._id;
  return msg;
}

io.on("connection", (socket) => {
  socket.on("join order", (orderId) => {
    socket.join(`order:${orderId}`);
  });

  socket.on("join admin", (token) => {
    if (token === ADMIN_TOKEN) socket.join("admin-room");
  });

  socket.on("chat message", async ({ orderId, sender, text, token }) => {
    if (!orderId || !text || !text.trim()) return;
    if (sender === "admin" && token !== ADMIN_TOKEN) return;
    const safeSender = sender === "admin" ? "admin" : "customer";
    const msg = await postMessage({ orderId, sender: safeSender, text: text.trim() });
    if (!msg) return;
    io.to(`order:${orderId}`).emit("chat message", msg);
    io.to("admin-room").emit("chat message", msg);
  });
});

connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Store running at http://localhost:${PORT}`);
      console.log(`Seller/admin panel at http://localhost:${PORT}/admin.html`);
      console.log(`Admin password: ${ADMIN_PASSWORD}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
