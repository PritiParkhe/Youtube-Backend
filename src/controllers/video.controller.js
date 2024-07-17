import mongoose, { isValidObjectId } from "mongoose";
import { Video } from "../models/video.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { video_upOptions, thumbnail_upOptions } from "../constants.js"
import { asyncHandler } from "../utils/asyncHandler.js";
import { Comment } from "../models/comment.model.js";
import { Like } from "../models/like.model.js";

import {
  uploadOnCloudinary,
  deleteFromCloudinary
} from "../utils/cloudinary.js"

// Define an asynchronous route handler to get all videos
const getAllVideos = asyncHandler(async (req, res) => {
  // Destructure query parameters from the request, providing default values if they are not specified
  const { page = 1, limit = 10, query, sortBy, sortType, userId } = req.query;

  // Initialize an empty pipeline array to hold aggregation stages for MongoDB
  const pipeline = [];
  
  // If a search query is provided, add a $search stage to the pipeline
  // This stage uses a pre-created search index "search-videos" on the "videos" collection
  if (query) {
    pipeline.push({
      $search: {
        index: "search-videos",
        text: {
          query: query, // The search term
          path: ["title", "description"], // Fields to search in
        },
      },
    });
  }
  
  // If a userId is provided, validate it and add a $match stage to filter by owner
  if (userId) {
    // Check if the userId is a valid MongoDB ObjectId
    if (!isValidObjectId(userId)) {
      throw new ApiError(400, "Invalid userId"); // Throw an error if invalid
    }

    // Add a $match stage to filter videos by the owner's userId
    pipeline.push({
      $match: {
        owner: new mongoose.Types.ObjectId(userId),
      },
    });
  }
  
  // Always add a $match stage to filter videos that are published
  pipeline.push({ $match: { isPublished: true } });

  // Add a $sort stage to the pipeline based on sortBy and sortType parameters
  // Default sorting is by creation date in descending order
  if (sortBy && sortType) {
    pipeline.push({
      $sort: {
        [sortBy]: sortType === "asc" ? 1 : -1, // 1 for ascending, -1 for descending
      },
    });
  } else {
    pipeline.push({ $sort: { createdAt: -1 } }); // Default sorting
  }

  // Add stages to join the "users" collection and include the owner's details
  pipeline.push(
    {
      $lookup: {
        from: "users", // The collection to join with
        localField: "owner", // Local field in the "videos" collection
        foreignField: "_id", // Foreign field in the "users" collection
        as: "ownerDetails", // Alias for the joined data
        pipeline: [
          {
            $project: {
              username: 1, // Include the username field
              "avatar.url": 1, // Include the avatar URL field
            },
          },
        ],
      },
    },
    {
      $unwind: "$ownerDetails", // Unwind the joined data to deconstruct the array
    }
  );

  // Create an aggregation object using the pipeline
  const videoAggregate = Video.aggregate(pipeline);

  // Define pagination options
  const options = {
    page: parseInt(page, 10), 
    limit: parseInt(limit, 10), 
  };

  // Execute the aggregation with pagination
  const videos = await Video.aggregatePaginate(videoAggregate, options);

  // Send the response with the fetched videos
  return res
    .status(200) // HTTP status 200 for success
    .json(new ApiResponse(200, videos, "Videos fetched successfully")); // Response body
});

// This function is an async handler for an endpoint to publish a new video.

