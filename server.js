import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB, getMongoStatus } from './config/db.js';
import { AuctionModel } from './models/Auction.js';
import { BidModel } from './models/Bid.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: '*' }));
app.use(express.json());

// In-Memory Fallback State (ensures zero crash if MongoDB is not running locally)
const DEFAULT_AUCTION = {
  id: 'auction-001',
  title: "Leica M-Monochrom 'Stealth Edition'",
  description: "Iconic rangefinder crafted exclusively for high-contrast black & white imagery. Matte black chassis with 40MP monochrome sensor.",
  startingPrice: 1000,
  currentHighestBid: 1000,
  currentHighestBidder: null,
  durationSeconds: 180,
  startTime: new Date(),
  endTime: new Date(Date.now() + 180 * 1000),
  status: 'ACTIVE',
  winner: null,
  imageUrl: '/item.jpg',
};

let memoryAuction = { ...DEFAULT_AUCTION };
let memoryBids = [];

// Helper to check auction expiration
const checkAndFinalizeAuction = async () => {
  const now = Date.now();
  const end = new Date(memoryAuction.endTime).getTime();

  if (now >= end && memoryAuction.status === 'ACTIVE') {
    memoryAuction.status = 'ENDED';
    if (memoryAuction.currentHighestBidder) {
      memoryAuction.winner = {
        name: memoryAuction.currentHighestBidder,
        amount: memoryAuction.currentHighestBid,
        wonAt: new Date(end),
      };
    } else {
      memoryAuction.winner = null;
    }

    if (getMongoStatus()) {
      try {
        await AuctionModel.findOneAndUpdate(
          {},
          {
            status: 'ENDED',
            winner: memoryAuction.winner,
          }
        );
      } catch (err) {
        console.error('Error updating auction in MongoDB:', err.message);
      }
    }

    io.emit('auction_ended', {
      auction: memoryAuction,
      winner: memoryAuction.winner,
    });
    console.log('[Auction Ended]: Winner ->', memoryAuction.winner);
  }
};

// Periodic checker for auction completion
setInterval(async () => {
  await checkAndFinalizeAuction();
}, 1000);

// API Routes

