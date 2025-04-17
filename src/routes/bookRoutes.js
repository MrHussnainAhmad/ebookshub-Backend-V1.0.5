import express from "express";
import cloudinary from "../lib/cloudinary.js";
import Book from "../models/Book.js";
import protectRoute from "../middlewares/auth.middleware.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// Create tmp directory if it doesn't exist
const TMP_DIR = "./tmp";
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// Configure multer storage for temporary file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TMP_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

// Configure multer upload with increased limits
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 45 * 1024 * 1024, // 25MB for PDF files
    fieldSize: 50 * 1024 * 1024, // 30MB field size for base64 data
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/docx"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  },
});

// Helper function to clean up temporary files
const cleanupTempFile = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Temporary file deleted: ${filePath}`);
    }
  } catch (error) {
    console.error(`Failed to delete temporary file: ${filePath}`, error);
  }
};

// Helper function to handle PDF upload - updated for Cloudinary
const handlePdfUpload = async (filePath, fileName) => {
  try {
    console.log(`Uploading PDF file: ${fileName} from path: ${filePath}`);
    const fileSize = fs.statSync(filePath).size;
    console.log(
      `File exists: ${fs.existsSync(filePath)}, Size: ${fileSize} bytes`
    );

    // Check file size before attempting to upload to Cloudinary
    const CLOUDINARY_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB limit for Cloudinary

    if (fileSize > CLOUDINARY_SIZE_LIMIT) {
      console.warn(`File exceeds Cloudinary size limit: ${fileSize} bytes`);
      throw new Error(
        `Currently we are accepting max 10Mb file. Please compress the PDF or use a smaller file.`
      );
    }

    // Cloudinary upload for PDF
    const uploadResult = await cloudinary.uploader.upload(filePath, {
      resource_type: "raw",
      public_id: `pdfs/${path.basename(
        fileName,
        path.extname(fileName)
      )}-${Date.now()}`,
      timeout: 120000, // 120 second timeout for larger files
    });

    console.log("Cloudinary PDF upload successful:", uploadResult.secure_url);
    return uploadResult.secure_url;
  } catch (error) {
    console.error("PDF upload to Cloudinary failed:", error);
    throw new Error(`PDF upload failed: ${error.message}`);
  } finally {
    cleanupTempFile(filePath);
  }
};

// Get public featured books
router.get("/public/featured", async (req, res) => {
  try {
    const featuredBooks = await Book.find()
      .sort({ createdAt: -1 })
      .limit(4)
      .select("title author image genre caption"); // Limited data
      
    res.json(featuredBooks);
  } catch (error) {
    console.error("Error fetching public featured books:", error);
    res.status(500).json({ message: "Failed to fetch books" });
  }
});

// Get public trending books
router.get("/public/trending", async (req, res) => {
  try {
    const trendingBooks = await Book.find()
      .sort({ views: -1 })
      .limit(4)
      .select("title author image genre caption"); // Limited data
      
    res.json(trendingBooks);
  } catch (error) {
    console.error("Error fetching public trending books:", error);
    res.status(500).json({ message: "Failed to fetch books" });
  }
});

// Get public genres for filtering
router.get("/public/genres", async (req, res) => {
  try {
    const genreCounts = await Book.aggregate([
      { $group: { _id: "$genre", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    
    res.json(genreCounts);
  } catch (error) {
    console.error("Error fetching public genres:", error);
    res.status(500).json({ message: "Failed to fetch genres" });
  }
});

// Create a new book - updated to include pdfPublicId
router.post("/", protectRoute, upload.single("pdfFile"), async (req, res) => {
  let tempFilePath = null;

  try {
    const { title, author, caption, image, genre } = req.body;

    if (!title?.trim()) return res.status(400).json({ message: "Title is required" });
    if (!author?.trim()) return res.status(400).json({ message: "Author name is required" });
    if (!caption?.trim()) return res.status(400).json({ message: "Caption is required" });
    if (!image) return res.status(400).json({ message: "Image is required" });
    if (!genre) return res.status(400).json({ message: "Genre is required" });

    let pdfUrl = null;
    let pdfPublicId = null;
    let pdfFileName = null;

    if (req.file) {
      pdfFileName = req.file.originalname;
      tempFilePath = req.file.path;
    } else if (req.body.pdfBase64) {
      pdfFileName = req.body.pdfFileName || `${Date.now()}-book.pdf`;
      tempFilePath = `${TMP_DIR}/${Date.now()}-${pdfFileName}`;
      fs.writeFileSync(tempFilePath, Buffer.from(req.body.pdfBase64, "base64"));
    } else {
      return res.status(400).json({ message: "PDF File is required" });
    }

    const baseFileName = path.basename(pdfFileName, path.extname(pdfFileName));
    const cloudinaryPublicId = `pdfs/${baseFileName}-${Date.now()}`;

    const uploadResult = await cloudinary.uploader.upload(tempFilePath, {
      resource_type: "raw",
      public_id: cloudinaryPublicId,
      timeout: 120000,
    });

    pdfUrl = uploadResult.secure_url;
    pdfPublicId = uploadResult.public_id;

    cleanupTempFile(tempFilePath);

    const imageResult = await cloudinary.uploader.upload(image, {
      timeout: 60000,
    });

    const book = new Book({
      title: title.trim(),
      author: author.trim(),
      caption: caption.trim(),
      image: imageResult.secure_url,
      genre,
      pdfFile: pdfUrl,
      pdfPublicId,
      user: req.user._id,
    });

    await book.save();

    res.status(201).json({
      message: "Book created successfully",
      book: {
        _id: book._id,
        title: book.title,
        author: book.author,
        image: book.image,
        genre: book.genre,
      },
    });
  } catch (error) {
    console.error("Book creation error:", error);
    res.status(500).json({ message: error.message || "Failed to create book" });
  } finally {
    cleanupTempFile(tempFilePath);
  }
});


// Get books with pagination and filtering
router.get("/", protectRoute, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const genre = req.query.genre;

    // Create filter object
    const filter = {};
    if (genre && genre !== "All") {
      filter.genre = genre;
    }

    // Get books with pagination
    const books = await Book.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "username profileImage");

    const total = await Book.countDocuments(filter);

    res.json({
      books,
      currentPage: page,
      totalBooks: total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching books:", error);
    res.status(500).json({ message: "Failed to fetch books" });
  }
});

// Serve PDF - Updated for Cloudinary direct download
router.get("/:id/pdf", protectRoute, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book || !book.pdfFile) {
      return res.status(404).json({ message: "PDF not found" });
    }

    // Check if the PDF URL is accessible before redirecting
    const pdfUrl = book.pdfFile;

    // Send the URL directly rather than redirecting
    res.json({ pdfUrl });
  } catch (error) {
    console.error("Error serving PDF:", error);
    res.status(500).json({ message: "Error serving PDF file" });
  }
});

// Get user's books
router.get("/user", protectRoute, async (req, res) => {
  try {
    const books = await Book.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .select(
        "title author image caption createdAt genre Rating ratingCount views"
      ); // Add genre field here

    res.json(books);
  } catch (error) {
    console.error("Error fetching user's books:", error);
    res.status(500).json({ message: "Failed to fetch your books" });
  }
});

// Get genre statistics
router.get("/genres", protectRoute, async (req, res) => {
  try {
    const genreCounts = await Book.aggregate([
      { $group: { _id: "$genre", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json(genreCounts);
  } catch (error) {
    console.error("Error fetching genres:", error);
    res.status(500).json({ message: "Failed to fetch genres" });
  }
});

// Get books by genre
router.get("/genre/:genreName", protectRoute, async (req, res) => {
  try {
    const { genreName } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const books = await Book.find({ genre: genreName })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "username profileImage");

    const total = await Book.countDocuments({ genre: genreName });

    res.json({
      books,
      currentPage: page,
      totalBooks: total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching books by genre:", error);
    res.status(500).json({ message: "Failed to fetch books by genre" });
  }
});

// Get premium books
router.get("/premium", protectRoute, async (req, res) => {
  try {
    const now = new Date();

    const premiumBooks = await Book.find({
      isPremium: true,
      $or: [
        { premiumDisplayUntil: { $exists: false } },
        { premiumDisplayUntil: { $gte: now } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(4)
      .populate("user", "username profileImage");

    res.json(premiumBooks);
  } catch (error) {
    console.error("Error fetching premium books:", error);
    res.status(500).json({ message: "Failed to fetch premium books" });
  }
});

// Get new books
router.get("/new", protectRoute, async (req, res) => {
  try {
    const newBooks = await Book.find()
      .sort({ createdAt: -1 })
      .limit(4)
      .populate("user", "username profileImage");

    res.json(newBooks);
  } catch (error) {
    console.error("Error fetching new books:", error);
    res.status(500).json({ message: "Failed to fetch new books" });
  }
});

// Daily recommendations with caching
let dailyRecommendations = [];
let lastRefreshDate = null;
router.get("/daily-recommendations", protectRoute, async (req, res) => {
  try {
    const today = new Date().toDateString();

    // Refresh recommendations if needed
    if (!lastRefreshDate || lastRefreshDate !== today) {
      const bookCount = await Book.countDocuments();
      const randomSkip = Math.floor(Math.random() * Math.max(bookCount - 2, 0));

      dailyRecommendations = await Book.find()
        .skip(randomSkip)
        .limit(2)
        .populate("user", "username profileImage");

      lastRefreshDate = today;
      console.log("Generated new daily recommendations for", today);
    }

    res.json(dailyRecommendations);
  } catch (error) {
    console.error("Error fetching daily recommendations:", error);
    res.status(500).json({ message: "Failed to fetch recommendations" });
  }
});

// Alias route for compatibility
router.get("/my-books", protectRoute, async (req, res) => {
  try {
    const books = await Book.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .select(
        "title author image caption createdAt genre Rating ratingCount views"
      ); // Add genre field here

    res.json(books);
  } catch (error) {
    console.error("Error fetching user's books:", error);
    res.status(500).json({ message: "Failed to fetch your books" });
  }
});

// Get top rated books
router.get("/top-rated", protectRoute, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const topRatedBooks = await Book.find({
      Rating: { $exists: true, $ne: null },
    })
      .sort({ Rating: -1 })
      .limit(limit)
      .populate("user", "username profileImage");

    res.json(topRatedBooks);
  } catch (error) {
    console.error("Error fetching top rated books:", error);
    res.status(500).json({ message: "Failed to fetch top rated books" });
  }
});

//Get recommended books
router.get("/recommended", protectRoute, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user._id;

    // Step 1: Find the genres this user has viewed or rated
    const userInteractions = await Book.aggregate([
      // Find books the user has interacted with (viewed or rated)
      {
        $match: {
          $or: [
            { "ratings.user": userId }, // Books the user has rated
            { views: { $exists: true, $gt: 0 } } // Books with views (if you track user-specific views)
          ]
        }
      },
      // Extract just the genres
      { $group: { _id: "$genre" } }
    ]);

    // Extract the user's preferred genres
    const userGenres = userInteractions.map(item => item._id);

    // If we have user preferences
    if (userGenres.length > 0) {
      // Find books from the same genres the user has shown interest in
      const recommendedBooks = await Book.aggregate([
        // Find books that match the user's preferred genres
        {
          $match: {
            genre: { $in: userGenres },
            // Exclude books the user has already rated (optional)
            "ratings.user": { $ne: userId }
          }
        },
        // Add scoring based on genres, ratings, and views
        {
          $addFields: {
            // Score based on rating, views, and exact genre match
            genreMatchScore: { $cond: { if: { $in: ["$genre", userGenres] }, then: 2, else: 0 } },
            score: {
              $add: [
                { $ifNull: ["$Rating", 0] }, // Rating score
                { $divide: [{ $ifNull: ["$views", 0] }, 100] }, // Normalized views
                2 // Genre match bonus (could be adjusted)
              ]
            }
          }
        },
        // Sort by our composite score
        { $sort: { score: -1 } },
        { $limit: limit }
      ]);

      // Populate user field for the aggregated results
      const populatedBooks = await Book.populate(recommendedBooks, {
        path: "user",
        select: "username profileImage"
      });

      return res.json(populatedBooks);
    } 
    
    // Fallback: If no user preferences, return generally popular books
    else {
      const fallbackBooks = await Book.find({
        Rating: { $exists: true, $ne: null }
      })
        .sort({ Rating: -1, views: -1 })
        .limit(limit)
        .populate("user", "username profileImage");

      return res.json(fallbackBooks);
    }
  } catch (error) {
    console.error("Error fetching recommended books:", error);
    res.status(500).json({ message: "Failed to fetch recommended books" });
  }
});

// Search books by title or author
router.get("/search", protectRoute, async (req, res) => {
  try {
    const query = req.query.query;

    if (!query) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const books = await Book.find({
      $or: [
        { title: { $regex: query, $options: "i" } },
        { author: { $regex: query, $options: "i" } },
      ],
    })
      .sort({ Rating: -1, views: -1, createdAt: -1 })
      .limit(20)
      .populate("user", "username profileImage");

    res.json(books);
  } catch (error) {
    console.error("Error searching books:", error);
    res.status(500).json({ message: "Failed to search books" });
  }
});

// Increment book views when a book is viewed
router.post("/:id/view", protectRoute, async (req, res) => {
  try {
    const bookId = req.params.id;

    const book = await Book.findByIdAndUpdate(
      bookId,
      { $inc: { views: 1 } },
      { new: true }
    );

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    res.json({ success: true, views: book.views });
  } catch (error) {
    console.error("Error incrementing book views:", error);
    res.status(500).json({ message: "Failed to update book views" });
  }
});

// Rate a book
router.post("/:id/rate", protectRoute, async (req, res) => {
  try {
    const bookId = req.params.id;
    const userId = req.user._id;
    const { rating } = req.body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ message: "Rating must be between 1 and 5" });
    }

    // Find the book
    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    // Check if user has already rated this book
    // First, ensure the ratings array exists
    if (!book.ratings) {
      book.ratings = [];
    }

    // Find if user already rated
    const existingRatingIndex = book.ratings.findIndex(
      (r) => r.user.toString() === userId.toString()
    );

    if (existingRatingIndex > -1) {
      // Update existing rating
      book.ratings[existingRatingIndex].value = rating;
    } else {
      // Add new rating
      book.ratings.push({
        user: userId,
        value: rating,
      });
    }

    // Calculate average rating
    const totalRating = book.ratings.reduce((sum, item) => sum + item.value, 0);
    const averageRating = totalRating / book.ratings.length;

    // Update book with new rating
    book.Rating = averageRating;
    book.ratingCount = book.ratings.length;

    await book.save();

    res.json({
      message: "Rating submitted successfully",
      newRating: averageRating,
      ratingCount: book.ratings.length,
      userRating: rating,
    });
  } catch (error) {
    console.error("Error rating book:", error);
    res.status(500).json({ message: "Failed to submit rating" });
  }
});

// Get book details
router.get("/:id", protectRoute, async (req, res) => {
  try {
    const bookId = req.params.id;
    const userId = req.user._id;
    const book = await Book.findById(bookId)
      .populate("user", "username profileImage"); // Uploader details
    
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }
    
    // Check if user has rated this book and include that information
    let userRating = null;
    if (book.ratings && book.ratings.length > 0) {
      const userRatingObj = book.ratings.find(
        (rating) => rating.user.toString() === userId.toString()
      );
      if (userRatingObj) {
        userRating = userRatingObj.value;
      }
    }
    
    // Add userRating to the response
    const bookWithUserRating = {
      ...book.toObject(),
      userRating
    };
    
    res.json(bookWithUserRating);
  } catch (error) {
    console.error("Error fetching book details:", error);
    res.status(500).json({ message: "Failed to fetch book details" });
  }
});

// Get comments for a book
router.get("/:id/comments", protectRoute, async (req, res) => {
  try {
    const bookId = req.params.id;
    
    // Use more explicit population for comments.user
    const book = await Book.findById(bookId)
      .populate({
        path: 'comments.user',
        select: 'username profileImage',
        model: 'User' // Explicitly specify the model
      });
    
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }
    
    // Transform comments to ensure user info is properly included
    const comments = book.comments || [];
    
    // Map through comments to ensure each has proper user info
    const processedComments = comments.map(comment => {
      // Handle case where user might be null or undefined
      const user = comment.user || { username: 'Unknown User', profileImage: '/default-avatar.png' };
      
      return {
        _id: comment._id,
        text: comment.text,
        createdAt: comment.createdAt,
        user: {
          _id: user._id || 'unknown',
          username: user.username || 'Unknown User',
          profileImage: user.profileImage || '/default-avatar.png'
        }
      };
    });
    
    res.json(processedComments);
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ message: "Failed to fetch comments" });
  }
});

// Add a comment to a book
router.post("/:id/comments", protectRoute, async (req, res) => {
  try {
    const { text } = req.body;
    const bookId = req.params.id;
    const userId = req.user._id;
    
    if (!text?.trim()) {
      return res.status(400).json({ message: "Comment text is required" });
    }
    
    const book = await Book.findById(bookId);
    
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }
    
    // Initialize comments array if it doesn't exist
    if (!book.comments) {
      book.comments = [];
    }
    
    // Add the new comment
    book.comments.push({
      user: userId,
      text: text.trim(),
      createdAt: new Date()
    });
    
    await book.save();
    
    // Get the User model directly to get user information
    const User = await import("../models/User.js").then(module => module.default);
    const userInfo = await User.findById(userId).select('username profileImage');
    
    // Create the new comment with populated user info
    const newComment = {
      _id: book.comments[book.comments.length - 1]._id,
      text: text.trim(),
      createdAt: new Date(),
      user: {
        _id: userId,
        username: userInfo.username || 'Unknown User',
        profileImage: userInfo.profileImage || '/default-avatar.png'
      }
    };
    
    res.status(201).json({
      message: "Comment added successfully",
      comment: newComment
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ message: "Failed to add comment" });
  }
});

// Delete book - Comprehensive approach for Cloudinary deletion
router.delete("/:id", protectRoute, async (req, res) => {
  try {
    console.log("Delete book request received for ID:", req.params.id);
    console.log("User attempting deletion:", req.user._id, "Role:", req.user.userType);
    
    const book = await Book.findById(req.params.id);
    if (!book) {
      console.log("Book not found");
      return res.status(404).json({ message: "Book not found" });
    }
    
    console.log("Book found. Owner:", book.user);
    
    // Authorization check
    if (book.user.toString() !== req.user._id.toString() && req.user.userType !== "admin") {
      console.log("Authorization failed - not owner or admin");
      return res.status(403).json({ message: "Not authorized to delete this book" });
    }
    
    console.log("Authorization passed, proceeding with deletion");
    
    // Delete image from Cloudinary
    if (book.image && book.image.includes("cloudinary")) {
      try {
        // Extract public ID for image (format: https://res.cloudinary.com/[cloud_name]/image/upload/v1234567890/[public_id].jpg)
        const imagePublicId = book.image.split('/').slice(-1)[0].split('.')[0];
        console.log("Deleting image with public ID:", imagePublicId);
        await cloudinary.uploader.destroy(imagePublicId);
        console.log("Image deleted from Cloudinary");
      } catch (imageError) {
        console.error("Error deleting image from Cloudinary:", imageError);
        // Continue with deletion even if image deletion fails
      }
    }
    
    // Delete PDF from Cloudinary
    if (book.pdfFile && book.pdfPublicId) {
      try {
        console.log("Deleting PDF with public ID:", book.pdfPublicId);
        await cloudinary.uploader.destroy(book.pdfPublicId, { resource_type: "raw" });
        console.log("PDF deleted from Cloudinary");
      } catch (pdfError) {
        console.error("Error deleting PDF from Cloudinary:", pdfError);
        // Continue with deletion even if PDF deletion fails
      }
    }
    
    await book.deleteOne();
    console.log("Book deleted successfully");
    return res.json({ message: "Book deleted successfully" });
  } catch (error) {
    console.error("Error deleting book:", error);
    return res.status(500).json({ message: "Failed to delete book" });
  }
});

// Admin delete book route
router.delete("/books/:id", async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ 
        success: false, 
        message: "Book not found" 
      });
    }

    // Delete image from Cloudinary
    if (book.image && book.image.includes("cloudinary")) {
      try {
        const imageUrl = book.image;
        console.log("Image URL to delete:", imageUrl);
        
        // Extract public ID for image
        const publicId = imageUrl.split('/').pop().split('.')[0];
        console.log("Extracted image public ID:", publicId);
        
        const imageResult = await cloudinary.uploader.destroy(publicId);
        console.log("Image deletion result:", imageResult);
      } catch (error) {
        console.error("Error deleting image from Cloudinary:", error);
      }
    }

    // Delete PDF from Cloudinary
    if (book.pdfFile && book.pdfPublicId) {
      try {
        console.log("Deleting PDF with public ID:", book.pdfPublicId);
        await cloudinary.uploader.destroy(book.pdfPublicId, { resource_type: "raw" });
        console.log("PDF deleted from Cloudinary");
      } catch (pdfError) {
        console.error("Error deleting PDF from Cloudinary:", pdfError);
      }
    }

    await book.deleteOne();
    res.json({ 
      success: true,
      message: "Book deleted successfully" 
    });
  } catch (error) {
    console.error("Admin - Error deleting book:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to delete book" 
    });
  }
});

export default router;