const publishAVideo = asyncHandler(async (req, res) => {
  // Extract title, description, and isPublished from the request body.
  const { title, description, isPublished } = req.body;

  // Check if any of the required fields are missing or empty.
  // If any field is missing or empty, throw an error with a message.
  if (
    [title, description, isPublished].some(
      (field) => field === undefined || field?.trim() === ""
    )
  ) {
    throw new ApiError(400, "All fields are required");
  }

  // Get the local path of the uploaded video file from the request.
  const videoLocalPath = req.files?.video[0]?.path;

  if (!videoLocalPath) throw new ApiError(401, "Video is required to publish");

  // Get the local path of the uploaded thumbnail file from the request.
  const thumbnailLocalPath = req.files?.thumbnail[0]?.path;

  if (!thumbnailLocalPath)
    throw new ApiError(401, "Thumbnail is required to publish");

  // Upload the video and thumbnail files to Cloudinary concurrently.
  const [videoFile, thumbnailFile] = await Promise.all([
    uploadOnCloudinary(videoLocalPath, video_upOptions),
    uploadOnCloudinary(thumbnailLocalPath, thumbnail_upOptions),
  ]);

  // If either the video or thumbnail file fails to upload, throw an error with a message.
  if (!videoFile || !thumbnailFile) {
    let errorMessage = "";
    if (!videoFile) errorMessage += "Failed to upload video. ";
    if (!thumbnailFile) errorMessage += "Failed to upload thumbnail.";
    throw new ApiError(500, errorMessage);
  }

  // Create a new video document in the database with the provided and uploaded data.
  const video = await Video.create({
    video: {
      fileId: videoFile.public_id, // ID of the video file on Cloudinary
      url: videoFile.playback_url, // URL of the video file
    },
    thumbnail: {
      fileId: thumbnailFile.public_id, // ID of the thumbnail file on Cloudinary
      url: thumbnailFile.secure_url, // URL of the thumbnail file
    },
    duration: videoFile.duration, 
    title, 
    description, 
    isPublished, // Publication status of the video
    owner: req.user._id, // ID of the user who uploaded the video
  });

  // If creating the video document fails, throw an error with a message.
  if (!video) throw new ApiError(500, "Failed to publish video");

  // Send a response with the created video and a success message.
  return res
    .status(201) // HTTP status 201 indicates resource creation.
    .json(new ApiResponse(201, video, "Video published successfully")); // Response body
});

// Async handler to get video details for guests by video ID

const getVideoByIdForGuest = asyncHandler(async (req, res) => {
  
  const { videoId } = req.params;

  if (!videoId?.trim()) throw new ApiError(400, "Video Id is missing");

  // Check if videoId is a valid MongoDB ObjectId
  if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid VideoID");

  // Aggregate query to get video details
  const video = await Video.aggregate([
    {
      // Match stage to find the video by ID and ensure it is published
      $match: {
        _id: new mongoose.Types.ObjectId(videoId),
        isPublished: true,
      },
    },
    {
      // Lookup stage to get likes for the video
      $lookup: {
        from: "likes",
        localField: "_id",
        foreignField: "video",
        as: "likes",
      },
    },
    {
      // Lookup stage to get owner details and their subscribers
      $lookup: {
        from: "users",
        localField: "owner",
        foreignField: "_id",
        as: "owner",
        pipeline: [
          {
            // Nested lookup to get subscribers of the owner's channel
            $lookup: {
              from: "subscriptions",
              localField: "_id",
              foreignField: "channel",
              as: "subscribers",
            },
          },
          {
            // Add fields for subscriber count and subscription status
            $addFields: {
              subscribersCount: {
                $size: "$subscribers",
              },
              isSubscribed: false,
            },
          },
          {
            // Project only the required fields for the owner
            $project: {
              username: 1,
              "avatar.url": 1,
              subscribersCount: 1,
            },
          },
        ],
      },
    },
    {
      // Add fields for likes count and simplify owner details
      $addFields: {
        likesCount: {
          $size: "$likes",
        },
        owner: {
          $first: "$owner",
        },
        isLiked: false,
      },
    },
    {
      // Project only the required fields for the video
      $project: {
        "video.url": 1,
        title: 1,
        description: 1,
        views: 1,
        createdAt: 1,
        duration: 1,
        comments: 1,
        owner: 1,
        likesCount: 1,
        isLiked: 1,
        isSubscribed: 1,
      },
    },
  ]);

  // If video is not found, throw an error
  if (!video) throw new ApiError(404, "Video not found");

  // Return the video details in the response
  return res.status(200).json(new ApiResponse(200, video[0], "Video found"));
});

