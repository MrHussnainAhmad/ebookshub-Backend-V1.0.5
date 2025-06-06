import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
    },
    profileImage: {
      type: String,
      default: "",
    },
    sex:{
      type: String,
      enum:["Male","Female","Other","Prefer not to say"],
      default: "Prefer not to say"
    },
    userType: {
      type: String,
      enum: ["reader", "author", "admin"],
      required: true,
      default: "reader",
    },   
    books: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Book",
      },
    ],
    verified: {
      type: Boolean,
      default: false,
    },
    expoPushToken: {
      type: String,
      default: null,
    }
    
  },
  { timestamps: true }
);
//compare passwords:
userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};
//hash the pass:
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  next();
});

const user = mongoose.model("User", userSchema);

export default user;
