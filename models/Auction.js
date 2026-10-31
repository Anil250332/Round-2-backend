import mongoose from 'mongoose';

const auctionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      default: "Leica M-Monochrom 'Stealth Edition'",
    },
    description: {
      type: String,
      required: true,
      default: "Iconic rangefinder crafted exclusively for high-contrast black & white imagery. Matte black chassis with 40MP monochrome sensor.",
    },
    startingPrice: {
      type: Number,
      required: true,
      default: 1000,
    },
    currentHighestBid: {
      type: Number,
      required: true,
      default: 1000,
    },
    currentHighestBidder: {
      type: String,
      default: null,
    },
    durationSeconds: {
      type: Number,
      default: 180,
    },
    startTime: {
      type: Date,
      default: Date.now,
    },
    endTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'ENDED'],
      default: 'ACTIVE',
    },
    winner: {
      name: { type: String, default: null },
      amount: { type: Number, default: null },
      wonAt: { type: Date, default: null },
    },
    imageUrl: {
      type: String,
      default: '/item.jpg',
    },
  },
  { timestamps: true }
);

export const AuctionModel = mongoose.model('Auction', auctionSchema);