// 1. Get current auction and bid history
app.get('/api/auction', async (req, res) => {
  try {
    await checkAndFinalizeAuction();
    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(memoryAuction.endTime).getTime() - Date.now()) / 1000)
    );

    return res.json({
      success: true,
      auction: {
        ...memoryAuction,
        remainingSeconds,
      },
      bids: memoryBids,
      storage: getMongoStatus() ? 'MongoDB' : 'In-Memory Cache (Active)',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Place a bid
app.post('/api/bid', async (req, res) => {
  try {
    await checkAndFinalizeAuction();

    const { bidderName, amount } = req.body;
    const numericAmount = Number(amount);

    // Basic Validations
    if (!bidderName || typeof bidderName !== 'string' || !bidderName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Participant name is required to place a bid.',
      });
    }

    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid numeric bid amount.',
      });
    }

    // Check if auction is ended
    if (memoryAuction.status === 'ENDED' || Date.now() >= new Date(memoryAuction.endTime).getTime()) {
      return res.status(400).json({
        success: false,
        message: 'Auction has ended. No more bids are accepted.',
      });
    }

    // Strict Rule: Every new bid must be at least ₹100 higher than the current highest bid
    const minRequired = memoryAuction.currentHighestBidder
      ? memoryAuction.currentHighestBid + 100
      : memoryAuction.startingPrice;

    if (numericAmount < minRequired) {
      const reason = memoryAuction.currentHighestBidder
        ? `Bid rejected: Every new bid must be at least ₹100 higher than the current highest bid of ₹${memoryAuction.currentHighestBid.toLocaleString('en-IN')}. Minimum allowed bid is ₹${(memoryAuction.currentHighestBid + 100).toLocaleString('en-IN')}.`
        : `Bid rejected: Your bid of ₹${numericAmount.toLocaleString('en-IN')} must be at least the starting price of ₹${memoryAuction.startingPrice.toLocaleString('en-IN')}.`;

      // Record rejected bid attempt for transparent history auditing
      const rejectedBid = {
        id: `bid-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        auctionId: memoryAuction.id,
        bidderName: bidderName.trim(),
        amount: numericAmount,
        timestamp: new Date(),
        status: 'REJECTED',
        rejectionReason: reason,
      };

      return res.status(400).json({
        success: false,
        message: reason,
        rejectedBid,
      });
    }

    // Accept valid bid
    memoryAuction.currentHighestBid = numericAmount;
    memoryAuction.currentHighestBidder = bidderName.trim();

    const newBid = {
      id: `bid-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      auctionId: memoryAuction.id,
      bidderName: bidderName.trim(),
      amount: numericAmount,
      timestamp: new Date(),
      status: 'ACCEPTED',
    };

    memoryBids.unshift(newBid); // Newest on top

    // Save to Mongo if available
    if (getMongoStatus()) {
      try {
        await AuctionModel.findOneAndUpdate(
          {},
          {
            currentHighestBid: numericAmount,
            currentHighestBidder: bidderName.trim(),
          }
        );
        const bidDoc = new BidModel({
          auctionId: memoryAuction.id,
          bidderName: bidderName.trim(),
          amount: numericAmount,
          timestamp: newBid.timestamp,
          status: 'ACCEPTED',
        });
        await bidDoc.save();
      } catch (dbErr) {
        console.warn('MongoDB save error:', dbErr.message);
      }
    }

    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(memoryAuction.endTime).getTime() - Date.now()) / 1000)
    );

    // Broadcast to all clients in real time
    io.emit('bid_placed', {
      bid: newBid,
      auction: {
        ...memoryAuction,
        remainingSeconds,
      },
      bids: memoryBids,
    });

    return res.status(200).json({
      success: true,
      message: `Bid of ₹${numericAmount.toLocaleString('en-IN')} placed successfully by ${bidderName.trim()}!`,
      bid: newBid,
      auction: {
        ...memoryAuction,
        remainingSeconds,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Organizer Create / Reset Timed Auction
const handleCreateOrReset = async (req, res) => {
  try {
    const {
      title,
      description,
      durationSeconds = 180,
      startingPrice = 1000,
      imageUrl,
    } = req.body;

    const duration = Math.max(5, Number(durationSeconds) || 180);
    const startPrice = Math.max(1, Number(startingPrice) || 1000);

    const now = new Date();
    const endTime = new Date(now.getTime() + duration * 1000);

    memoryAuction = {
      ...DEFAULT_AUCTION,
      id: `auction-${Date.now()}`,
      title: title && title.trim() ? title.trim() : DEFAULT_AUCTION.title,
      description: description && description.trim() ? description.trim() : DEFAULT_AUCTION.description,
      startingPrice: startPrice,
      currentHighestBid: startPrice,
      currentHighestBidder: null,
      durationSeconds: duration,
      startTime: now,
      endTime: endTime,
      status: 'ACTIVE',
      winner: null,
      imageUrl: imageUrl && imageUrl.trim() ? imageUrl.trim() : DEFAULT_AUCTION.imageUrl,
    };
    memoryBids = [];

    if (getMongoStatus()) {
      try {
        await AuctionModel.deleteMany({});
        await BidModel.deleteMany({});
        const auctionDoc = new AuctionModel({
          ...memoryAuction,
        });
        await auctionDoc.save();
      } catch (err) {
        console.error('MongoDB reset error:', err.message);
      }
    }

    io.emit('auction_reset', {
      auction: {
        ...memoryAuction,
        remainingSeconds: duration,
      },
      bids: memoryBids,
    });

    return res.json({
      success: true,
      message: `Auction for "${memoryAuction.title}" created successfully with ${duration}s countdown.`,
      auction: {
        ...memoryAuction,
        remainingSeconds: duration,
      },
      bids: memoryBids,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

app.post('/api/auction/create', handleCreateOrReset);
app.post('/api/auction/reset', handleCreateOrReset);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`[Socket.io Client Connected]: ${socket.id}`);

  // Send initial data to connected client
  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(memoryAuction.endTime).getTime() - Date.now()) / 1000)
  );

  socket.emit('initial_state', {
    auction: {
      ...memoryAuction,
      remainingSeconds,
    },
    bids: memoryBids,
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io Client Disconnected]: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, async () => {
  console.log(`=================================================`);
  console.log(`  Event Auction System Backend running on port ${PORT}`);
  console.log(`=================================================`);
  await connectDB();
});
