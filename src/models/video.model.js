import momgoose, {Schema} from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
const videoSchema = new Schema(
    {
        videoFile:{
            type: String, //cloudnery url
            required: true
        },
        thumbnail:{
            type: String, //cloudnery url
            required: true
        },
        title:{
            type: String, //cloudnery url
            required: true
        },
        decription:{
            type: String, //cloudnery url
            required: true
        },
        duration:{
            type: Number,
            required: true
        },
        views:{
            type: Number,
            default: 0
        },
        isPublished:{
            type: Boolean,
            default: true
        },
        owner:{
            type: Schema.Types.ObjectId,
            ref:"User"
        }
        
    },
    {
        timestamps: true
    }
)
videoSchema.plugin(mongooseAggregatePaginate)
export const Video = momgoose.model("Video", videoSchema)