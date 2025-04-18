// Book.js
import mongoose from "mongoose";
const commentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true, // Added required validation
  },
  text: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const bookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    author: {
      type: String,
      required: true,
    },
    caption: {
      type: String,
      required: true,
    },
    image: {
      type: String,
      required: true,
    },
    genre: {
      type: String,
      required: true,
      enum: [
        "Fiction",
        "Fantasy",
        "Science Fiction",
        "Mystery",
        "Thriller",
        "Romance",
        "Historical Fiction",
        "Horror",
        "Adventure",
        "Non-fiction",
        "Biography",
        "Autobiography",
        "Memoir",
        "Self-help",
        "Business",
        "Philosophy",
        "Children",
        "Young Adult",
        "Poetry",
        "Drama",
        "Humor",
        "Spirituality",
        "Health & Wellness",
        "Travel",
        "Other"
      ],
      default: "Other",
    },
    views: {
      type: Number,
      default: 0,
    },
    pdfFile: {
      type: String,
      required: true,
    },
    pdfPublicId: {
      type: String,
      default: null
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    Rating: {
      type: Number,
      default: 0,
    },
    ratingCount: {
      type: Number,
      default: 0,
    },
    // Premium book features
    isPremium: {
      type: Boolean,
      default: false
    },
    premiumDisplayUntil: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    },
    // Array to store individual user ratings
    ratings: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        value: {
          type: Number,
          required: true,
          min: 1,
          max: 5,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    comments: [commentSchema], // Use the commentSchema definition
  },
  { timestamps: true }
);

const Book = mongoose.model("Book", bookSchema);
export default Book;