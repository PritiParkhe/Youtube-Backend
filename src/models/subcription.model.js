import mongoose, {Schema} from "mongoose";

const subcriptionSchema = new Schema({
  subscriber : {
    type : Schema.Types.ObjectId, // who is subscribing
    ref: "User"
  },
  channel:{
    type : Schema.Types.ObjectId, // to whom is subscriber is subscribing
    ref: "User"
  },
},{timestamps: true}) 
export const Subcription = mongoose.model("Subcription", subcriptionSchema)