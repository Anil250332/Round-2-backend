import mongoose from 'mongoose';

const bidSchema = new mongoose.Schema(
  {
    auctionId: {
      type: String,
      required: true,
    },
    bidderName: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['ACCEPTED', 'REJECTED'],
      default: 'ACCEPTED',
    },
    rejectionReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export const BidModel = mongoose.model('Bid', bidSchema);
