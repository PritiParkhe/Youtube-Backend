import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js"
import {User} from "../models/user.model.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const registerUser = asyncHandler(async(req, res) => {
    //get user details from frontend
    //validation - not empty
    //check if user is already exist: username, email
    // check for images, check for avtar
    // upload on cloudinary and check for avatar
    // create user object - crete entry in db
    //remove password and refresh token field from response
    //check for user creation
    //return res

   const {fullName, email, username, password} = req.body
   console.log("email",email);
   if (
    [fullName, email, username, password].some((field) => field?.trim() === "")
   ) {
    throw new ApiError(400,"All fields are requied")
    
   }
   
   const existedUser = await User.findOne({
    $or: [{ username },{ email }]
   })
   if (existedUser) {
        throw new ApiError(409, "User with Username or email already exist")
    
   }
   const avatarLocalpath = req.files?.avatar[0]?.path;
   const covarLocalpath = req.files?.coverImage[0]?.path;

   if (!avatarLocalpath) {
    throw new ApiError(400, "Avatar file is required")
   }

   const avatar = await uploadOnCloudinary(avatarLocalpath)
   const coverImage = await uploadOnCloudinary(covarLocalpath)
   
   if (!avatarLocalpath) {
    throw new ApiError(400, "Avatar file is required")
   }

   const user = User.create({
    fullName,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    username: username.toLowercase()
   })
   
   const createUser = await User.findById(user._id).select(
    "-password -refreshToken"
    )
    if (!createUser) {
        throw new ApiError(500, "Something went wrong while registration the user")
        
    }

    return res.status(201).json(
        new ApiResponse(200, createUser, "User registeredn Successfully")
    )
})
export{registerUser}