// Async handler to get video details by video ID
const getVideoById = asyncHandler(async (req, res) => {
  // Extract videoId from request parameters
  const { videoId } = req.params;
  
  // Determine if the request is from a guest user
  const isGuest = req.query.guest === "true";

  // Check if videoId is missing or empty
  if (!videoId?.trim()) throw new ApiError(400, "Video Id is missing");

  // Check if videoId is a valid MongoDB ObjectId
  if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid VideoID");

  // Aggregate query to get video details
  const video = await Video.aggregate([
    {
      // Match stage to find the video by ID
      $match: {
        _id: new mongoose.Types.ObjectId(videoId),
      },
    },
    {
      // Lookup stage to get likes for the video
      $lookup: {
        from: "likes",
        localField: "_id",
        foreignField: "video",
        as: "likes",
      },
    },
    {
      // Lookup stage to get owner details and their subscribers
      $lookup: {
        from: "users",
        localField: "owner",
        foreignField: "_id",
        as: "owner",
        pipeline: [
          {
            // Nested lookup to get subscribers of the owner's channel
            $lookup: {
              from: "subscriptions",
              localField: "_id",
              foreignField: "channel",
              as: "subscribers",
            },
          },
          {
            // Add fields for subscriber count and subscription status
            $addFields: {
              subscribersCount: {
                $size: "$subscribers",
              },
              isSubscribed: {
                $cond: {
                  if: isGuest,
                  then: false,
                  else: {
                    $cond: {
                      if: {
                        $in: [req.user?._id, "$subscribers.subscriber"],
                      },
                      then: true,
                      else: false,
                    },
                  },
                },
              },
            },
          },
          {
            // Project only the required fields for the owner
            $project: {
              username: 1,
              fullName: 1,
              "avatar.url": 1,
              subscribersCount: 1,
              isSubscribed: 1,
            },
          },
        ],
      },
    },
    {
      // Add fields for likes count, simplify owner details, and determine if the user liked the video
      $addFields: {
        likesCount: {
          $size: "$likes",
        },
        owner: {
          $first: "$owner",
        },
        isLiked: {
          $cond: {
            if: isGuest,
            then: false,
            else: {
              $cond: {
                if: { $in: [req.user?._id, "$likes.likedBy"] },
                then: true,
                else: false,
              },
            },
          },
        },
      },
    },
    {
      // Project only the required fields for the video
      $project: {
        "video.url": 1,
        title: 1,
        description: 1,
        views: 1,
        createdAt: 1,
        duration: 1,
        comments: 1,
        owner: 1,
        likesCount: 1,
        isLiked: 1,
        isSubscribed: 1,
        subscribersCount: 1,
      },
    },
  ]);

  // If video is not found, throw an error
  if (!video.length) throw new ApiError(404, "Video not found");

  // Return the video details in the response
  return res.status(200).json(new ApiResponse(200, video[0], "Video found"));
});


// Async handler to update video details
const updateVideo = asyncHandler(async (req, res) => {
  // Extract videoId from request parameters
  const { videoId } = req.params;

  // Check if videoId is a valid MongoDB ObjectId
  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid videoId");
  }

  // Extract title and description from request body
  const { title, description } = req.body;

  // Get the local path of the uploaded thumbnail from the request
  const thumbnailLocalPath = req.file?.path;

  // Find the current video by ID
  const currentVideo = await Video.findById(videoId);

  // If the video is not found, throw an error
  if (!currentVideo) throw new ApiError(401, "Video cannot be found");

  // Check if title or description is missing or empty
  if (
    [title, description].some(
      (field) => field === undefined || field?.trim() === ""
    )
  ) {
    throw new ApiError(400, "All fields are required");
  }

  // Check if the current user is the owner of the video
  if (currentVideo?.owner.toString() !== req.user?._id.toString()) {
    throw new ApiError(
      400,
      "You can't edit this video as you are not the owner"
    );
  }

  // Create an update object with the new title and description
  let update = {
    $set: {
      title,
      description,
    },
  };

  // If a new thumbnail was provided, add it to the update object
  if (thumbnailLocalPath) {
    // Upload the new thumbnail to Cloudinary
    const thumbnailFile = await uploadOnCloudinary(
      thumbnailLocalPath,
      thumbnail_upOptions
    );

    // If thumbnail upload fails, throw an error
    if (!thumbnailFile) throw new ApiError(501, "Thumbnail uploading failed");

    // Delete the old thumbnail from Cloudinary
    await deleteFromCloudinary(currentVideo?.thumbnail.fileId);

    // Add the new thumbnail details to the update object
    update.$set.thumbnail = {
      fileId: thumbnailFile.public_id,
      url: thumbnailFile.secure_url,
    };
  }

  // Update the video in the database with the new details
  const video = await Video.findByIdAndUpdate(videoId, update, {
    new: true, // Return the updated document
  });

  // If updating the video fails, throw an error
  if (!video) throw new ApiError(501, "Updating Video failed");

  // Return the updated video details in the response
  return res
    .status(200)
    .json(new ApiResponse(200, video, "Video updated successfully"));
});

