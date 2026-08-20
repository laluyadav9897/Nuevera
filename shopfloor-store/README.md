# Shopfloor — a small store with live buyer/seller chat

A working e-commerce site: a public storefront, a seller/admin panel to upload
products and manage orders, and a live chat that opens automatically between
a customer and you (the seller) the moment an order is placed.

## What's included

- **Storefront** (`/`): product catalog, "Buy now" → order form (name, phone,
  address) → order is created and a chat window opens for that order.
- **Seller panel** (`/admin.html`): password-protected. Upload products
  (name, price, SKU, description, photo), remove products, see all orders,
  and reply to each customer's chat in real time.
- **Backend** (`server.js`): Node + Express, with Socket.io for live chat and
  Multer for photo uploads. Data is stored in a plain `db.json` file — no
  database setup needed.

Two sample products are pre-loaded: **Dishwashing Gloves** and **Tape
Dispenser**.

## Running it

You need [Node.js](https://nodejs.org) 18 or newer installed.

```bash
cd ecommerce-app
npm install
npm start
```

Then open:
- **Store:** http://localhost:3000
- **Seller panel:** http://localhost:3000/admin.html — password `admin123`

## Changing the seller password

Set the `ADMIN_PASSWORD` environment variable before starting the server, e.g.:

```bash
ADMIN_PASSWORD=your-new-password npm start
```

(On Windows PowerShell: `$env:ADMIN_PASSWORD="your-new-password"; npm start`)

## How the chat works

- When a customer clicks **Buy now** and submits their details, an order is
  created and a chat panel opens in their browser, scoped to that order.
- You see the new order appear instantly in the seller panel's order list.
- Click the order to open the thread and reply — your reply appears in the
  customer's chat window immediately (no refresh needed), and vice versa.
- Chat history is saved, so reopening an order (as seller) or returning to
  the site (as the same customer, same browser) restores the conversation.

## Notes on this build

- **Storage:** everything lives in `db.json` and the `uploads/` folder next
  to `server.js`. Back those two up if you want to preserve your catalog,
  orders, and chat history.
- **Auth:** the seller login is a single shared password meant for one
  person running a small store — it is intentionally simple, not a
  multi-user account system.
- **Going live:** to put this on the internet (rather than running it on
  your own computer), deploy it to a Node-friendly host (Render, Railway,
  Fly.io, a VPS, etc.), set `ADMIN_PASSWORD` to something private, and put it
  behind HTTPS. This version is a solid functional base — for a store taking
  real payments you'd also want to add a payment gateway (e.g. Razorpay or
  Stripe) at the order-placement step instead of "cash on delivery"-style
  orders.
- **Adding more products:** just use the "Add a product" form in the seller
  panel — no code changes needed.

## Project structure

```
ecommerce-app/
├── server.js          # backend: API routes + socket.io chat
├── db.json            # product/order/message data (auto-updated)
├── package.json
├── uploads/            # product photos live here
└── public/
    ├── index.html       # storefront
    ├── shop.js
    ├── admin.html        # seller panel
    ├── admin.js
    └── style.css
```
