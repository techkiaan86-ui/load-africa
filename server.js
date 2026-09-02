require('dotenv').config();
const app = require('./src/app');

const { connectDB } = require('./src/config/db');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, async () => {
  await connectDB();
  console.log(`🚀 Server is running on port ${PORT}`);
});

// Server instance initialized
module.exports = server;

// Setup basic Socket.io (Placeholder for future)
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true
  },
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log(`🟢 New client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`🔴 Client disconnected: ${socket.id}`);
  });
});