// Async handler to delete video 
const deleteVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  // Find the current video by ID
  const currentVideo = await Video.findById(videoId);

  // If the video is not found, throw an error
  if (!currentVideo) throw new ApiError(404, "Video not found");

  // Delete the video from the database
  const deleteVideo = await Video.findByIdAndDelete(videoId);

  // If video deletion fails, throw an error
  if (!deleteVideo) throw new ApiError(500, "Video deletion failed");

  // Delete related likes, comments, and Cloudinary files in parallel
  await Promise.all([
    Like.deleteMany({ video: videoId }),
    Comment.deleteMany({ video: videoId }),
    deleteFromCloudinary(currentVideo?.video.fileId),
    deleteFromCloudinary(currentVideo?.thumbnail.fileId),
  ]);

  // Return a success response
  return res
    .status(200)
    .json(new ApiResponse(200, null, "Video deleted successfully"));
});

// Async handler to toggles the publish status of a video.
const togglePublishStatus = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  // Find the video by ID
  const video = await Video.findById(videoId);

  // If the video is not found, throw an error
  if (!video) throw new ApiError(404, "Video not found");

  // Toggle the publish status of the video
  video.isPublished = !video.isPublished;

  // Save the updated video
  await video.save({ validateBeforeSave: false });

  // Return a success response with the updated video
  return res
    .status(200)
    .json(new ApiResponse(200, video, "Video publish status updated"));
});

// Async handler to fetches the next set of videos excluding the current one
const getNextVideos = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  // Check if videoId is valid
  if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid videoId");

  // Find the current video by ID
  const video = await Video.findById(videoId);

  // If the video is not found, throw an error
  if (!video) throw new ApiError(404, "Video not found");

  // Aggregate query to get next videos
  const nextVideos = await Video.aggregate([
    {
      // Match stage to find published videos excluding the current one
      $match: {
        _id: {
          $ne: new mongoose.Types.ObjectId(videoId),
        },
        isPublished: true,
      },
    },
    {
      // Randomly sample 10 videos
      $sample: {
        size: 10,
      },
    },
    {
      // Lookup stage to get owner details
      $lookup: {
        from: "users",
        localField: "owner",
        foreignField: "_id",
        as: "ownerDetails",
        pipeline: [
          {
            // Project only the required fields for the owner
            $project: {
              username: 1,
              "avatar.url": 1,
            },
          },
        ],
      },
    },
    {
      // Unwind the owner details array
      $unwind: "$ownerDetails",
    },
  ]);

  // Return a success response with the next videos
  return res
    .status(200)
    .json(new ApiResponse(200, nextVideos, "Next videos fetched successfully"));
});

// Async handler to update the view count of a video and the user's watch history
const updateVideoViews = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const userId = req.user?._id;

  // Check if videoId is valid
  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid videoId");
  }

  // Find the video by ID
  const video = await Video.findById(videoId);
  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  // Find the user by ID
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Check if the user has watched this video before
  const watchHistoryEntry = user.watchHistory.find(
    (entry) => entry.video.toString() === videoId
  );

  if (!watchHistoryEntry) {
    // If not, increment the view count and add to watch history
    await Video.findByIdAndUpdate(videoId, { $inc: { views: 1 } });
    user.watchHistory.push({
      video: videoId,
      watchedAt: new Date(),
    });
    await user.save();
  } else {
    // If yes, update the watchedAt timestamp
    watchHistoryEntry.watchedAt = new Date();
    await user.save();
  }

  // Return a success response with the updated video and user details
  return res
    .status(200)
    .json(
      new ApiResponse(200, { video, user }, "Video views updated successfully")
    );
});

export {
  getAllVideos,
  publishAVideo,
  getVideoById,
  updateVideo,
  deleteVideo,
  togglePublishStatus,
  getNextVideos,
  updateVideoViews,
  getVideoByIdForGuest,
};