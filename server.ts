import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const app = express();
const PORT = 3000;
const JWT_SECRET = 'agroconnect-secret-key-123';

app.use(cors());
app.use(express.json());

// --- In-Memory Database (Simulating MongoDB) ---
const db = {
  users: [] as any[],
  products: [] as any[],
  orders: [] as any[],
  messages: [] as any[],
};

// Initialize some dummy data
db.users.push({
  id: 'farmer1',
  name: 'Ramesh Kumar',
  email: 'farmer@example.com',
  password: bcrypt.hashSync('password123', 8),
  role: 'farmer',
  location: 'Maharashtra, India',
});

db.users.push({
  id: 'buyer1',
  name: 'Global Fresh Imports',
  email: 'buyer@example.com',
  password: bcrypt.hashSync('password123', 8),
  role: 'buyer',
  location: 'Dubai, UAE',
});

db.products.push({
  id: 'prod1',
  farmerId: 'farmer1',
  name: 'Alphonso Mangoes',
  quantity: 500, // kg
  quality: 'Grade A - Export Quality',
  price: 2.5, // USD per kg
  images: ['https://picsum.photos/seed/mango/400/300'],
  status: 'available',
  createdAt: new Date().toISOString(),
});

// --- Middleware ---
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// --- API Routes ---

// Auth Routes
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role, location } = req.body;
  if (db.users.find((u) => u.email === email)) {
    return res.status(400).json({ message: 'Email already exists' });
  }
  const newUser = {
    id: `user_${Date.now()}`,
    name,
    email,
    password: bcrypt.hashSync(password, 8),
    role,
    location,
  };
  db.users.push(newUser);
  const token = jwt.sign({ id: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: '1d' });
  res.json({ token, user: { id: newUser.id, name, email, role, location } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find((u) => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
  res.json({ token, user: { id: user.id, name: user.name, email, role: user.role, location: user.location } });
});

app.get('/api/auth/me', authenticate, (req: any, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, location: user.location } });
});

// Product Routes
app.get('/api/products', (req, res) => {
  const { farmerId } = req.query;
  let products = db.products;
  if (farmerId) {
    products = products.filter((p) => p.farmerId === farmerId);
  }
  // Attach farmer details
  const enrichedProducts = products.map((p) => {
    const farmer = db.users.find((u) => u.id === p.farmerId);
    return { ...p, farmerName: farmer?.name, farmerLocation: farmer?.location };
  });
  res.json(enrichedProducts);
});

app.post('/api/products', authenticate, (req: any, res) => {
  if (req.user.role !== 'farmer') return res.status(403).json({ message: 'Only farmers can add products' });
  const newProduct = {
    id: `prod_${Date.now()}`,
    farmerId: req.user.id,
    ...req.body,
    createdAt: new Date().toISOString(),
  };
  db.products.push(newProduct);
  res.json(newProduct);
});

// Order Routes
app.post('/api/orders', authenticate, (req: any, res) => {
  if (req.user.role !== 'buyer') return res.status(403).json({ message: 'Only buyers can place orders' });
  const { productId, quantity, totalPrice } = req.body;
  const product = db.products.find((p) => p.id === productId);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  
  const newOrder = {
    id: `ord_${Date.now()}`,
    buyerId: req.user.id,
    farmerId: product.farmerId,
    productId,
    quantity,
    totalPrice,
    status: 'Pending',
    trackingHistory: [{ status: 'Pending', timestamp: new Date().toISOString(), location: product.farmerLocation }],
    createdAt: new Date().toISOString(),
  };
  db.orders.push(newOrder);
  res.json(newOrder);
});

app.get('/api/orders', authenticate, (req: any, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  let orders = db.orders.filter((o) => role === 'farmer' ? o.farmerId === userId : o.buyerId === userId);
  
  // Enrich orders
  const enrichedOrders = orders.map((o) => {
    const product = db.products.find((p) => p.id === o.productId);
    const otherParty = db.users.find((u) => u.id === (role === 'farmer' ? o.buyerId : o.farmerId));
    return {
      ...o,
      productName: product?.name,
      productImage: product?.images[0],
      otherPartyName: otherParty?.name,
      otherPartyLocation: otherParty?.location,
    };
  });
  res.json(enrichedOrders);
});

app.put('/api/orders/:id/status', authenticate, (req: any, res) => {
  if (req.user.role !== 'farmer') return res.status(403).json({ message: 'Only farmers can update status' });
  const { status, location } = req.body;
  const order = db.orders.find((o) => o.id === req.params.id && o.farmerId === req.user.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  
  order.status = status;
  order.trackingHistory.push({ status, timestamp: new Date().toISOString(), location });
  res.json(order);
});

// Chat Routes
app.get('/api/chat/:userId', authenticate, (req: any, res) => {
  const otherUserId = req.params.userId;
  const messages = db.messages.filter(
    (m) => (m.senderId === req.user.id && m.receiverId === otherUserId) || 
           (m.senderId === otherUserId && m.receiverId === req.user.id)
  );
  res.json(messages);
});

app.post('/api/chat', authenticate, (req: any, res) => {
  const { receiverId, text } = req.body;
  const newMessage = {
    id: `msg_${Date.now()}`,
    senderId: req.user.id,
    receiverId,
    text,
    timestamp: new Date().toISOString(),
  };
  db.messages.push(newMessage);
  res.json(newMessage);
});

// --- Vite Integration ---
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
